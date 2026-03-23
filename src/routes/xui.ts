// src/routes/xui.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { forwardRules, opLogs, nodes } from '../db/schema.js';
import { xuiApi, getXuiForNode } from '../services/xuiService.js';
import { requireAuth } from '../middleware/auth.js';
import { eq } from 'drizzle-orm';
import { isPortAllowed } from '../config.js';

const router = Router();

const createInboundSchema = z.object({
  remark: z.string().min(1),
  protocol: z.enum(['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'wireguard', 'socks', 'http', 'dokodemo']),
  port: z.number().int().min(1).max(65535),
  settings: z.any().optional(),
  streamSettings: z.any().optional(),
  sniffing: z.any().optional(),
  extra: z.record(z.any()).optional(),
  nodeId: z.number().int().optional(),  // 目标节点 (空=本机)
});

/** GET /api/v1/xui/status — 3X-UI 连接状态 */
router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connected = await xuiApi.checkConnection();
    if (!connected) {
      return res.json({ ok: true, data: { connected: false } });
    }

    const [serverStatus, inbounds] = await Promise.all([
      xuiApi.getServerStatus(),
      xuiApi.listInbounds(),
    ]);

    res.json({
      ok: true,
      data: {
        connected: true,
        server: serverStatus,
        inboundCount: inbounds.length,
      },
    });
  } catch (err: any) {
    res.json({ ok: true, data: { connected: false, error: err.message } });
  }
});

/** GET /api/v1/xui/inbounds — 列出所有入站 */
router.get('/inbounds', requireAuth, async (_req: Request, res: Response) => {
  try {
    const inbounds = await xuiApi.listInbounds();

    const enriched = inbounds.map(ib => ({
      id: ib.id,
      remark: ib.remark,
      protocol: ib.protocol,
      port: ib.port,
      enable: ib.enable,
      up: ib.up,
      down: ib.down,
      total: ib.total,
      expiryTime: ib.expiryTime,
      clientCount: ib.clientStats?.length || 0,
      settings: safeJsonParse(ib.settings),
      streamSettings: safeJsonParse(ib.streamSettings),
    }));

    res.json({ ok: true, data: enriched });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: `3X-UI 不可用: ${err.message}` });
  }
});

/** 根据 nodeId 获取对应的 XUI API 实例 */
function resolveXui(nodeId?: number) {
  if (!nodeId) return xuiApi; // 本机
  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) throw new Error(`节点 ${nodeId} 不存在`);
  if (!node.xuiInstalled) throw new Error(`节点 ${node.name} 未安装 3X-UI`);
  return getXuiForNode(node);
}

/** POST /api/v1/xui/inbounds — 创建入站 */
router.post('/inbounds', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createInboundSchema.parse(req.body);

    // NAT 端口范围校验
    const portCheck = isPortAllowed(body.port);
    if (!portCheck.ok) return res.status(400).json({ ok: false, msg: portCheck.msg });

    // 端口占用预检
    const { isPortInUse } = await import('../utils/shell.js');
    const inUse = await isPortInUse(body.port);
    if (inUse) {
      return res.status(409).json({ ok: false, msg: `端口 ${body.port} 已被占用` });
    }

    // 按 nodeId 路由到目标节点的 3X-UI
    const targetXui = resolveXui(body.nodeId);

    const result = await targetXui.addInbound({
      remark: body.remark,
      protocol: body.protocol,
      port: body.port,
      settings: body.settings,
      streamSettings: body.streamSettings,
      sniffing: body.sniffing,
      extra: body.extra,
    });

    // 同步记录到本地数据库
    db.insert(forwardRules).values({
      name: body.remark,
      type: `xray-${body.protocol}`,
      source: 'xui',
      listenAddr: `:${body.port}`,
      targetAddr: '',
      xuiInboundId: result?.obj?.id || null,
      config: JSON.stringify(body),
      status: 'active',
      nodeId: body.nodeId || null,
    }).run();

    db.insert(opLogs).values({
      action: 'create_xui_inbound',
      target: `${body.remark} (${body.protocol}:${body.port})${body.nodeId ? ` @node${body.nodeId}` : ''}`,
      detail: JSON.stringify(body),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: result });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ ok: false, msg: '参数校验失败', errors: err.errors });
    }
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/xui/inbounds/:id — 删除入站 */
router.delete('/inbounds/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await xuiApi.deleteInbound(id);
    db.delete(forwardRules).where(eq(forwardRules.xuiInboundId, id)).run();
    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/xui/inbounds/:id — 编辑入站参数 */
router.put('/inbounds/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { remark, port, settings, streamSettings, sniffing, enable } = req.body;

    await xuiApi.updateInbound(id, {
      remark, port, settings, streamSettings, sniffing, enable,
    });

    // 同步本地
    if (remark) {
      db.update(forwardRules).set({ name: remark, updatedAt: new Date().toISOString() })
        .where(eq(forwardRules.xuiInboundId, id)).run();
    }

    db.insert(opLogs).values({
      action: 'update_xui_inbound', target: `ID=${id}`,
      detail: JSON.stringify(req.body), userId: req.user!.userId, ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '已更新' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/xui/inbounds/:id/toggle — 启用/禁用入站 */
router.put('/inbounds/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { enable } = req.body;

    await xuiApi.toggleInbound(id, enable);

    db.update(forwardRules).set({
      status: enable ? 'active' : 'stopped',
      updatedAt: new Date().toISOString(),
    }).where(eq(forwardRules.xuiInboundId, id)).run();

    db.insert(opLogs).values({ action: 'toggle_inbound', target: `inbound#${id} → ${enable}`, userId: req.user!.userId, ip: req.ip }).run();
    res.json({ ok: true, data: { enable } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/xui/inbounds/:id/reset-traffic — 重置入站流量 */
router.post('/inbounds/:id/reset-traffic', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await xuiApi.resetInboundTraffic(id);
    res.json({ ok: true, msg: '流量已重置' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 客户端管理 =====
// ============================

/** GET /api/v1/xui/inbounds/:id/clients — 列出入站的所有客户端 */
router.get('/inbounds/:id/clients', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const clients = await xuiApi.getClients(id);
    res.json({ ok: true, data: clients });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/xui/inbounds/:id/clients — 添加客户端 */
router.post('/inbounds/:id/clients', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const result = await xuiApi.addClient(id, req.body);

    db.insert(opLogs).values({
      action: 'add_xui_client', target: `inbound=${id} email=${req.body.email}`,
      userId: req.user!.userId, ip: req.ip,
    }).run();

    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/xui/inbounds/:id/clients/:clientId — 更新客户端 */
router.put('/inbounds/:id/clients/:clientId', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const clientId = req.params.clientId as string;
    await xuiApi.updateClient(id, clientId, req.body);
    res.json({ ok: true, msg: '已更新' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/xui/inbounds/:id/clients/:clientId — 删除客户端 */
router.delete('/inbounds/:id/clients/:clientId', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const clientId = req.params.clientId as string;
    await xuiApi.removeClient(id, clientId);

    db.insert(opLogs).values({
      action: 'remove_xui_client', target: `inbound=${id} client=${clientId}`,
      userId: req.user!.userId, ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/xui/inbounds/:id/clients/:email/reset-traffic — 重置客户端流量 */
router.post('/inbounds/:id/clients/:email/reset-traffic', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const email = req.params.email as string;
    await xuiApi.resetClientTraffic(id, email);
    res.json({ ok: true, msg: '客户端流量已重置' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/xui/restart-xray — 重启 Xray */
router.post('/restart-xray', requireAuth, async (req: Request, res: Response) => {
  try {
    await xuiApi.restartXray();
    db.insert(opLogs).values({ action: 'restart_xray', target: 'xray', userId: req.user!.userId, ip: req.ip }).run();
    res.json({ ok: true, msg: 'Xray 已重启' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/xui/server-status — 服务器状态 */
router.get('/server-status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await xuiApi.getServerStatus();
    res.json({ ok: true, data: status });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: err.message });
  }
});

function safeJsonParse(str: string): any {
  try { return JSON.parse(str); } catch { return str; }
}

export default router;
