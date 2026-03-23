// src/services/networkProbe.ts
import { runCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { nodes, forwardRules } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * 网络质量探测器
 *
 * 定时采集各节点/隧道端点的:
 *   - RTT (往返延迟)
 *   - 丢包率
 *   - 可用带宽估算
 *   - 抖动 (jitter)
 *
 * 数据用于 BBR 自适应调参
 */

export interface ProbeResult {
  target: string;
  rttMin: number;     // ms
  rttAvg: number;     // ms
  rttMax: number;     // ms
  jitter: number;     // ms (rttMax - rttMin)
  packetLoss: number; // 百分比 0-100
  bandwidth: number;  // Mbps 估算
  timestamp: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'bad';
}

export interface ProbeHistory {
  target: string;
  results: ProbeResult[];
  trend: 'improving' | 'stable' | 'degrading';
}

// 存储最近 60 次探测 (每分钟一次 = 1 小时历史)
const probeCache = new Map<string, ProbeResult[]>();
const MAX_HISTORY = 60;

class NetworkProbeService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private probeInterval = 60000;  // 默认 60 秒
  private targets: string[] = [];

  /**
   * 启动探测 (自动从节点表获取目标)
   */
  start(intervalMs?: number) {
    if (intervalMs) this.probeInterval = intervalMs;
    if (this.timer) return;

    logger.info(`网络探测启动 (间隔 ${this.probeInterval / 1000}s)`);
    this.timer = setInterval(() => this.probeAll(), this.probeInterval);
    // 立即执行一次
    setTimeout(() => this.probeAll(), 3000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 手动添加探测目标
   */
  addTarget(host: string) {
    if (!this.targets.includes(host)) {
      this.targets.push(host);
    }
  }

  /**
   * 探测所有目标
   */
  async probeAll() {
    // 从节点表获取在线节点
    const allNodes = db.select().from(nodes)
      .all()
      .filter(n => n.host !== '127.0.0.1' && n.host !== 'localhost' && n.host !== '::1');

    // 从转发规则获取目标地址
    const allRules = db.select().from(forwardRules)
      .where(eq(forwardRules.status, 'active'))
      .all();

    const targetHosts = allRules
      .map(r => (r.targetAddr || '').split(':')[0])
      .filter(h => h && h !== '127.0.0.1' && h !== 'localhost' && h !== '::1' && h !== '0.0.0.0');

    const hosts = [
      ...new Set([
        ...allNodes.map(n => n.host),
        ...targetHosts,
        ...this.targets,
      ]),
    ];

    if (hosts.length === 0) {
      // 没有任何目标时，至少探测公共 DNS 以获取基线数据
      hosts.push('1.1.1.1');
    }

    const results = await Promise.allSettled(
      hosts.map(host => this.probe(host))
    );

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        this.recordResult(hosts[i], r.value);
      }
    });
  }

  /**
   * 单次探测
   */
  async probe(target: string): Promise<ProbeResult> {
    const [pingResult, bwResult] = await Promise.allSettled([
      this.measurePing(target),
      this.estimateBandwidth(target),
    ]);

    const ping = pingResult.status === 'fulfilled' ? pingResult.value : {
      rttMin: 999, rttAvg: 999, rttMax: 999, packetLoss: 100,
    };

    const bandwidth = bwResult.status === 'fulfilled' ? bwResult.value : 0;

    const jitter = ping.rttMax - ping.rttMin;

    const result: ProbeResult = {
      target,
      rttMin: ping.rttMin,
      rttAvg: ping.rttAvg,
      rttMax: ping.rttMax,
      jitter,
      packetLoss: ping.packetLoss,
      bandwidth,
      timestamp: Date.now(),
      quality: this.classifyQuality(ping.rttAvg, ping.packetLoss, jitter),
    };

    return result;
  }

  /**
   * 延迟 + 丢包测量
   * 优先 ping (ICMP)，失败回退到 TCP 连接探测
   */
  private async measurePing(target: string, count = 10): Promise<{
    rttMin: number; rttAvg: number; rttMax: number; packetLoss: number;
    method: 'icmp' | 'tcp';
  }> {
    // 方法1: ICMP ping
    const result = await runCommand(
      `ping -c ${count} -W 3 -i 0.2 ${target} 2>/dev/null`,
      15000,
    );

    if (result.code === 0 && result.stdout.includes('rtt')) {
      const rttMatch = result.stdout.match(
        /rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/
      );
      const lossMatch = result.stdout.match(/([\d.]+)% packet loss/);

      if (rttMatch) {
        return {
          rttMin: parseFloat(rttMatch[1]),
          rttAvg: parseFloat(rttMatch[2]),
          rttMax: parseFloat(rttMatch[3]),
          packetLoss: lossMatch ? parseFloat(lossMatch[1]) : 0,
          method: 'icmp',
        };
      }
    }

    // 方法2: TCP 连接探测 (禁 ping 环境)
    return this.measureTcp(target, count);
  }

  /**
   * TCP 连接探测 — 用于禁 ping 环境
   * 尝试连接目标的常用端口测量 RTT
   */
  private async measureTcp(target: string, count = 5): Promise<{
    rttMin: number; rttAvg: number; rttMax: number; packetLoss: number;
    method: 'tcp';
  }> {
    // 尝试多个端口: 443 (HTTPS), 80 (HTTP), 22 (SSH)
    const ports = [443, 80, 22];
    let workingPort = 0;

    for (const port of ports) {
      const test = await runCommand(
        `bash -c 'echo > /dev/tcp/${target}/${port}' 2>/dev/null`,
        3000,
      );
      if (test.code === 0) { workingPort = port; break; }

      // 备选: 用 curl 测试
      const curlTest = await runCommand(
        `curl -sf --connect-timeout 2 -o /dev/null -w '%{time_connect}' "http://${target}:${port}" 2>/dev/null || curl -sf --connect-timeout 2 -o /dev/null -w '%{time_connect}' "https://${target}:${port}" 2>/dev/null`,
        5000,
      );
      if (curlTest.code === 0 && curlTest.stdout) { workingPort = port; break; }
    }

    if (!workingPort) {
      return { rttMin: 999, rttAvg: 999, rttMax: 999, packetLoss: 100, method: 'tcp' };
    }

    // 多次 TCP 连接采样
    const rtts: number[] = [];
    let failures = 0;

    for (let i = 0; i < count; i++) {
      const start = Date.now();
      const r = await runCommand(
        `curl -sf --connect-timeout 3 -o /dev/null -w '%{time_connect}' "https://${target}:${workingPort}" 2>/dev/null`,
        5000,
      );
      const elapsed = Date.now() - start;

      if (r.code === 0 && r.stdout) {
        const connectTime = parseFloat(r.stdout) * 1000; // 秒 → 毫秒
        if (connectTime > 0) { rtts.push(connectTime); continue; }
      }
      // curl 失败，用 elapsed 近似
      if (elapsed < 3000) {
        rtts.push(elapsed);
      } else {
        failures++;
      }
    }

    if (rtts.length === 0) {
      return { rttMin: 999, rttAvg: 999, rttMax: 999, packetLoss: 100, method: 'tcp' };
    }

    const sorted = rtts.sort((a, b) => a - b);
    return {
      rttMin: Math.round(sorted[0] * 10) / 10,
      rttAvg: Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length * 10) / 10,
      rttMax: Math.round(sorted[sorted.length - 1] * 10) / 10,
      packetLoss: Math.round(failures / count * 100 * 100) / 100,
      method: 'tcp',
    };
  }

  /**
   * 带宽估算 (基于 TCP 窗口大小和 RTT)
   * BDP = Window / RTT
   */
  private async estimateBandwidth(target: string): Promise<number> {
    // 方法1: 用 ss 获取当前到目标的 TCP 连接窗口
    const ssResult = await runCommand(
      `ss -ti dst ${target} 2>/dev/null | head -20`,
      5000,
    );

    if (ssResult.stdout) {
      // 解析 cwnd 和 rtt
      const cwndMatch = ssResult.stdout.match(/cwnd:(\d+)/);
      const rttMatch = ssResult.stdout.match(/rtt:([\d.]+)\//);
      const mssMatch = ssResult.stdout.match(/mss:(\d+)/);

      if (cwndMatch && rttMatch) {
        const cwnd = parseInt(cwndMatch[1]);
        const rtt = parseFloat(rttMatch[1]); // ms
        const mss = mssMatch ? parseInt(mssMatch[1]) : 1448;

        if (rtt > 0) {
          // BDP (bits) = cwnd * mss * 8 / (rtt / 1000)
          const bwBps = (cwnd * mss * 8) / (rtt / 1000);
          return Math.round(bwBps / 1_000_000 * 100) / 100; // Mbps
        }
      }
    }

    // 方法2: 基于 RTT 粗略估算
    const ping = await this.measurePing(target, 3);
    if (ping.rttAvg < 999) {
      // 经验公式: 典型带宽 ≈ 1000 / RTT (非常粗略)
      return Math.min(1000, Math.round(1000 / ping.rttAvg));
    }

    return 0;
  }

  /**
   * 网络质量分级
   */
  private classifyQuality(
    rttAvg: number, packetLoss: number, jitter: number
  ): ProbeResult['quality'] {
    if (packetLoss > 10 || rttAvg > 500) return 'bad';
    if (packetLoss > 5 || rttAvg > 300 || jitter > 200) return 'poor';
    if (packetLoss > 2 || rttAvg > 150 || jitter > 100) return 'fair';
    if (packetLoss > 0.5 || rttAvg > 80 || jitter > 50) return 'good';
    return 'excellent';
  }

  /**
   * 记录探测结果
   */
  private recordResult(target: string, result: ProbeResult) {
    if (!probeCache.has(target)) {
      probeCache.set(target, []);
    }
    const history = probeCache.get(target)!;
    history.push(result);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  }

  // ===== 查询接口 =====

  /**
   * 获取最新探测结果
   */
  getLatest(target: string): ProbeResult | null {
    const history = probeCache.get(target);
    return history?.length ? history[history.length - 1] : null;
  }

  /**
   * 获取所有目标的最新结果
   */
  getAllLatest(): ProbeResult[] {
    const results: ProbeResult[] = [];
    for (const [_target, history] of probeCache) {
      if (history.length > 0) {
        results.push(history[history.length - 1]);
      }
    }
    return results;
  }

  /**
   * 获取探测历史
   */
  getHistory(target: string): ProbeHistory | null {
    const results = probeCache.get(target);
    if (!results || results.length === 0) return null;

    // 计算趋势: 最近 5 次 vs 之前 5 次的 RTT 对比
    const recent = results.slice(-5);
    const prev = results.slice(-10, -5);

    let trend: ProbeHistory['trend'] = 'stable';
    if (prev.length >= 3 && recent.length >= 3) {
      const recentAvg = recent.reduce((a, r) => a + r.rttAvg, 0) / recent.length;
      const prevAvg = prev.reduce((a, r) => a + r.rttAvg, 0) / prev.length;
      const delta = (recentAvg - prevAvg) / prevAvg;

      if (delta < -0.1) trend = 'improving';
      else if (delta > 0.15) trend = 'degrading';
    }

    return { target, results, trend };
  }

  /**
   * 获取用于 BBR 调参的网络概况
   */
  getNetworkProfile(target: string): {
    rtt: number;
    loss: number;
    jitter: number;
    bandwidth: number;
    quality: string;
    trend: string;
    sampleCount: number;
  } | null {
    const history = this.getHistory(target);
    if (!history || history.results.length === 0) return null;

    // 取最近 10 次的加权平均 (越新权重越高)
    const recent = history.results.slice(-10);
    let totalWeight = 0;
    let wRtt = 0, wLoss = 0, wJitter = 0, wBw = 0;

    recent.forEach((r, i) => {
      const weight = i + 1; // 越新权重越大
      wRtt += r.rttAvg * weight;
      wLoss += r.packetLoss * weight;
      wJitter += r.jitter * weight;
      wBw += r.bandwidth * weight;
      totalWeight += weight;
    });

    return {
      rtt: Math.round(wRtt / totalWeight * 10) / 10,
      loss: Math.round(wLoss / totalWeight * 100) / 100,
      jitter: Math.round(wJitter / totalWeight * 10) / 10,
      bandwidth: Math.round(wBw / totalWeight * 100) / 100,
      quality: recent[recent.length - 1].quality,
      trend: history.trend,
      sampleCount: recent.length,
    };
  }
}

export const networkProbe = new NetworkProbeService();
