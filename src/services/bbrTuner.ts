// src/services/bbrTuner.ts
import { runCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';
import { networkProbe, type ProbeResult } from './networkProbe.js';
import { gostApi } from './gostService.js';
import { db } from '../db/index.js';
import { forwardRules, nodes } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * 动态 BBR 自适应调参器
 *
 * 三层调节:
 *   1. 系统内核 — TCP BBR 启用 + sysctl 参数自动优化
 *   2. GOST 隧道 — KCP/QUIC 拥塞窗口/重传参数实时调整
 *   3. Xray 协议 — Hysteria2 带宽/TUIC 拥塞控制器切换
 *
 * 调节策略:
 *   根据 networkProbe 探测的 RTT / 丢包率 / 抖动 / 带宽
 *   自动选择最优参数组合，每 2 分钟评估一次
 */

// ===== 配置 Profile 定义 =====

interface KcpProfile {
  name: string;
  /** 数据分片 */
  dataShards: number;
  /** 校验分片 */
  parityShards: number;
  /** 发送窗口 */
  sndWnd: number;
  /** 接收窗口 */
  rcvWnd: number;
  /** MTU */
  mtu: number;
  /** 是否无延迟模式 */
  noDelay: boolean;
  /** 更新间隔 ms */
  interval: number;
  /** 重传容忍度 */
  resend: number;
  /** 是否关闭拥塞控制 (高丢包时) */
  noCongestion: boolean;
}

interface SysctlProfile {
  name: string;
  params: Record<string, string>;
}

// ===== 预设 Profile =====

const KCP_PROFILES: Record<string, KcpProfile> = {
  // 极低延迟 (局域网/近距)
  ultra_low_latency: {
    name: 'ultra_low_latency',
    dataShards: 10, parityShards: 3,
    sndWnd: 2048, rcvWnd: 2048, mtu: 1400,
    noDelay: true, interval: 10, resend: 2, noCongestion: true,
  },
  // 低延迟 (同区域)
  low_latency: {
    name: 'low_latency',
    dataShards: 10, parityShards: 3,
    sndWnd: 1024, rcvWnd: 1024, mtu: 1350,
    noDelay: true, interval: 20, resend: 2, noCongestion: false,
  },
  // 均衡 (跨区域)
  balanced: {
    name: 'balanced',
    dataShards: 10, parityShards: 3,
    sndWnd: 512, rcvWnd: 512, mtu: 1350,
    noDelay: true, interval: 30, resend: 2, noCongestion: false,
  },
  // 高丢包抗性 (跨洲/差网络)
  high_loss_resist: {
    name: 'high_loss_resist',
    dataShards: 10, parityShards: 5,  // 更多冗余
    sndWnd: 256, rcvWnd: 256, mtu: 1200,
    noDelay: true, interval: 10, resend: 1, noCongestion: true,
  },
  // 带宽优先 (低丢包大带宽)
  bandwidth_priority: {
    name: 'bandwidth_priority',
    dataShards: 10, parityShards: 2,  // 最小冗余
    sndWnd: 4096, rcvWnd: 4096, mtu: 1400,
    noDelay: false, interval: 40, resend: 3, noCongestion: false,
  },
};

const SYSCTL_PROFILES: Record<string, SysctlProfile> = {
  bbr_aggressive: {
    name: 'bbr_aggressive',
    params: {
      'net.core.default_qdisc': 'fq',
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.rmem_max': '67108864',
      'net.core.wmem_max': '67108864',
      'net.ipv4.tcp_rmem': '4096 87380 67108864',
      'net.ipv4.tcp_wmem': '4096 65536 67108864',
      'net.ipv4.tcp_mtu_probing': '1',
      'net.ipv4.tcp_fastopen': '3',
      'net.ipv4.tcp_slow_start_after_idle': '0',
      'net.ipv4.tcp_notsent_lowat': '16384',
      'net.core.netdev_max_backlog': '10000',
      'net.ipv4.tcp_max_syn_backlog': '8192',
      'net.ipv4.tcp_tw_reuse': '1',
      'net.ipv4.ip_local_port_range': '1024 65535',
    },
  },
  bbr_balanced: {
    name: 'bbr_balanced',
    params: {
      'net.core.default_qdisc': 'fq',
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.rmem_max': '33554432',
      'net.core.wmem_max': '33554432',
      'net.ipv4.tcp_rmem': '4096 87380 33554432',
      'net.ipv4.tcp_wmem': '4096 65536 33554432',
      'net.ipv4.tcp_mtu_probing': '1',
      'net.ipv4.tcp_fastopen': '3',
      'net.ipv4.tcp_slow_start_after_idle': '0',
    },
  },
  bbr_conservative: {
    name: 'bbr_conservative',
    params: {
      'net.core.default_qdisc': 'fq',
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.rmem_max': '16777216',
      'net.core.wmem_max': '16777216',
      'net.ipv4.tcp_rmem': '4096 87380 16777216',
      'net.ipv4.tcp_wmem': '4096 65536 16777216',
      'net.ipv4.tcp_mtu_probing': '1',
    },
  },
};

// ===== 主服务 =====

class BbrTunerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private tuneInterval = 120000; // 默认 2 分钟评估一次
  private enabled = false;
  private currentSysctlProfile: string = '';
  private nodeProfiles = new Map<string, string>();  // nodeHost → kcpProfileName
  private tuneHistory: Array<{
    timestamp: number;
    target: string;
    action: string;
    from: string;
    to: string;
    reason: string;
  }> = [];

  // =============================
  // ===== 1. 系统内核 BBR =====
  // =============================

  /**
   * 检测系统 BBR 状态
   */
  async getBbrStatus(): Promise<{
    available: boolean;
    enabled: boolean;
    congestionControl: string;
    qdisc: string;
    kernelModules: string[];
  }> {
    const [cc, qdisc, modules] = await Promise.all([
      runCommand("sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null"),
      runCommand("sysctl -n net.core.default_qdisc 2>/dev/null"),
      runCommand("sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null"),
    ]);

    const availableModules = modules.stdout.trim().split(/\s+/);

    return {
      available: availableModules.includes('bbr'),
      enabled: cc.stdout.trim() === 'bbr',
      congestionControl: cc.stdout.trim(),
      qdisc: qdisc.stdout.trim(),
      kernelModules: availableModules,
    };
  }

  /**
   * 启用系统 BBR + 优化 sysctl 参数
   */
  async enableSystemBbr(profile: 'aggressive' | 'balanced' | 'conservative' = 'balanced'): Promise<{
    ok: boolean;
    applied: string[];
    errors: string[];
  }> {
    const profileKey = `bbr_${profile}`;
    const sysctlProfile = SYSCTL_PROFILES[profileKey];
    if (!sysctlProfile) throw new Error(`未知 profile: ${profile}`);

    // 先检查 BBR 内核模块
    const status = await this.getBbrStatus();
    if (!status.available) {
      // 尝试加载模块
      await runCommand('modprobe tcp_bbr 2>/dev/null');
      const recheck = await this.getBbrStatus();
      if (!recheck.available) {
        return { ok: false, applied: [], errors: ['内核不支持 BBR (需要 Linux 4.9+)'] };
      }
    }

    const applied: string[] = [];
    const errors: string[] = [];

    for (const [key, value] of Object.entries(sysctlProfile.params)) {
      const result = await runCommand(`sysctl -w "${key}=${value}" 2>&1`);
      if (result.code === 0) {
        applied.push(`${key}=${value}`);
      } else {
        errors.push(`${key}: ${result.stderr}`);
      }
    }

    // 持久化到 sysctl.conf
    if (applied.length > 0) {
      const confLines = applied.map(a => a).join('\n');
      await runCommand(`
        # 备份
        cp /etc/sysctl.conf /etc/sysctl.conf.bak.$(date +%s) 2>/dev/null
        # 移除旧的面板配置
        sed -i '/# unified-panel-bbr/,/# end-unified-panel-bbr/d' /etc/sysctl.conf
        # 追加新配置
        echo "# unified-panel-bbr" >> /etc/sysctl.conf
        echo "${confLines}" >> /etc/sysctl.conf
        echo "# end-unified-panel-bbr" >> /etc/sysctl.conf
      `);
    }

    this.currentSysctlProfile = profileKey;
    logger.info(`系统 BBR 已启用: ${profile} (${applied.length} 参数生效, ${errors.length} 失败)`);

    this.recordTune('system', 'enable_bbr', this.currentSysctlProfile, profileKey,
      `RTT/丢包 → 选择 ${profile} 策略`);

    return { ok: errors.length === 0, applied, errors };
  }

  /**
   * 获取当前系统 sysctl 网络参数
   */
  async getSystemTuneParams(): Promise<Record<string, string>> {
    const keys = [
      'net.ipv4.tcp_congestion_control',
      'net.core.default_qdisc',
      'net.core.rmem_max',
      'net.core.wmem_max',
      'net.ipv4.tcp_rmem',
      'net.ipv4.tcp_wmem',
      'net.ipv4.tcp_mtu_probing',
      'net.ipv4.tcp_fastopen',
      'net.ipv4.tcp_slow_start_after_idle',
      'net.ipv4.tcp_notsent_lowat',
    ];

    const params: Record<string, string> = {};
    for (const key of keys) {
      const result = await runCommand(`sysctl -n ${key} 2>/dev/null`);
      params[key] = result.stdout.trim();
    }
    return params;
  }

  // =============================================
  // ===== 2. GOST KCP/QUIC 隧道动态调参 =====
  // =============================================

  /**
   * 根据网络质量选择最优 KCP Profile
   */
  selectKcpProfile(rtt: number, loss: number, jitter: number, bandwidth: number): KcpProfile {
    // 决策树
    if (loss > 5 || jitter > 150) {
      return KCP_PROFILES.high_loss_resist;
    }
    if (rtt < 20 && loss < 0.5 && jitter < 10) {
      return KCP_PROFILES.ultra_low_latency;
    }
    if (rtt < 80 && loss < 1) {
      return bandwidth > 100
        ? KCP_PROFILES.bandwidth_priority
        : KCP_PROFILES.low_latency;
    }
    return KCP_PROFILES.balanced;
  }

  /**
   * 将 KCP Profile 应用到指定的 GOST 隧道
   *
   * GOST v3 KCP 配置通过 metadata 传递:
   *   listener.metadata: { mtu, sndWnd, rcvWnd, ... }
   */
  async applyKcpProfile(serviceName: string, profile: KcpProfile): Promise<boolean> {
    try {
      await gostApi.updateService(serviceName, {
        name: serviceName,
        addr: '', // 保持不变
        handler: { type: 'relay' },
        listener: {
          type: 'kcp',
          metadata: {
            'kcp.mtu': String(profile.mtu),
            'kcp.sndwnd': String(profile.sndWnd),
            'kcp.rcvwnd': String(profile.rcvWnd),
            'kcp.nodelay': profile.noDelay ? '1' : '0',
            'kcp.interval': String(profile.interval),
            'kcp.resend': String(profile.resend),
            'kcp.nc': profile.noCongestion ? '1' : '0',
            'kcp.datashard': String(profile.dataShards),
            'kcp.parityshard': String(profile.parityShards),
          },
        },
      });
      logger.info(`KCP 参数已更新: ${serviceName} → ${profile.name}`);
      return true;
    } catch (err: any) {
      logger.error(`KCP 调参失败 ${serviceName}: ${err.message}`);
      return false;
    }
  }

  /**
   * 选择最优 Hysteria2 带宽参数
   */
  selectHy2Bandwidth(rtt: number, loss: number, bandwidth: number): {
    upMbps: number; downMbps: number;
  } {
    // Hysteria2 的带宽参数影响 QUIC 拥塞窗口初始大小
    // 设得太高会导致初始突发丢包，太低会限制吞吐
    let factor: number;

    if (loss > 5) {
      factor = 0.3; // 高丢包环境，保守
    } else if (loss > 2) {
      factor = 0.5;
    } else if (rtt > 200) {
      factor = 0.6; // 高延迟，适度保守
    } else if (rtt > 100) {
      factor = 0.75;
    } else {
      factor = 0.9; // 低延迟低丢包，接近满速
    }

    const estimatedBw = bandwidth > 0 ? bandwidth : 100; // 默认假设 100Mbps
    const upMbps = Math.max(10, Math.round(estimatedBw * factor * 0.8));
    const downMbps = Math.max(20, Math.round(estimatedBw * factor));

    return { upMbps, downMbps };
  }

  /**
   * 选择最优 TUIC 拥塞控制算法
   */
  selectTuicCongestion(rtt: number, loss: number): string {
    // BBR: 高带宽高延迟场景最优
    // Cubic: 低延迟低丢包传统场景
    // New Reno: 高丢包场景回退选择
    if (loss > 3) return 'new_reno';
    if (rtt > 100) return 'bbr';
    return 'cubic';
  }

  // ===================================
  // ===== 3. 自动调参引擎 =====
  // ===================================

  /**
   * 启动自动调参
   */
  startAutoTune(intervalMs?: number) {
    if (intervalMs) this.tuneInterval = intervalMs;
    this.enabled = true;

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.autoTuneAll(), this.tuneInterval);

    logger.info(`BBR 自动调参已启动 (间隔 ${this.tuneInterval / 1000}s)`);
  }

  stopAutoTune() {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('BBR 自动调参已停止');
  }

  /**
   * 对所有活跃隧道执行一次调参评估
   */
  async autoTuneAll() {
    if (!this.enabled) return;

    // 获取所有活跃的 GOST 隧道规则
    const tunnelRules = db.select().from(forwardRules)
      .where(eq(forwardRules.status, 'active'))
      .all()
      .filter(r => r.type.startsWith('tunnel-') && r.gostServiceName);

    for (const rule of tunnelRules) {
      const targetHost = rule.targetAddr?.split(':')[0];
      if (!targetHost) continue;

      const profile = networkProbe.getNetworkProfile(targetHost);
      if (!profile || profile.sampleCount < 3) continue; // 数据不足跳过

      await this.tuneRule(rule, profile);
    }
  }

  /**
   * 对单条规则执行调参
   */
  private async tuneRule(rule: any, profile: {
    rtt: number; loss: number; jitter: number; bandwidth: number;
    quality: string; trend: string;
  }) {
    const type = rule.type;

    if (type === 'tunnel-kcp') {
      const currentProfile = this.nodeProfiles.get(rule.gostServiceName) || 'balanced';
      const optimalProfile = this.selectKcpProfile(
        profile.rtt, profile.loss, profile.jitter, profile.bandwidth
      );

      if (optimalProfile.name !== currentProfile) {
        const ok = await this.applyKcpProfile(rule.gostServiceName!, optimalProfile);
        if (ok) {
          this.nodeProfiles.set(rule.gostServiceName!, optimalProfile.name);
          this.recordTune(rule.gostServiceName!, 'kcp_profile', currentProfile, optimalProfile.name,
            `RTT=${profile.rtt}ms loss=${profile.loss}% jitter=${profile.jitter}ms bw=${profile.bandwidth}Mbps`);
        }
      }
    }

    // 对 mWSS/mTLS 隧道: 可调缓冲区大小
    if (type === 'tunnel-mwss' || type === 'tunnel-mtls') {
      // 高延迟时增大缓冲区
      const bufSize = profile.rtt > 200 ? 4096 : profile.rtt > 100 ? 2048 : 1024;
      // GOST v3 mwss/mtls 通过 metadata 传递
      try {
        await gostApi.updateService(rule.gostServiceName!, {
          name: rule.gostServiceName!,
          addr: '',
          handler: { type: 'relay' },
          listener: {
            type: type.replace('tunnel-', ''),
            metadata: {
              'mux.maxStreamBuffer': String(bufSize),
            },
          },
        });
      } catch {}
    }
  }

  /**
   * 记录调参历史
   */
  private recordTune(target: string, action: string, from: string, to: string, reason: string) {
    this.tuneHistory.push({
      timestamp: Date.now(),
      target, action, from, to, reason,
    });
    // 最多保留 200 条
    if (this.tuneHistory.length > 200) {
      this.tuneHistory = this.tuneHistory.slice(-200);
    }
  }

  // ===== 查询接口 =====

  getStatus() {
    return {
      enabled: this.enabled,
      tuneInterval: this.tuneInterval,
      currentSysctlProfile: this.currentSysctlProfile,
      nodeProfiles: Object.fromEntries(this.nodeProfiles),
      recentTunes: this.tuneHistory.slice(-20),
    };
  }

  getTuneHistory() {
    return this.tuneHistory;
  }

  getKcpProfiles() {
    return KCP_PROFILES;
  }

  getSysctlProfiles() {
    return SYSCTL_PROFILES;
  }

  /**
   * 手动指定某隧道的 KCP Profile
   */
  async manualSetKcpProfile(serviceName: string, profileName: string): Promise<boolean> {
    const profile = KCP_PROFILES[profileName];
    if (!profile) throw new Error(`未知 KCP Profile: ${profileName}`);

    const ok = await this.applyKcpProfile(serviceName, profile);
    if (ok) {
      this.nodeProfiles.set(serviceName, profileName);
      this.recordTune(serviceName, 'manual_kcp', '', profileName, '手动设置');
    }
    return ok;
  }
}

export const bbrTuner = new BbrTunerService();
