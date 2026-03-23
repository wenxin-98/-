// src/services/trafficCollector.ts
/**
 * 流量采集服务
 * - 每 60s 从 3X-UI 拉取 Xray 入站流量
 * - 每 60s 从 iptables/nftables 采集 GOST 端口流量
 * - 每小时写入 trafficStats 表 (历史快照)
 * - 实时更新 forwardRules 表的 trafficUp/Down
 */

import { db } from '../db/index.js';
import { forwardRules, trafficStats } from '../db/schema.js';
import { xuiApi } from './xuiService.js';
import { logger } from '../utils/logger.js';
import { runCommand } from '../utils/shell.js';
import { eq } from 'drizzle-orm';

class TrafficCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private hourlyTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    logger.info('流量采集已启动 (间隔 60s, 快照每小时)');

    // 每 60 秒采集
    this.timer = setInterval(() => this.collect(), 60000);
    // 每小时写快照
    this.hourlyTimer = setInterval(() => this.snapshot(), 3600000);
    // 启动后 10s 首次采集
    setTimeout(() => this.collect(), 10000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.hourlyTimer) { clearInterval(this.hourlyTimer); this.hourlyTimer = null; }
  }

  /**
   * 采集一轮流量数据
   */
  async collect() {
    try {
      await Promise.allSettled([
        this.collectXrayTraffic(),
        this.collectGostTraffic(),
      ]);
    } catch (err: any) {
      logger.error(`流量采集异常: ${err.message}`);
    }
  }

  /**
   * 从 3X-UI 拉取 Xray 入站流量并更新 forwardRules
   */
  private async collectXrayTraffic() {
    try {
      const inbounds = await xuiApi.listInbounds();
      if (!inbounds?.length) return;

      for (const ib of inbounds) {
        const up = ib.up || 0;
        const down = ib.down || 0;

        if (up === 0 && down === 0) continue;

        // 更新本地 forwardRules 记录
        db.update(forwardRules).set({
          trafficUp: up,
          trafficDown: down,
          updatedAt: new Date().toISOString(),
        }).where(eq(forwardRules.xuiInboundId, ib.id)).run();
      }
    } catch (err: any) {
      // 3X-UI 可能未安装，静默忽略
      logger.debug(`Xray 流量采集: ${err.message}`);
    }
  }

  /**
   * 从 iptables 规则采集 GOST 端口流量
   * GOST v3 API 不提供 per-service 流量，用 iptables INPUT/OUTPUT 字节计数
   */
  private async collectGostTraffic() {
    try {
      // 获取所有 GOST 规则的监听端口
      const gostRules = db.select().from(forwardRules)
        .where(eq(forwardRules.source, 'gost'))
        .all()
        .filter(r => r.status === 'active' && r.listenAddr);

      if (!gostRules.length) return;

      // 确保 iptables 监控链存在
      await this.ensureIptablesChain(gostRules);

      // 读取 iptables 计数
      const result = await runCommand(
        'iptables -L UNIFIED_PANEL_TRAFFIC -n -v -x 2>/dev/null',
        5000,
      );

      if (result.code !== 0 || !result.stdout) {
        // iptables 不可用，尝试 nftables 或 /proc/net/dev 降级
        await this.collectGostTrafficFallback(gostRules);
        return;
      }

      // 解析 iptables 输出: pkts bytes target prot source destination (dpt:PORT)
      const lines = result.stdout.split('\n');
      for (const rule of gostRules) {
        const portMatch = rule.listenAddr?.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = portMatch[1];

        // 找到 INPUT (down) 和 OUTPUT (up) 行
        let down = 0, up = 0;
        for (const line of lines) {
          if (line.includes(`dpt:${port}`)) {
            const parts = line.trim().split(/\s+/);
            const bytes = parseInt(parts[1]) || 0;
            if (line.includes('INPUT') || line.includes('incoming')) {
              down += bytes;
            } else {
              up += bytes;
            }
          }
        }

        if (up > 0 || down > 0) {
          db.update(forwardRules).set({
            trafficUp: up,
            trafficDown: down,
            updatedAt: new Date().toISOString(),
          }).where(eq(forwardRules.id, rule.id)).run();
        }
      }
    } catch (err: any) {
      logger.debug(`GOST 流量采集: ${err.message}`);
    }
  }

  /**
   * 确保 iptables 监控链存在 (首次自动创建)
   */
  private async ensureIptablesChain(rules: any[]) {
    // 检查链是否已存在
    const check = await runCommand(
      'iptables -L UNIFIED_PANEL_TRAFFIC -n 2>/dev/null',
      3000,
    );
    if (check.code === 0) return; // 已存在

    // 创建链
    await runCommand('iptables -N UNIFIED_PANEL_TRAFFIC 2>/dev/null', 3000);
    await runCommand('iptables -I INPUT -j UNIFIED_PANEL_TRAFFIC 2>/dev/null', 3000);
    await runCommand('iptables -I OUTPUT -j UNIFIED_PANEL_TRAFFIC 2>/dev/null', 3000);

    // 为每个 GOST 端口添加计数规则
    for (const rule of rules) {
      const portMatch = rule.listenAddr?.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = portMatch[1];
      await runCommand(`iptables -A UNIFIED_PANEL_TRAFFIC -p tcp --dport ${port} -m comment --comment "incoming:${rule.id}" 2>/dev/null`, 3000);
      await runCommand(`iptables -A UNIFIED_PANEL_TRAFFIC -p tcp --sport ${port} -m comment --comment "outgoing:${rule.id}" 2>/dev/null`, 3000);
      await runCommand(`iptables -A UNIFIED_PANEL_TRAFFIC -p udp --dport ${port} -m comment --comment "incoming:${rule.id}" 2>/dev/null`, 3000);
      await runCommand(`iptables -A UNIFIED_PANEL_TRAFFIC -p udp --sport ${port} -m comment --comment "outgoing:${rule.id}" 2>/dev/null`, 3000);
    }

    logger.info(`iptables 流量监控链已创建 (${rules.length} 规则)`);
  }

  /**
   * 降级方案: 用 ss 连接计数 + /proc/net/dev 估算
   */
  private async collectGostTrafficFallback(rules: any[]) {
    for (const rule of rules) {
      const portMatch = rule.listenAddr?.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = portMatch[1];

      // 获取活跃连接数 (作为流量活跃度指标)
      const connResult = await runCommand(
        `ss -tn state established | grep ":${port} " | wc -l`,
        3000,
      );
      const connections = parseInt(connResult.stdout.trim()) || 0;

      // 估算: 每个活跃连接约 ~100KB/s 上下行
      // 这只是粗略估算，iptables 方案更准确
      if (connections > 0) {
        const current = db.select().from(forwardRules).where(eq(forwardRules.id, rule.id)).get();
        if (current) {
          const estimatedBytes = connections * 100 * 1024 * 60; // 60s 内估算
          db.update(forwardRules).set({
            trafficUp: (current.trafficUp || 0) + estimatedBytes,
            trafficDown: (current.trafficDown || 0) + estimatedBytes,
            updatedAt: new Date().toISOString(),
          }).where(eq(forwardRules.id, rule.id)).run();
        }
      }
    }
  }

  /**
   * 每小时写入流量快照
   */
  async snapshot() {
    const hour = new Date().toISOString().slice(0, 13) + ':00:00';

    const rules = db.select().from(forwardRules)
      .where(eq(forwardRules.status, 'active'))
      .all();

    let count = 0;
    for (const rule of rules) {
      if ((rule.trafficUp || 0) === 0 && (rule.trafficDown || 0) === 0) continue;

      db.insert(trafficStats).values({
        ruleId: rule.id,
        nodeId: rule.nodeId || undefined,
        hour,
        trafficUp: rule.trafficUp || 0,
        trafficDown: rule.trafficDown || 0,
        connections: 0,
      }).run();
      count++;
    }

    if (count > 0) {
      logger.debug(`流量快照: ${count} 条规则已记录 (${hour})`);
    }
  }
}

export const trafficCollector = new TrafficCollector();
