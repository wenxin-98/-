// src/routes/bbr.ts
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { networkProbe } from '../services/networkProbe.js';
import { bbrTuner } from '../services/bbrTuner.js';
import { db } from '../db/index.js';
import { opLogs } from '../db/schema.js';

const router = Router();

// ============================
// ===== 网络探测 =====
// ============================

/** GET /api/v1/bbr/probe — 所有节点的最新探测结果 */
router.get('/probe', requireAuth, async (_req: Request, res: Response) => {
  try {
    const results = networkProbe.getAllLatest();
    res.json({ ok: true, data: results });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/bbr/probe/:host — 某节点的探测历史 */
router.get('/probe/:host', requireAuth, async (req: Request, res: Response) => {
  try {
    const host = req.params.host as string;
    const history = networkProbe.getHistory(host);
    const profile = networkProbe.getNetworkProfile(host);
    res.json({ ok: true, data: { history, profile } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/probe/:host — 手动触发一次探测 */
router.post('/probe/:host', requireAuth, async (req: Request, res: Response) => {
  try {
    const host = req.params.host as string;
    const result = await networkProbe.probe(host);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 系统 BBR =====
// ============================

/** GET /api/v1/bbr/system — 系统 BBR 状态 */
router.get('/system', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [status, params] = await Promise.all([
      bbrTuner.getBbrStatus(),
      bbrTuner.getSystemTuneParams(),
    ]);
    res.json({ ok: true, data: { ...status, params } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/system/enable — 启用系统 BBR */
router.post('/system/enable', requireAdmin, async (req: Request, res: Response) => {
  try {
    const profile = (req.body.profile || 'balanced') as 'aggressive' | 'balanced' | 'conservative';
    const result = await bbrTuner.enableSystemBbr(profile);

    db.insert(opLogs).values({
      action: 'enable_system_bbr',
      target: profile,
      detail: JSON.stringify(result),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: result.ok, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 自动调参引擎 =====
// ============================

/** GET /api/v1/bbr/tuner — 调参器状态 */
router.get('/tuner', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = bbrTuner.getStatus();
    res.json({ ok: true, data: status });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/tuner/start — 启动自动调参 */
router.post('/tuner/start', requireAdmin, async (req: Request, res: Response) => {
  try {
    const interval = req.body.intervalMs;
    bbrTuner.startAutoTune(interval);
    // 同时启动网络探测
    networkProbe.start(Math.max(30000, (interval || 120000) / 2));

    db.insert(opLogs).values({
      action: 'start_bbr_tuner',
      target: `interval=${interval || 120000}ms`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '自动调参已启动' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/tuner/stop — 停止自动调参 */
router.post('/tuner/stop', requireAdmin, async (_req: Request, res: Response) => {
  try {
    bbrTuner.stopAutoTune();
    res.json({ ok: true, msg: '自动调参已停止' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/bbr/tuner/history — 调参历史 */
router.get('/tuner/history', requireAuth, async (_req: Request, res: Response) => {
  try {
    const history = bbrTuner.getTuneHistory();
    res.json({ ok: true, data: history });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== KCP Profile 管理 =====
// ============================

/** GET /api/v1/bbr/profiles — 所有预设 Profile */
router.get('/profiles', requireAuth, async (_req: Request, res: Response) => {
  try {
    res.json({
      ok: true,
      data: {
        kcp: bbrTuner.getKcpProfiles(),
        sysctl: bbrTuner.getSysctlProfiles(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/kcp/:serviceName — 手动设置 KCP Profile */
router.post('/kcp/:serviceName', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { serviceName } = req.params;
    const { profile } = req.body;
    if (!profile) return res.status(400).json({ ok: false, msg: '缺少 profile 参数' });

    const ok = await bbrTuner.manualSetKcpProfile(serviceName as string, profile);

    db.insert(opLogs).values({
      action: 'manual_kcp_profile',
      target: `${serviceName} → ${profile}`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok, msg: ok ? `已应用 ${profile}` : '应用失败' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/recommend/:host — 获取某节点的推荐参数 */
router.post('/recommend/:host', requireAuth, async (req: Request, res: Response) => {
  try {
    const host = req.params.host as string;

    // 先执行一次探测
    const probeResult = await networkProbe.probe(host);
    const profile = networkProbe.getNetworkProfile(host);
    const net = profile || {
      rtt: probeResult.rttAvg,
      loss: probeResult.packetLoss,
      jitter: probeResult.jitter,
      bandwidth: probeResult.bandwidth,
    };

    // 生成推荐
    const kcpProfile = bbrTuner.selectKcpProfile(net.rtt, net.loss, net.jitter, net.bandwidth);
    const hy2Bandwidth = bbrTuner.selectHy2Bandwidth(net.rtt, net.loss, net.bandwidth);
    const tuicCongestion = bbrTuner.selectTuicCongestion(net.rtt, net.loss);

    const sysctlProfile = net.loss > 3 ? 'conservative'
      : net.rtt > 150 ? 'aggressive'
      : 'balanced';

    res.json({
      ok: true,
      data: {
        network: net,
        probe: probeResult,
        recommendations: {
          systemBbr: sysctlProfile,
          kcpProfile: kcpProfile.name,
          kcpParams: kcpProfile,
          hysteria2: hy2Bandwidth,
          tuicCongestion,
          explanation: generateExplanation(net, kcpProfile.name, sysctlProfile),
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

function generateExplanation(net: any, kcpName: string, sysctlName: string): string {
  const parts: string[] = [];

  if (net.rtt < 50) parts.push(`低延迟 (${net.rtt}ms)`);
  else if (net.rtt < 150) parts.push(`中等延迟 (${net.rtt}ms)`);
  else parts.push(`高延迟 (${net.rtt}ms)，建议使用 BBR aggressive`);

  if (net.loss > 5) parts.push(`高丢包 (${net.loss}%)，启用 FEC 冗余`);
  else if (net.loss > 1) parts.push(`轻微丢包 (${net.loss}%)，适度冗余`);

  if (net.jitter > 100) parts.push(`高抖动 (${net.jitter}ms)，降低 KCP interval`);

  parts.push(`推荐: KCP=${kcpName}, BBR=${sysctlName}`);

  return parts.join('。');
}

// ============================
// ===== 远程节点 BBR =====
// ============================

/** POST /api/v1/bbr/remote/:nodeId — SSH 远程启用 BBR */
router.post('/remote/:nodeId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const nodeId = parseInt(req.params.nodeId as string);
    const { sshPassword, sshKeyPath, profile } = req.body;

    if (!profile) return res.status(400).json({ ok: false, msg: '缺少 profile 参数' });

    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    const result = await nodeDeployService.pushBbrToNode({
      nodeId,
      sshPassword,
      sshKeyPath,
      profile,
    });

    db.insert(opLogs).values({
      action: 'remote_enable_bbr',
      target: `nodeId=${nodeId} profile=${profile}`,
      detail: JSON.stringify({ log: result.log }),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: result.ok, data: { log: result.log } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/bbr/remote-all — 批量推送 BBR 到所有在线节点 */
router.post('/remote-all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { sshPassword, sshKeyPath, profile } = req.body;
    if (!profile) return res.status(400).json({ ok: false, msg: '缺少 profile 参数' });

    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    const results = await nodeDeployService.pushBbrToAllNodes({
      sshPassword,
      sshKeyPath,
      profile,
    });

    db.insert(opLogs).values({
      action: 'remote_enable_bbr_all',
      target: `${results.length} 节点, profile=${profile}`,
      detail: JSON.stringify(results),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    const successCount = results.filter(r => r.ok).length;
    res.json({
      ok: true,
      data: { results, successCount, totalCount: results.length },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
