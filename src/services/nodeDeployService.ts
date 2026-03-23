// src/services/nodeDeployService.ts
import axios, { AxiosInstance } from 'axios';
import { db } from '../db/index.js';
import { nodes, forwardRules, opLogs } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { runCommand, safeJsonParse } from '../utils/shell.js';
import { eq } from 'drizzle-orm';

/**
 * P6: 节点远程部署 + 配置下发
 *
 * 两种部署模式:
 *   1. SSH 模式 — 面板通过 SSH 直接安装 Agent (需要 root 密码或密钥)
 *   2. 脚本模式 — 用户手动在节点上执行安装脚本 (已在 P0 实现)
 *
 * 配置下发:
 *   面板通过各节点的 GOST API 端口远程推送转发/隧道配置
 */

export interface DeployOpts {
  nodeId: number;
  sshHost: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshKeyPath?: string;
  installGost?: boolean;
  installXui?: boolean;
}

export interface PushConfigOpts {
  nodeId: number;
  services?: any[];     // GOST service 配置数组
  chains?: any[];       // GOST chain 配置数组
}

class NodeDeployService {

  // ============================
  // ===== SSH 远程部署 =====
  // ============================

  /**
   * 通过 SSH 远程安装 Agent
   * 依赖系统 sshpass (密码模式) 或 ssh-key
   */
  async deployViaSSH(opts: DeployOpts): Promise<{ ok: boolean; log: string }> {
    const node = db.select().from(nodes).where(eq(nodes.id, opts.nodeId)).get();
    if (!node) throw new Error(`节点 ${opts.nodeId} 不存在`);

    const logs: string[] = [];
    const log = (msg: string) => { logs.push(msg); logger.info(`[部署 ${node.name}] ${msg}`); };

    try {
      const sshBase = this.buildSSHCommand(opts);

      // 1. 连接测试
      log('测试 SSH 连接...');
      const testResult = await runCommand(`${sshBase} "echo OK"`, 15000);
      if (testResult.code !== 0) {
        throw new Error(`SSH 连接失败: ${testResult.stderr}`);
      }
      log('SSH 连接成功');

      // 2. 检测系统信息
      log('检测目标系统...');
      const archResult = await runCommand(`${sshBase} "uname -m"`);
      const osResult = await runCommand(`${sshBase} "cat /etc/os-release 2>/dev/null | grep ^ID= | cut -d= -f2"`);
      log(`系统: ${osResult.stdout}, 架构: ${archResult.stdout}`);

      // 3. 安装 GOST
      if (opts.installGost !== false) {
        log('安装 GOST v3...');
        const arch = archResult.stdout.includes('aarch64') ? 'arm64' : 'amd64';
        const gostVer = '3.0.0-rc10';
        const installCmd = [
          `wget -qO /tmp/gost.tar.gz "https://github.com/go-gost/gost/releases/download/v${gostVer}/gost_${gostVer}_linux_${arch}.tar.gz"`,
          'tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/ gost 2>/dev/null || tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/',
          'chmod +x /usr/local/bin/gost',
          'rm -f /tmp/gost.tar.gz',
        ].join(' && ');

        const gostResult = await runCommand(`${sshBase} "${installCmd}"`, 120000);
        if (gostResult.code !== 0) {
          log(`GOST 安装警告: ${gostResult.stderr}`);
        } else {
          log('GOST 安装完成');
        }

        // 4. 配置 GOST 服务
        log('配置 GOST 服务...');
        const gostApiPort = node.gostApiPort || 18080;
        const configCmd = [
          'mkdir -p /etc/unified-panel-agent',
          `cat > /etc/unified-panel-agent/gost.yaml << 'GEOF'\napi:\n  addr: ":${gostApiPort}"\n  accesslog: true\nservices: []\nchains: []\nGEOF`,
          `cat > /etc/systemd/system/gost.service << 'SEOF'\n[Unit]\nDescription=GOST v3\nAfter=network.target\n[Service]\nType=simple\nExecStart=/usr/local/bin/gost -C /etc/unified-panel-agent/gost.yaml\nRestart=always\nRestartSec=5\nLimitNOFILE=1048576\n[Install]\nWantedBy=multi-user.target\nSEOF`,
          'systemctl daemon-reload',
          'systemctl enable gost',
          'systemctl restart gost',
        ].join(' && ');

        await runCommand(`${sshBase} "${configCmd}"`, 30000);
        log(`GOST 服务已启动, API :${gostApiPort}`);
      }

      // 5. 安装心跳 cron
      log('配置心跳...');
      const panelHost = process.env.PANEL_PUBLIC_URL || `http://${opts.sshHost}:9527`;
      const heartbeatCmd = [
        `echo '* * * * * curl -sf -X POST "${panelHost}/api/v1/nodes/heartbeat" -H "Authorization: Bearer ${node.agentKey}" -H "Content-Type: application/json" -d "{\\"systemInfo\\": {}}" >/dev/null 2>&1' | crontab -`,
      ].join(' && ');
      await runCommand(`${sshBase} "${heartbeatCmd}"`, 15000);
      log('心跳 cron 已配置');

      // 6. 安装 3X-UI (可选)
      if (opts.installXui) {
        log('安装 3X-UI...');
        const xuiResult = await runCommand(
          `${sshBase} "echo y | bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh) 2>&1 | tail -5"`,
          300000, // 5 分钟超时
        );
        log(`3X-UI: ${xuiResult.stdout || '安装完成'}`);
      }

      // 7. 更新节点状态
      db.update(nodes).set({
        gostInstalled: true,
        xuiInstalled: opts.installXui || false,
        status: 'online',
        lastHeartbeat: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(nodes.id, opts.nodeId)).run();

      log('部署完成');

      // 8. 记录操作日志
      db.insert(opLogs).values({
        action: 'deploy_node',
        target: `${node.name} (${opts.sshHost})`,
        detail: JSON.stringify({ logs }),
      }).run();

      return { ok: true, log: logs.join('\n') };

    } catch (err: any) {
      log(`错误: ${err.message}`);
      db.update(nodes).set({ status: 'error', updatedAt: new Date().toISOString() })
        .where(eq(nodes.id, opts.nodeId)).run();
      return { ok: false, log: logs.join('\n') };
    }
  }

  // ============================
  // ===== 配置下发 =====
  // ============================

  /**
   * 将转发/隧道配置推送到远程节点的 GOST API
   */
  async pushConfig(opts: PushConfigOpts): Promise<{ ok: boolean; errors: string[] }> {
    const node = db.select().from(nodes).where(eq(nodes.id, opts.nodeId)).get();
    if (!node) throw new Error(`节点 ${opts.nodeId} 不存在`);

    const gostUrl = `http://${node.host}:${node.gostApiPort || 18080}`;
    const api = axios.create({ baseURL: gostUrl, timeout: 10000 });
    const errors: string[] = [];

    // 推送 chains
    if (opts.chains?.length) {
      for (const chain of opts.chains) {
        try {
          await api.post('/api/config/chains', chain);
          logger.info(`推送链 ${chain.name} → ${node.name}`);
        } catch (err: any) {
          const msg = `链 ${chain.name} 推送失败: ${err.message}`;
          errors.push(msg);
          logger.error(msg);
        }
      }
    }

    // 推送 services
    if (opts.services?.length) {
      for (const svc of opts.services) {
        try {
          await api.post('/api/config/services', svc);
          logger.info(`推送服务 ${svc.name} → ${node.name}`);
        } catch (err: any) {
          const msg = `服务 ${svc.name} 推送失败: ${err.message}`;
          errors.push(msg);
          logger.error(msg);
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * 同步本地规则到远程节点
   * 将绑定在某节点上的所有 active 规则推送过去
   */
  async syncNodeRules(nodeId: number): Promise<{ ok: boolean; synced: number; errors: string[] }> {
    const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
    if (!node) throw new Error(`节点不存在`);

    // 获取绑定到该节点的规则
    const rules = db.select().from(forwardRules)
      .where(eq(forwardRules.nodeId, nodeId))
      .all()
      .filter(r => r.status === 'active' && r.config);

    if (rules.length === 0) {
      return { ok: true, synced: 0, errors: [] };
    }

    const services: any[] = [];
    const chains: any[] = [];

    for (const rule of rules) {
      const config = safeJsonParse(rule.config);
      // 根据类型构建 GOST 配置
      if (rule.type.startsWith('port-forward-')) {
        const proto = rule.type === 'port-forward-tcp' ? 'tcp' : 'udp';
        services.push({
          name: rule.gostServiceName || `svc-${rule.id}`,
          addr: rule.listenAddr,
          handler: { type: proto },
          listener: { type: proto },
          forwarder: { nodes: [{ name: `t-${rule.id}`, addr: rule.targetAddr }] },
        });
      } else if (rule.type.startsWith('tunnel-')) {
        const transport = rule.type.replace('tunnel-', '');
        const chainName = `chain-${rule.id}`;
        chains.push({
          name: chainName,
          hops: [{
            name: `hop-${rule.id}`,
            nodes: [{
              name: `n-${rule.id}`,
              addr: rule.targetAddr,
              connector: {
                type: 'relay',
                ...(rule.authUser && { auth: { username: rule.authUser, password: rule.authPass } }),
              },
              dialer: { type: transport },
            }],
          }],
        });
        services.push({
          name: rule.gostServiceName || `svc-${rule.id}`,
          addr: rule.listenAddr,
          handler: { type: 'tcp', chain: chainName },
          listener: { type: 'tcp' },
          forwarder: { nodes: [{ name: `t-${rule.id}`, addr: rule.targetAddr }] },
        });
      }
    }

    const result = await this.pushConfig({ nodeId, services, chains });
    return { ok: result.ok, synced: rules.length, errors: result.errors };
  }

  /**
   * 获取远程节点 GOST 当前配置
   */
  async getRemoteConfig(nodeId: number): Promise<any> {
    const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
    if (!node) throw new Error('节点不存在');

    const gostUrl = `http://${node.host}:${node.gostApiPort || 18080}`;
    const { data } = await axios.get(`${gostUrl}/api/config`, { timeout: 10000 });
    return data;
  }

  /**
   * 清空远程节点所有 GOST 配置
   */
  async clearRemoteConfig(nodeId: number): Promise<void> {
    const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
    if (!node) throw new Error('节点不存在');

    const gostUrl = `http://${node.host}:${node.gostApiPort || 18080}`;
    const api = axios.create({ baseURL: gostUrl, timeout: 10000 });

    // 先获取所有再逐个删除
    const config = (await api.get('/api/config')).data;

    for (const svc of (config.services || [])) {
      try { await api.delete(`/api/config/services/${svc.name}`); } catch {}
    }
    for (const chain of (config.chains || [])) {
      try { await api.delete(`/api/config/chains/${chain.name}`); } catch {}
    }

    logger.info(`已清空节点 ${node.name} 的 GOST 配置`);
  }

  // ============================
  // ===== BBR 远程推送 =====
  // ============================

  /**
   * 通过 SSH 在远程节点启用 BBR + sysctl 优化
   */
  async pushBbrToNode(opts: {
    nodeId: number;
    sshPassword?: string;
    sshKeyPath?: string;
    profile: 'conservative' | 'balanced' | 'aggressive';
  }): Promise<{ ok: boolean; log: string }> {
    const node = db.select().from(nodes).where(eq(nodes.id, opts.nodeId)).get();
    if (!node) throw new Error(`节点 ${opts.nodeId} 不存在`);

    const logs: string[] = [];
    const log = (msg: string) => { logs.push(msg); logger.info(`[BBR ${node.name}] ${msg}`); };

    try {
      const sshBase = this.buildSSHCommand({
        nodeId: opts.nodeId,
        sshHost: node.host,
        sshUser: 'root',
        sshPassword: opts.sshPassword,
        sshKeyPath: opts.sshKeyPath,
      });

      // 1. 检查内核版本
      log('检测内核版本...');
      const kernelResult = await runCommand(`${sshBase} "uname -r"`, 10000);
      log(`内核: ${kernelResult.stdout.trim()}`);

      // 2. 加载 BBR 模块
      log('加载 BBR 内核模块...');
      await runCommand(`${sshBase} "modprobe tcp_bbr 2>/dev/null; echo done"`, 10000);

      // 3. 检查 BBR 是否可用
      const availResult = await runCommand(
        `${sshBase} "sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null"`,
        10000,
      );
      if (!availResult.stdout.includes('bbr')) {
        log('错误: 内核不支持 BBR (需要 Linux 4.9+)');
        return { ok: false, log: logs.join('\n') };
      }
      log('BBR 模块可用');

      // 4. 构建 sysctl 参数
      const params = this.getSysctlParams(opts.profile);
      const sysctlCmds = params.map(([k, v]) => `sysctl -w "${k}=${v}"`).join(' && ');

      // 5. 应用参数
      log(`应用 ${opts.profile} 策略 (${params.length} 参数)...`);
      const applyResult = await runCommand(`${sshBase} "${sysctlCmds}"`, 30000);
      if (applyResult.code !== 0) {
        log(`部分参数可能失败: ${applyResult.stderr}`);
      }

      // 6. 持久化
      log('持久化到 sysctl.conf...');
      const confContent = params.map(([k, v]) => `${k}=${v}`).join('\\n');
      await runCommand(`${sshBase} "
        cp /etc/sysctl.conf /etc/sysctl.conf.bak.\$(date +%s) 2>/dev/null
        sed -i '/# unified-panel-bbr/,/# end-unified-panel-bbr/d' /etc/sysctl.conf
        echo '# unified-panel-bbr' >> /etc/sysctl.conf
        echo -e '${confContent}' >> /etc/sysctl.conf
        echo '# end-unified-panel-bbr' >> /etc/sysctl.conf
      "`, 15000);

      // 7. 验证
      const verifyResult = await runCommand(
        `${sshBase} "sysctl -n net.ipv4.tcp_congestion_control"`,
        10000,
      );
      const ccNow = verifyResult.stdout.trim();
      log(`验证: tcp_congestion_control = ${ccNow}`);

      if (ccNow === 'bbr') {
        log(`✓ BBR ${opts.profile} 已成功启用`);
      } else {
        log(`⚠ BBR 未生效 (当前: ${ccNow})，可能需要重启`);
      }

      return { ok: ccNow === 'bbr', log: logs.join('\n') };

    } catch (err: any) {
      log(`错误: ${err.message}`);
      return { ok: false, log: logs.join('\n') };
    }
  }

  /**
   * 批量推送 BBR 到所有在线节点
   */
  async pushBbrToAllNodes(opts: {
    sshPassword?: string;
    sshKeyPath?: string;
    profile: 'conservative' | 'balanced' | 'aggressive';
  }): Promise<Array<{ nodeId: number; name: string; ok: boolean }>> {
    const allNodes = db.select().from(nodes)
      .where(eq(nodes.status, 'online'))
      .all()
      .filter(n => n.host !== '127.0.0.1' && n.host !== 'localhost');

    const results: Array<{ nodeId: number; name: string; ok: boolean }> = [];

    for (const node of allNodes) {
      try {
        const result = await this.pushBbrToNode({
          nodeId: node.id,
          sshPassword: opts.sshPassword,
          sshKeyPath: opts.sshKeyPath,
          profile: opts.profile,
        });
        results.push({ nodeId: node.id, name: node.name, ok: result.ok });
      } catch (err: any) {
        results.push({ nodeId: node.id, name: node.name, ok: false });
        logger.error(`推送 BBR 到 ${node.name} 失败: ${err.message}`);
      }
    }

    return results;
  }

  private getSysctlParams(profile: string): [string, string][] {
    const base: [string, string][] = [
      ['net.core.default_qdisc', 'fq'],
      ['net.ipv4.tcp_congestion_control', 'bbr'],
      ['net.ipv4.tcp_mtu_probing', '1'],
      ['net.ipv4.tcp_fastopen', '3'],
      ['net.ipv4.tcp_slow_start_after_idle', '0'],
    ];

    switch (profile) {
      case 'aggressive':
        return [
          ...base,
          ['net.core.rmem_max', '67108864'],
          ['net.core.wmem_max', '67108864'],
          ['net.ipv4.tcp_rmem', '4096 87380 67108864'],
          ['net.ipv4.tcp_wmem', '4096 65536 67108864'],
          ['net.ipv4.tcp_notsent_lowat', '16384'],
          ['net.core.netdev_max_backlog', '10000'],
          ['net.ipv4.tcp_max_syn_backlog', '8192'],
          ['net.ipv4.tcp_tw_reuse', '1'],
          ['net.ipv4.ip_local_port_range', '1024 65535'],
        ];
      case 'conservative':
        return [
          ...base,
          ['net.core.rmem_max', '16777216'],
          ['net.core.wmem_max', '16777216'],
          ['net.ipv4.tcp_rmem', '4096 87380 16777216'],
          ['net.ipv4.tcp_wmem', '4096 65536 16777216'],
        ];
      default: // balanced
        return [
          ...base,
          ['net.core.rmem_max', '33554432'],
          ['net.core.wmem_max', '33554432'],
          ['net.ipv4.tcp_rmem', '4096 87380 33554432'],
          ['net.ipv4.tcp_wmem', '4096 65536 33554432'],
          ['net.ipv4.tcp_notsent_lowat', '16384'],
        ];
    }
  }

  // ===== 工具 =====

  /**
   * 消毒 shell 参数，防止命令注入
   * 注意: SSH 密码通过 sshpass 单引号包裹，不走此函数
   */
  private sanitize(input: string, allowedPattern = /^[a-zA-Z0-9._\-@/:~]+$/): string {
    if (!allowedPattern.test(input)) {
      throw new Error(`参数包含不安全字符: ${input.slice(0, 30)}`);
    }
    return input;
  }

  private buildSSHCommand(opts: DeployOpts): string {
    const port = opts.sshPort || 22;
    if (port < 1 || port > 65535) throw new Error('SSH 端口无效');
    const user = this.sanitize(opts.sshUser || 'root');
    const host = this.sanitize(opts.sshHost);
    const sshOpts = `-o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${port}`;

    if (opts.sshKeyPath) {
      // keyPath 允许更多字符 (路径中可能有空格，用引号包裹)
      const keyPath = this.sanitize(opts.sshKeyPath, /^[a-zA-Z0-9._\-@/:~ ]+$/);
      return `ssh ${sshOpts} -i "${keyPath}" ${user}@${host}`;
    }

    if (opts.sshPassword) {
      // sshpass -p 用单引号包裹，内部单引号做转义
      const escapedPass = opts.sshPassword.replace(/'/g, "'\\''");
      return `sshpass -p '${escapedPass}' ssh ${sshOpts} ${user}@${host}`;
    }

    return `ssh ${sshOpts} ${user}@${host}`;
  }
}

export const nodeDeployService = new NodeDeployService();
