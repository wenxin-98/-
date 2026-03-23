// src/middleware/security.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// ===== 1. 请求速率限制 (内存实现, 无额外依赖) =====

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * 通用速率限制中间件
 * @param windowMs  时间窗口 (毫秒)
 * @param maxHits   窗口内最大请求数
 * @param keyFn     自定义 key 生成函数
 */
export function rateLimit(opts: {
  windowMs?: number;
  max?: number;
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const windowMs = opts.windowMs || 60 * 1000;  // 默认 1 分钟
  const max = opts.max || 60;                     // 默认 60 次/分
  const keyFn = opts.keyFn || ((req: Request) => getClientIP(req));
  const message = opts.message || '请求过于频繁，请稍后再试';

  // 定时清理过期条目
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `rl:${keyFn(req)}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      return res.status(429).json({ ok: false, msg: message });
    }

    next();
  };
}

// ===== 2. 登录防暴力破解 =====

interface LoginAttempt {
  count: number;
  lockedUntil: number;
  lastAttempt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

const LOGIN_MAX_ATTEMPTS = 5;           // 最多 5 次错误
const LOGIN_LOCK_DURATION = 15 * 60 * 1000;  // 锁定 15 分钟
const LOGIN_WINDOW = 10 * 60 * 1000;    // 10 分钟窗口

/**
 * 登录防暴力中间件
 */
export function loginProtection(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  const key = `login:${ip}`;
  const now = Date.now();

  const attempt = loginAttempts.get(key);

  if (attempt) {
    // 检查是否在锁定期
    if (attempt.lockedUntil > now) {
      const retryAfter = Math.ceil((attempt.lockedUntil - now) / 1000);
      logger.warn(`登录被锁定: ${ip} (剩余 ${retryAfter}s)`);
      return res.status(429).json({
        ok: false,
        msg: `登录尝试次数过多，请 ${Math.ceil(retryAfter / 60)} 分钟后重试`,
      });
    }

    // 窗口期过了，重置
    if (now - attempt.lastAttempt > LOGIN_WINDOW) {
      loginAttempts.delete(key);
    }
  }

  // 在 response 上挂一个 hook，登录失败时记录
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode === 401 || (body && !body.ok && body.msg?.includes('密码'))) {
      recordFailedLogin(ip);
    } else if (body?.ok) {
      // 登录成功，清除记录
      loginAttempts.delete(key);
    }
    return originalJson(body);
  };

  next();
}

function recordFailedLogin(ip: string) {
  const key = `login:${ip}`;
  const now = Date.now();
  const attempt = loginAttempts.get(key) || { count: 0, lockedUntil: 0, lastAttempt: now };

  attempt.count++;
  attempt.lastAttempt = now;

  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    attempt.lockedUntil = now + LOGIN_LOCK_DURATION;
    logger.warn(`登录锁定触发: ${ip} (${attempt.count} 次失败)`);
  }

  loginAttempts.set(key, attempt);
}

// ===== 3. IP 白名单/黑名单 =====

let ipWhitelist: Set<string> | null = null;   // null = 不启用白名单
let ipBlacklist: Set<string> = new Set();

/**
 * 设置 IP 白名单 (传 null 关闭)
 */
export function setIPWhitelist(ips: string[] | null) {
  ipWhitelist = ips ? new Set(ips) : null;
  logger.info(ips ? `IP 白名单已设置: ${ips.length} 个` : 'IP 白名单已关闭');
}

/**
 * 添加 IP 到黑名单
 */
export function addIPBlacklist(ip: string) {
  ipBlacklist.add(ip);
  logger.info(`IP 已加入黑名单: ${ip}`);
}

export function removeIPBlacklist(ip: string) {
  ipBlacklist.delete(ip);
}

/**
 * IP 过滤中间件
 */
export function ipFilter(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);

  // 黑名单检查
  if (ipBlacklist.has(ip)) {
    return res.status(403).json({ ok: false, msg: '访问被拒绝' });
  }

  // 白名单检查 (如果启用)
  if (ipWhitelist !== null && !ipWhitelist.has(ip) && ip !== '127.0.0.1' && ip !== '::1') {
    return res.status(403).json({ ok: false, msg: '不在允许的 IP 列表中' });
  }

  next();
}

// ===== 4. 安全响应头 =====

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // 防点击劫持 (允许同源 iframe 嵌入 3X-UI)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // 不设 CSP，避免影响前端和 3X-UI iframe
  next();
}

// ===== 5. 审计日志 =====

export function auditLog(req: Request, _res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.path.startsWith('/api/')) {
    const ip = getClientIP(req);
    const user = (req as any).user?.username || 'anonymous';
    logger.info(`[审计] ${req.method} ${req.path} | user=${user} ip=${ip}`);
  }
  next();
}

// ===== 工具 =====

function getClientIP(req: Request): string {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    return xForwardedFor.split(',')[0].trim();
  }
  const xRealIP = req.headers['x-real-ip'];
  if (typeof xRealIP === 'string') return xRealIP;
  return req.socket.remoteAddress || '0.0.0.0';
}

export { getClientIP };
