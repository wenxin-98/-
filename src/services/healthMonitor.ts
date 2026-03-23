// src/services/healthMonitor.ts
import axios from 'axios';
import { db } from '../db/index.js';
import { nodes, forwardRules, trafficStats } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { safeJsonParse } from '../utils/shell.js';
import { eq, sql } from 'drizzle-orm';

/**
 * 节点健康监控
 * - 定时检测各节点 GOST API 是否可达
 * - 自动标记离线节点
 * - 采集流量统计
 */

const CHECK_INTERVAL = 60 * 1000;     // 60 秒检测一次
const OFFLINE_THRESHOLD = 180;         // 3 分钟无心跳视为离线

class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    logger.info('健康监控已启动 (间隔 60s)');
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL);
    // 启动后立即执行一次
    setTimeout(() => this.check(), 5000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('健康监控已停止');
    }
  }

  async check() {
    try {
      const allNodes = db.select().from(nodes).all();

      for (const node of allNodes) {
        await this.checkNode(node);
      }

      // 标记超时离线
      this.markOfflineNodes();

    } catch (err: any) {
      logger.error(`健康检测异常: ${err.message}`);
    }
  }

  private async checkNode(node: any) {
    // 本机: 直接检测本地 GOST API (兼容 IPv6-only)
    if (node.host === '127.0.0.1' || node.host === 'localhost' || node.host === '::1') {
      try {
        const port = node.gostApiPort || 18080;
        // 先尝试 IPv4，失败尝试 IPv6 loopback
        let res;
        try {
          res = await axios.get(`http://127.0.0.1:${port}/config`, { timeout: 3000 });
        } catch {
          res = await axios.get(`http://[::1]:${port}/config`, { timeout: 3000 });
        }
        const serviceCount = res.data?.services?.length || 0;
        db.update(nodes).set({
          status: 'online',
          gostInstalled: true,
          lastHeartbeat: new Date().toISOString(),
          systemInfo: JSON.stringify({
            gostServices: serviceCount,
            gostChains: res.data?.chains?.length || 0,
            checkedAt: new Date().toISOString(),
            ...safeJsonParse(node.systemInfo, {}),
          }),
        }).where(eq(nodes.id, node.id)).run();
      } catch {
        // GOST 可能未安装，但本机始终在线
        db.update(nodes).set({
          status: 'online',
          lastHeartbeat: new Date().toISOString(),
        }).where(eq(nodes.id, node.id)).run();
      }
      return;
    }

    const gostUrl = `http://${node.host}:${node.gostApiPort || 18080}`;

    try {
      // 1. 检测 GOST API + 测量延迟
      const startTime = Date.now();
      const res = await axios.get(`${gostUrl}/config`, { timeout: 8000 });
      const latencyMs = Date.now() - startTime;

      // 2. 采集 GOST 服务数量
      const serviceCount = res.data?.services?.length || 0;
      const chainCount = res.data?.chains?.length || 0;

      // 3. 更新状态 (含延迟)
      const systemInfo = {
        gostServices: serviceCount,
        gostChains: chainCount,
        latencyMs,
        checkedAt: new Date().toISOString(),
        ...safeJsonParse(node.systemInfo, {}),
      };

      db.update(nodes).set({
        status: 'online',
        gostInstalled: true,
        lastHeartbeat: new Date().toISOString(),
        systemInfo: JSON.stringify(systemInfo),
      }).where(eq(nodes.id, node.id)).run();

    } catch (err: any) {
      // GOST 不可达，尝试 TCP 探测 (兼容禁 ping 环境)
      const { runCommand } = await import('../utils/shell.js');
      // 先尝试 SSH 端口 (22)，再尝试 ping
      let reachable = false;
      const tcpCheck = await runCommand(
        `curl -sf --connect-timeout 3 -o /dev/null "http://${node.host}:${node.gostApiPort || 18080}" 2>/dev/null || ` +
        `bash -c 'echo > /dev/tcp/${node.host}/22' 2>/dev/null || ` +
        `ping -c 1 -W 3 ${node.host} 2>/dev/null`,
        8000,
      );
      reachable = tcpCheck.code === 0;

      if (!reachable && node.status === 'online') {
        logger.warn(`节点 ${node.name} (${node.host}) 不可达`);
      }

      // 如果之前在线现在不可达，标记但不立即离线 (等 OFFLINE_THRESHOLD)
      if (node.status === 'online') {
        db.update(nodes).set({
          systemInfo: JSON.stringify({
            ...(node.systemInfo ? safeJsonParse(node.systemInfo, {}) : {}),
            lastError: `GOST API 不可达: ${err.message}`,
            reachable,
          }),
        }).where(eq(nodes.id, node.id)).run();
      }
    }

    // 4. 检测 3X-UI (如果安装了)
    if (node.xuiInstalled && node.xuiPort) {
      try {
        await axios.get(`http://${node.host}:${node.xuiPort}/`, { timeout: 5000 });
        // 3X-UI 在线
      } catch {
        // 3X-UI 不可达 (不改变节点整体状态)
      }
    }
  }

  private markOfflineNodes() {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD * 1000).toISOString();

    // 排除本机，将超时节点标记为离线
    const offlined = db.update(nodes).set({ status: 'offline' })
      .where(
        sql`${nodes.status} = 'online'
            AND ${nodes.host} != '127.0.0.1'
            AND ${nodes.host} != 'localhost'
            AND ${nodes.host} != '::1'
            AND (${nodes.lastHeartbeat} IS NULL OR ${nodes.lastHeartbeat} < ${threshold})`
      ).run();

    if (offlined.changes > 0) {
      logger.warn(`${offlined.changes} 个节点已标记为离线 (超过 ${OFFLINE_THRESHOLD}s 无心跳)`);
    }
  }

  /**
   * 采集所有规则的流量快照 (每小时调用一次)
   */
  async collectTrafficStats() {
    const hour = new Date().toISOString().slice(0, 13) + ':00:00'; // 2024-03-23T14:00:00

    const rules = db.select().from(forwardRules)
      .where(eq(forwardRules.status, 'active'))
      .all();

    for (const rule of rules) {
      db.insert(trafficStats).values({
        ruleId: rule.id,
        nodeId: rule.nodeId || undefined,
        hour,
        trafficUp: rule.trafficUp || 0,
        trafficDown: rule.trafficDown || 0,
        connections: 0,
      }).run();
    }

    logger.debug(`流量统计快照已记录: ${rules.length} 条规则`);
  }
}

export const healthMonitor = new HealthMonitor();
