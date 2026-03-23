// src/routes/gost.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { forwardRules, tunnelChains, opLogs } from '../db/schema.js';
import { gostApi, type ForwardType } from '../services/gostService.js';
import { requireAuth } from '../middleware/auth.js';
import { eq, desc, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { safeJsonParse } from '../utils/shell.js';
import { isPortAllowed, ENV } from '../config.js';

const router = Router();

// ===== Zod 校验 =====

const createForwardSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum([
    // 端口转发
    'port-forward-tcp', 'port-forward-udp', 'port-range-tcp', 'reverse-tcp', 'reverse-udp',
    // 加密隧道
    'tunnel-tls', 'tunnel-wss', 'tunnel-mwss', 'tunnel-mtls',
    'tunnel-kcp', 'tunnel-quic', 'tunnel-ssh',
    // 代理服务
    'proxy-socks5', 'proxy-http', 'proxy-ss', 'proxy-relay', 'proxy-sni',
  ]),
  listenPort: z.number().int().min(1).max(65535),
  listenAddr: z.string().optional(),
  // proxy 类型不需要 target，所以改为可选
  targetHost: z.string().optional(),
  targetPort: z.number().int().min(1).max(65535).optional(),
  auth: z.object({
    username: z.string(),
    password: z.string(),
  }).optional(),
  chain: z.string().optional(),
  // proxy-ss 特有
  ssMethod: z.string().optional(),
  ssPassword: z.string().optional(),
  // port-range 特有
  listenStart: z.number().int().optional(),
  listenEnd: z.number().int().optional(),
  targetStart: z.number().int().optional(),
  // 目标节点
  nodeId: z.number().int().optional(),
}).refine(data => {
  // 非代理类型必须有目标地址 (proxy/sni 类型除外)
  if (!data.type.startsWith('proxy-') && data.type !== 'port-range-tcp') {
    return !!data.targetHost && !!data.targetPort;
  }
  return true;
}, { message: '非代理类型需要填写目标地址和端口' });

const createChainSchema = z.object({
  name: z.string().min(1).max(64),
  hops: z.array(z.object({
    name: z.string().min(1),
    addr: z.string().min(1),
    transport: z.enum(['tls', 'wss', 'mwss', 'mtls', 'kcp', 'quic', 'ssh', 'tcp', 'relay']),
    auth: z.object({
      username: z.string(),
      password: z.string(),
    }).optional(),
    tls: z.object({
      serverName: z.string().optional(),
    }).optional(),
  })).min(1),
});

// ===== GOST 状态检测 =====

/** GET /api/v1/gost/status */
router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connected = await gostApi.checkConnection();
    if (!connected) {
      return res.json({
        ok: true,
        data: { connected: false, services: 0, chains: 0 },
      });
    }
    
    const [services, chains] = await Promise.all([
      gostApi.listServices(),
      gostApi.listChains(),
    ]);

    res.json({
      ok: true,
      data: {
        connected: true,
        services: services.length,
        chains: chains.length,
      },
    });
  } catch (err: any) {
    res.json({ ok: true, data: { connected: false, error: err.message } });
  }
});

/** GET /api/v1/gost/config — 获取 GOST 完整配置 */
router.get('/config', requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await gostApi.getConfig();
    res.json({ ok: true, data: config });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: `GOST API 不可用: ${err.message}` });
  }
});

// ============================
// ===== 转发规则 CRUD =====
// ============================

/** GET /api/v1/gost/forwards — 列出所有转发规则 */
router.get('/forwards', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rules = db
      .select()
      .from(forwardRules)
      .where(eq(forwardRules.source, 'gost'))
      .orderBy(desc(forwardRules.createdAt))
      .all();

    // 同时拉取 GOST 实时状态
    let gostServices: any[] = [];
    try {
      gostServices = await gostApi.listServices();
    } catch { /* GOST 可能离线 */ }

    const gostServiceNames = new Set(gostServices.map(s => s.name));

    // 标记实际运行状态
    const enriched = rules.map(rule => ({
      ...rule,
      gostRunning: rule.gostServiceName ? gostServiceNames.has(rule.gostServiceName) : false,
      config: rule.config ? safeJsonParse(rule.config) : null,
    }));

    res.json({ ok: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/gost/forwards — 创建转发规则 */
router.post('/forwards', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createForwardSchema.parse(req.body);

    // NAT 端口范围校验
    const portCheck = isPortAllowed(body.listenPort);
    if (!portCheck.ok) return res.status(400).json({ ok: false, msg: portCheck.msg });

    // 端口占用预检
    const { isPortInUse } = await import('../utils/shell.js');
    const inUse = await isPortInUse(body.listenPort);
    if (inUse) {
      return res.status(409).json({ ok: false, msg: `端口 ${body.listenPort} 已被占用` });
    }

    // port-range 类型额外校验整个范围
    if (body.type === 'port-range-tcp' && body.listenStart && body.listenEnd) {
      const startCheck = isPortAllowed(body.listenStart);
      const endCheck = isPortAllowed(body.listenEnd);
      if (!startCheck.ok) return res.status(400).json({ ok: false, msg: startCheck.msg });
      if (!endCheck.ok) return res.status(400).json({ ok: false, msg: endCheck.msg });
    }

    // 1. 调用 GOST API 创建
    const result = await gostApi.createForward({
      name: body.name,
      listenPort: body.listenPort,
      listenAddr: body.listenAddr,
      targetHost: body.targetHost || '',
      targetPort: body.targetPort || 0,
      type: body.type as ForwardType,
      auth: body.auth,
      chain: body.chain,
      ssMethod: body.ssMethod,
      ssPassword: body.ssPassword,
    });

    // 2. 写入数据库
    const inserted = db.insert(forwardRules).values({
      name: body.name,
      type: body.type,
      source: 'gost',
      listenAddr: `:${body.listenPort}`,
      targetAddr: body.targetHost ? `${body.targetHost}:${body.targetPort || 0}` : '',
      transport: body.type.startsWith('tunnel-') ? body.type.replace('tunnel-', '') : null,
      authUser: body.auth?.username || null,
      authPass: body.auth?.password || null,
      gostServiceName: result.serviceName,
      gostChainName: result.chainName || null,
      config: JSON.stringify(body),
      status: 'active',
      nodeId: body.nodeId || null,
    }).returning().get();

    // 3. 记录操作日志
    db.insert(opLogs).values({
      action: 'create_forward',
      target: `${body.name} (${body.type})`,
      detail: JSON.stringify(body),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: inserted });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ ok: false, msg: '参数校验失败', errors: err.errors });
    }
    logger.error('创建转发失败', { error: err.message });
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/gost/forwards/:id — 删除转发规则 */
router.delete('/forwards/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rule = db.select().from(forwardRules).where(eq(forwardRules.id, id)).get();
    
    if (!rule) {
      return res.status(404).json({ ok: false, msg: '规则不存在' });
    }

    // 1. 从 GOST 删除
    if (rule.gostServiceName || rule.gostChainName) {
      await gostApi.deleteForwardAndChain(
        rule.gostServiceName || '',
        rule.gostChainName || undefined,
      );
    }

    // 2. 从数据库删除
    db.delete(forwardRules).where(eq(forwardRules.id, id)).run();

    // 3. 日志
    db.insert(opLogs).values({
      action: 'delete_forward',
      target: `${rule.name} (${rule.type})`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/gost/forwards/:id — 编辑转发规则 */
router.put('/forwards/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rule = db.select().from(forwardRules).where(eq(forwardRules.id, id)).get();
    if (!rule) return res.status(404).json({ ok: false, msg: '规则不存在' });

    const { name, targetHost, targetPort, limiter, bypass } = req.body;

    // 更新 GOST 服务 (如果在运行)
    if (rule.gostServiceName && rule.status === 'active') {
      const updatePayload: any = { name: rule.gostServiceName, addr: rule.listenAddr };

      // 更新目标地址
      if (targetHost && targetPort) {
        updatePayload.forwarder = {
          nodes: [{ name: `${rule.gostServiceName}-target`, addr: `${targetHost}:${targetPort}` }],
        };
      }

      // 限速器 (GOST v3 limiter)
      if (limiter) {
        updatePayload.metadata = updatePayload.metadata || {};
        if (limiter.in) updatePayload.metadata['limiter.in'] = limiter.in;    // e.g. "10MB"
        if (limiter.out) updatePayload.metadata['limiter.out'] = limiter.out;
        if (limiter.conn) updatePayload.metadata['limiter.conn.in'] = limiter.conn;
      }

      try {
        await gostApi.updateService(rule.gostServiceName, updatePayload);
      } catch (err: any) {
        logger.warn(`GOST 服务更新失败: ${err.message}`);
      }
    }

    // 更新数据库
    const updates: any = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (targetHost && targetPort) updates.targetAddr = `${targetHost}:${targetPort}`;
    if (req.body.config) updates.config = JSON.stringify(req.body.config);

    db.update(forwardRules).set(updates).where(eq(forwardRules.id, id)).run();

    db.insert(opLogs).values({
      action: 'update_forward', target: `${rule.name} → ${name || rule.name}`,
      detail: JSON.stringify(req.body), userId: req.user!.userId, ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '已更新' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== GOST 限速 / 分流 =====
// ============================

/** POST /api/v1/gost/limiters — 创建全局限速器 */
router.post('/limiters', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, limits } = req.body;
    // limits: [{ match: "*", rate: "10MB", period: "1s" }]
    if (!name || !limits) return res.status(400).json({ ok: false, msg: '缺少 name 或 limits' });

    await gostApi.createLimiter(name, limits);
    res.json({ ok: true, msg: `限速器 ${name} 已创建` });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/gost/limiters — 列出所有限速器 */
router.get('/limiters', requireAuth, async (_req: Request, res: Response) => {
  try {
    const data = await gostApi.listLimiters();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/gost/limiters/:name — 删除限速器 */
router.delete('/limiters/:name', requireAuth, async (req: Request, res: Response) => {
  try {
    await gostApi.deleteLimiter(req.params.name as string);
    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/gost/bypasses — 创建分流规则 */
router.post('/bypasses', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, matchers, whitelist } = req.body;
    if (!name || !matchers) return res.status(400).json({ ok: false, msg: '缺少 name 或 matchers' });

    await gostApi.createBypass(name, matchers, whitelist);
    res.json({ ok: true, msg: `分流规则 ${name} 已创建` });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/gost/bypasses — 列出分流规则 */
router.get('/bypasses', requireAuth, async (_req: Request, res: Response) => {
  try {
    const data = await gostApi.listBypasses();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/gost/bypasses/:name — 删除分流规则 */
router.delete('/bypasses/:name', requireAuth, async (req: Request, res: Response) => {
  try {
    await gostApi.deleteBypass(req.params.name as string);
    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/gost/forwards/:id/toggle — 启停转发 */
router.put('/forwards/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const rule = db.select().from(forwardRules).where(eq(forwardRules.id, id)).get();
    
    if (!rule) {
      return res.status(404).json({ ok: false, msg: '规则不存在' });
    }

    const newStatus = rule.status === 'active' ? 'stopped' : 'active';

    if (newStatus === 'stopped' && rule.gostServiceName) {
      // 停止: 从 GOST 删除服务 (保留数据库记录)
      // port-range 类型的 gostServiceName 是逗号分隔的多个名
      const svcNames = rule.gostServiceName.split(',');
      for (const svc of svcNames) {
        await gostApi.deleteForwardAndChain(svc.trim(), undefined);
      }
      if (rule.gostChainName) {
        try { await gostApi.deleteChain(rule.gostChainName); } catch {}
      }
    } else if (newStatus === 'active' && rule.config) {
      // 启动: 根据保存的配置重新创建
      const config = safeJsonParse(rule.config, {});
      if (!config) { throw new Error('配置数据损坏，无法重启'); }
      const portMatch = rule.listenAddr.match(/:(\d+)$/);
      const listenPort = portMatch ? parseInt(portMatch[1]) : parseInt(rule.listenAddr);
      const [tHost, tPort] = (rule.targetAddr || '').split(':');
      
      const result = await gostApi.createForward({
        name: rule.name,
        listenPort,
        targetHost: tHost || '',
        targetPort: parseInt(tPort) || 0,
        type: rule.type as ForwardType,
        auth: config.auth,
        ssMethod: config.ssMethod,
        ssPassword: config.ssPassword,
        listenStart: config.listenStart,
        listenEnd: config.listenEnd,
        targetStart: config.targetStart,
      });
      
      db.update(forwardRules).set({
        gostServiceName: result.serviceName,
        gostChainName: result.chainName || null,
      }).where(eq(forwardRules.id, id)).run();
    }

    db.insert(opLogs).values({ action: 'toggle_forward', target: `${rule.name} → ${newStatus}`, userId: req.user!.userId, ip: req.ip }).run();

    db.update(forwardRules).set({
      status: newStatus,
      updatedAt: new Date().toISOString(),
    }).where(eq(forwardRules.id, id)).run();

    res.json({ ok: true, data: { status: newStatus } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 隧道链路 CRUD =====
// ============================

/** GET /api/v1/gost/chains — 列出所有链路 */
router.get('/chains', requireAuth, async (_req: Request, res: Response) => {
  try {
    const chains = db
      .select()
      .from(tunnelChains)
      .orderBy(desc(tunnelChains.createdAt))
      .all();

    const enriched = chains.map(c => ({
      ...c,
      hops: safeJsonParse(c.hops, '[]'),
    }));

    res.json({ ok: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/gost/chains — 创建多跳链路 */
router.post('/chains', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createChainSchema.parse(req.body);

    // 1. 调用 GOST API
    const chainName = await gostApi.createChain(body);

    // 2. 写入数据库
    const inserted = db.insert(tunnelChains).values({
      name: body.name,
      hops: JSON.stringify(body.hops),
      gostChainName: chainName,
      status: 'active',
    }).returning().get();

    // 3. 日志
    db.insert(opLogs).values({
      action: 'create_chain',
      target: `${body.name} (${body.hops.length} 跳)`,
      detail: JSON.stringify(body),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: { ...inserted, hops: body.hops } });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ ok: false, msg: '参数校验失败', errors: err.errors });
    }
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/gost/chains/:id — 删除链路 */
router.delete('/chains/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const chain = db.select().from(tunnelChains).where(eq(tunnelChains.id, id)).get();
    
    if (!chain) {
      return res.status(404).json({ ok: false, msg: '链路不存在' });
    }

    if (chain.gostChainName) {
      await gostApi.deleteChain(chain.gostChainName);
    }

    db.delete(tunnelChains).where(eq(tunnelChains.id, id)).run();
    db.insert(opLogs).values({ action: 'delete_chain', target: chain.name, userId: req.user!.userId, ip: req.ip }).run();

    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 负载均衡 =====
// ============================

/** POST /api/v1/gost/load-balance — 创建负载均衡转发 */
router.post('/load-balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, listenPort, targets, strategy, protocol } = req.body;
    if (!name || !listenPort || !targets?.length) {
      return res.status(400).json({ ok: false, msg: '缺少 name, listenPort 或 targets' });
    }

    const serviceName = await gostApi.createLoadBalancedForward({
      name, listenPort, targets, strategy, protocol,
    });

    // 写入数据库
    db.insert(forwardRules).values({
      name, type: 'load-balance',
      source: 'gost',
      listenAddr: `:${listenPort}`,
      targetAddr: targets.map((t: any) => `${t.host}:${t.port}`).join(', '),
      gostServiceName: serviceName,
      config: JSON.stringify({ name, listenPort, targets, strategy }),
      status: 'active',
    }).run();

    db.insert(opLogs).values({
      action: 'create_lb', target: `${name} → ${targets.length} 目标`,
      userId: req.user!.userId, ip: req.ip,
    }).run();

    res.json({ ok: true, data: { serviceName } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/gost/load-balance/:serviceName — 更新负载均衡目标 */
router.put('/load-balance/:serviceName', requireAuth, async (req: Request, res: Response) => {
  try {
    const { serviceName } = req.params;
    const { targets } = req.body;
    if (!targets?.length) return res.status(400).json({ ok: false, msg: '缺少 targets' });

    await gostApi.updateForwarderTargets(serviceName as string, targets);
    res.json({ ok: true, msg: '目标已更新' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ===== GOST 原始 API 代理 (调试用) =====

/** GET /api/v1/gost/raw/services */
router.get('/raw/services', requireAuth, async (_req, res) => {
  try {
    const data = await gostApi.listServices();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/gost/raw/chains */
router.get('/raw/chains', requireAuth, async (_req, res) => {
  try {
    const data = await gostApi.listChains();
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: err.message });
  }
});

export default router;
