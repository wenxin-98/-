// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config.js';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** 生成 JWT */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: '24h' });
}

/** 验证 JWT */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Express 中间件: 要求登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, msg: '未登录' });
  }
  
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ ok: false, msg: 'Token 无效或已过期' });
  }
  
  req.user = payload;
  next();
}

/** Express 中间件: 要求管理员 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ ok: false, msg: '需要管理员权限' });
    }
    next();
  });
}
