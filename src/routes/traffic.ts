// src/routes/traffic.ts
import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { trafficStats, forwardRules } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { eq, desc, sql, gte } from 'drizzle-orm';

const router = Router();

/** GET /api/v1/traffic/summary — 流量汇总 (图表用) */
router.get('/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '24h';
    
    let hoursBack: number;
    switch (range) {
      case '1h': hoursBack = 1; break;
      case '6h': hoursBack = 6; break;
      case '24h': hoursBack = 24; break;
      case '7d': hoursBack = 168; break;
      case '30d': hoursBack = 720; break;
      default: hoursBack = 24;
    }

    const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

    const stats = db.select({
      hour: trafficStats.hour,
      totalUp: sql<number>`SUM(${trafficStats.trafficUp})`,
      totalDown: sql<number>`SUM(${trafficStats.trafficDown})`,
      totalConn: sql<number>`SUM(${trafficStats.connections})`,
    })
      .from(trafficStats)
      .where(gte(trafficStats.hour, since))
      .groupBy(trafficStats.hour)
      .orderBy(trafficStats.hour)
      .all();

    res.json({ ok: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/traffic/by-rule — 按规则维度的流量排行 */
router.get('/by-rule', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rules = db.select({
      id: forwardRules.id,
      name: forwardRules.name,
      type: forwardRules.type,
      source: forwardRules.source,
      status: forwardRules.status,
      trafficUp: forwardRules.trafficUp,
      trafficDown: forwardRules.trafficDown,
    })
      .from(forwardRules)
      .orderBy(desc(sql`${forwardRules.trafficUp} + ${forwardRules.trafficDown}`))
      .limit(20)
      .all();

    const total = rules.reduce((acc, r) => ({
      up: acc.up + (r.trafficUp || 0),
      down: acc.down + (r.trafficDown || 0),
    }), { up: 0, down: 0 });

    res.json({ ok: true, data: { rules, total } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/traffic/by-node — 按节点维度的流量 */
router.get('/by-node', requireAuth, async (_req: Request, res: Response) => {
  try {
    const nodeStats = db.select({
      nodeId: forwardRules.nodeId,
      totalUp: sql<number>`SUM(${forwardRules.trafficUp})`,
      totalDown: sql<number>`SUM(${forwardRules.trafficDown})`,
      ruleCount: sql<number>`COUNT(*)`,
    })
      .from(forwardRules)
      .groupBy(forwardRules.nodeId)
      .all();

    res.json({ ok: true, data: nodeStats });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
