// src/routes/users.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users, forwardRules, opLogs } from '../db/schema.js';
import { requireAdmin, signToken } from '../middleware/auth.js';
import { eq, desc, sql, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const router = Router();

// ===== 用户 CRUD =====

/** GET /api/v1/users — 列出所有用户 */
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const allUsers = db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      trafficQuota: users.trafficQuota,
      trafficUsed: users.trafficUsed,
      maxRules: users.maxRules,
      enabled: users.enabled,
      expiresAt: users.expiresAt,
      telegramId: users.telegramId,
      subToken: users.subToken,
      lastLoginAt: users.lastLoginAt,
      lastLoginIp: users.lastLoginIp,
      createdAt: users.createdAt,
    }).from(users).orderBy(desc(users.createdAt)).all();

    // 附加每用户的规则数
    const enriched = allUsers.map(u => {
      const ruleCount = db.select({ count: count() })
        .from(forwardRules)
        .where(eq(forwardRules.userId, u.id))
        .get();
      return { ...u, ruleCount: ruleCount?.count || 0 };
    });

    res.json({ ok: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/users — 创建用户 */
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      username: z.string().min(2).max(32),
      password: z.string().min(6).max(64),
      role: z.enum(['admin', 'user', 'viewer']).default('user'),
      trafficQuota: z.number().int().min(0).default(0),
      maxRules: z.number().int().min(0).default(0),
      expiresAt: z.string().optional(),
    });
    const body = schema.parse(req.body);

    // 检查重名
    const existing = db.select().from(users).where(eq(users.username, body.username)).get();
    if (existing) return res.status(409).json({ ok: false, msg: '用户名已存在' });

    const hash = await bcrypt.hash(body.password, 10);
    const subToken = nanoid(24);

    const inserted = db.insert(users).values({
      username: body.username,
      password: hash,
      role: body.role,
      trafficQuota: body.trafficQuota,
      maxRules: body.maxRules,
      expiresAt: body.expiresAt || null,
      subToken,
      enabled: true,
    }).returning().get();

    db.insert(opLogs).values({
      action: 'create_user',
      target: body.username,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: { ...inserted, password: undefined } });
  } catch (err: any) {
    if (err.name === 'ZodError') return res.status(400).json({ ok: false, msg: '参数错误', errors: err.errors });
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** PUT /api/v1/users/:id — 更新用户 */
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const user = db.select().from(users).where(eq(users.id, id)).get();
    if (!user) return res.status(404).json({ ok: false, msg: '用户不存在' });

    const update: any = {};
    if (req.body.role) update.role = req.body.role;
    if (req.body.trafficQuota !== undefined) update.trafficQuota = req.body.trafficQuota;
    if (req.body.maxRules !== undefined) update.maxRules = req.body.maxRules;
    if (req.body.expiresAt !== undefined) update.expiresAt = req.body.expiresAt || null;
    if (req.body.enabled !== undefined) update.enabled = req.body.enabled;
    if (req.body.password) update.password = await bcrypt.hash(req.body.password, 10);

    db.update(users).set(update).where(eq(users.id, id)).run();
    db.insert(opLogs).values({ action: 'update_user', target: `user#${id}`, detail: JSON.stringify(req.body), userId: req.user!.userId, ip: req.ip }).run();
    res.json({ ok: true, msg: '已更新' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/users/:id — 删除用户 */
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    if (id === req.user!.userId) {
      return res.status(400).json({ ok: false, msg: '不能删除自己' });
    }
    db.delete(users).where(eq(users.id, id)).run();
    db.insert(opLogs).values({ action: 'delete_user', target: `user#${id}`, userId: req.user!.userId, ip: req.ip }).run();
    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/users/:id/reset-traffic — 重置流量计数 */
router.post('/:id/reset-traffic', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    db.update(users).set({ trafficUsed: 0 }).where(eq(users.id, id)).run();
    res.json({ ok: true, msg: '流量已重置' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/users/:id/refresh-token — 刷新订阅 token */
router.post('/:id/refresh-token', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const newToken = nanoid(24);
    db.update(users).set({ subToken: newToken }).where(eq(users.id, id)).run();
    res.json({ ok: true, data: { subToken: newToken } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
