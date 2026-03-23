// src/routes/dashboard.ts
import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { forwardRules, tunnelChains, nodes, opLogs } from '../db/schema.js';
import { gostApi } from '../services/gostService.js';
import { xuiApi } from '../services/xuiService.js';
import { requireAuth } from '../middleware/auth.js';
import { getSystemInfo } from '../utils/shell.js';
import { eq, desc, sql, count } from 'drizzle-orm';
import { ENV } from '../config.js';

const router = Router();

/** GET /api/v1/dashboard/overview — 面板总览 */
router.get('/overview', requireAuth, async (_req: Request, res: Response) => {
  try {
    // 并行获取各项数据
    const [
      systemInfo,
      gostStatus,
      xuiStatus,
      ruleStats,
      chainCount,
      nodeStats,
      recentLogs,
    ] = await Promise.allSettled([
      getSystemInfo(),
      safeCall(() => gostApi.checkConnection()),
      safeCall(() => xuiApi.checkConnection()),
      db.select({
        total: count(),
        active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
        stopped: sql<number>`SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END)`,
        totalUp: sql<number>`SUM(traffic_up)`,
        totalDown: sql<number>`SUM(traffic_down)`,
      }).from(forwardRules).get(),
      db.select({ count: count() }).from(tunnelChains).get(),
      db.select({
        total: count(),
        online: sql<number>`SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END)`,
      }).from(nodes).get(),
      db.select().from(opLogs).orderBy(desc(opLogs.createdAt)).limit(10).all(),
    ]);

    res.json({
      ok: true,
      data: {
        system: unwrap(systemInfo),
        gostConnected: unwrap(gostStatus) || false,
        xuiConnected: unwrap(xuiStatus) || false,
        rules: unwrap(ruleStats) || { total: 0, active: 0, stopped: 0, totalUp: 0, totalDown: 0 },
        chainCount: unwrap(chainCount)?.count || 0,
        nodes: unwrap(nodeStats) || { total: 0, online: 0 },
        recentLogs: unwrap(recentLogs) || [],
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/dashboard/system — 系统信息 */
router.get('/system', requireAuth, async (_req: Request, res: Response) => {
  try {
    const info = await getSystemInfo();
    res.json({ ok: true, data: info });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/dashboard/logs — 操作日志 */
router.get('/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    const logs = db
      .select()
      .from(opLogs)
      .orderBy(desc(opLogs.createdAt))
      .limit(pageSize)
      .offset(offset)
      .all();

    const totalResult = db.select({ count: count() }).from(opLogs).get();

    res.json({
      ok: true,
      data: {
        list: logs,
        total: totalResult?.count || 0,
        page,
        pageSize,
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// 辅助函数
async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

function unwrap<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

/** GET /api/v1/dashboard/port-range — NAT 端口范围配置 */
router.get('/port-range', requireAuth, async (_req: Request, res: Response) => {
  const min = ENV.PORT_RANGE_MIN;
  const max = ENV.PORT_RANGE_MAX;
  res.json({
    ok: true,
    data: {
      enabled: !!(min && max),
      min: min || 1,
      max: max || 65535,
      panelPort: ENV.PORT,
    },
  });
});

export default router;
