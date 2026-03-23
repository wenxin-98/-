// src/routes/diagnostic.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { forwardRules, tunnelChains } from '../db/schema.js';
import { diagnosticService } from '../services/diagnosticService.js';
import { safeJsonParse } from '../utils/shell.js';
import { eq } from 'drizzle-orm';

const router = Router();

// ============================
// ===== 端口预检 =====
// ============================

/** POST /api/v1/diag/check-port — 检查端口是否占用 */
router.post('/check-port', requireAuth, async (req: Request, res: Response) => {
  try {
    const { port, ports } = req.body;

    if (ports && Array.isArray(ports)) {
      const results = await diagnosticService.checkPortBatch(ports);
      return res.json({ ok: true, data: results });
    }

    if (!port) return res.status(400).json({ ok: false, msg: '缺少 port' });
    const result = await diagnosticService.checkPort(port);
    res.json({ ok: true, data: { port, ...result } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== TCP 连通测试 =====
// ============================

/** POST /api/v1/diag/tcp-test — 测试 TCP 连通性 */
router.post('/tcp-test', requireAuth, async (req: Request, res: Response) => {
  try {
    const { host, port, timeout } = req.body;
    if (!host || !port) return res.status(400).json({ ok: false, msg: '缺少 host 或 port' });

    const result = await diagnosticService.testTcpConnect(host, port, timeout || 5000);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/diag/tcp-batch — 批量 TCP 测试 */
router.post('/tcp-batch', requireAuth, async (req: Request, res: Response) => {
  try {
    const { targets } = req.body;
    if (!targets?.length) return res.status(400).json({ ok: false, msg: '缺少 targets' });

    const results = await Promise.all(
      targets.map(async (t: { host: string; port: number }) => ({
        host: t.host,
        port: t.port,
        ...(await diagnosticService.testTcpConnect(t.host, t.port, 5000)),
      }))
    );
    res.json({ ok: true, data: results });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 单条规则诊断 =====
// ============================

/** GET /api/v1/diag/forward/:id — 诊断单条转发/协议 */
router.get('/forward/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rule = db.select().from(forwardRules).where(eq(forwardRules.id, id)).get();
    if (!rule) return res.status(404).json({ ok: false, msg: '规则不存在' });

    const result = await diagnosticService.diagnoseForward(rule);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 隧道链路诊断 =====
// ============================

/** GET /api/v1/diag/chain/:id — 诊断隧道链路逐跳连通 */
router.get('/chain/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const chain = db.select().from(tunnelChains).where(eq(tunnelChains.id, id)).get();
    if (!chain) return res.status(404).json({ ok: false, msg: '链路不存在' });

    const hops = safeJsonParse(chain.hops, []);
    const result = await diagnosticService.diagnoseChain({
      name: chain.name,
      hops,
      gostChainName: chain.gostChainName || undefined,
    });
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 全局诊断 =====
// ============================

/** GET /api/v1/diag/all — 全面系统诊断 */
router.get('/all', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rules = db.select().from(forwardRules).all();
    const chains = db.select().from(tunnelChains).all();

    const result = await diagnosticService.diagnoseAll(rules, chains);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== GOST 服务验证 =====
// ============================

/** GET /api/v1/diag/gost/:serviceName — 验证 GOST 服务 */
router.get('/gost/:serviceName', requireAuth, async (req: Request, res: Response) => {
  try {
    const name = req.params.serviceName as string;
    const result = await diagnosticService.verifyGostService(name);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/diag/xui/:inboundId — 验证 Xray 入站 */
router.get('/xui/:inboundId', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.inboundId as string);
    const result = await diagnosticService.verifyXrayInbound(id);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
