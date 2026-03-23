// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users, opLogs } from '../db/schema.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { eq } from 'drizzle-orm';

const router = Router();

/** POST /api/v1/auth/login */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ ok: false, msg: '用户名和密码不能为空' });
    }

    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      return res.status(401).json({ ok: false, msg: '用户名或密码错误' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, msg: '用户名或密码错误' });
    }

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({
      ok: true,
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role },
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/auth/profile */
router.get('/profile', requireAuth, (req: Request, res: Response) => {
  res.json({ ok: true, data: req.user });
});

/** POST /api/v1/auth/change-password */
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, msg: '参数不完整' });
    }

    const user = db.select().from(users).where(eq(users.id, req.user!.userId)).get();
    if (!user) {
      return res.status(404).json({ ok: false, msg: '用户不存在' });
    }

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return res.status(400).json({ ok: false, msg: '旧密码错误' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.update(users).set({ password: hash }).where(eq(users.id, user.id)).run();

    res.json({ ok: true, msg: '密码修改成功' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
