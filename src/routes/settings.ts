// src/routes/settings.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { certService } from '../services/certService.js';
import { setIPWhitelist, addIPBlacklist, removeIPBlacklist } from '../middleware/security.js';
import { db } from '../db/index.js';
import { users, opLogs } from '../db/schema.js';
import { eq, count, desc } from 'drizzle-orm';
import { getSystemInfo, runCommand } from '../utils/shell.js';
import bcrypt from 'bcryptjs';

const router = Router();

// ============================
// ===== 证书管理 =====
// ============================

/** GET /api/v1/settings/certs — 列出所有证书 */
router.get('/certs', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const certs = await certService.listCerts();
    res.json({ ok: true, data: certs });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/settings/certs/self-signed — 生成自签证书 */
router.post('/certs/self-signed', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { domain, days, ip } = req.body;
    const result = await certService.generateSelfSigned({ domain, days, ip });
    
    db.insert(opLogs).values({
      action: 'generate_cert',
      target: `自签证书: ${domain || 'localhost'}`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/settings/certs/acme — ACME 申请证书 */
router.post('/certs/acme', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      domain: z.string().min(1),
      email: z.string().email(),
      dnsProvider: z.string().optional(),
      envVars: z.record(z.string()).optional(),
      useStandalone: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    
    const result = await certService.requestACME(body);

    db.insert(opLogs).values({
      action: 'request_acme_cert',
      target: body.domain,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: result });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ ok: false, msg: '参数错误', errors: err.errors });
    }
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/settings/certs/check-expiring — 检查即将过期证书 */
router.get('/certs/check-expiring', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const expiring = await certService.checkExpiring();
    res.json({ ok: true, data: expiring });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 安全设置 =====
// ============================

/** POST /api/v1/settings/ip-whitelist — 设置 IP 白名单 */
router.post('/ip-whitelist', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { ips } = req.body; // string[] 或 null
    setIPWhitelist(ips);

    db.insert(opLogs).values({
      action: 'set_ip_whitelist',
      target: ips ? `${ips.length} 个 IP` : '已关闭',
      detail: JSON.stringify(ips),
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, msg: ips ? `白名单已设置 (${ips.length} 个)` : '白名单已关闭' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/settings/ip-blacklist — 管理 IP 黑名单 */
router.post('/ip-blacklist', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { action, ip } = req.body;
    if (action === 'add' && ip) {
      addIPBlacklist(ip);
      res.json({ ok: true, msg: `${ip} 已加入黑名单` });
    } else if (action === 'remove' && ip) {
      removeIPBlacklist(ip);
      res.json({ ok: true, msg: `${ip} 已从黑名单移除` });
    } else {
      res.status(400).json({ ok: false, msg: '参数错误: 需要 action (add/remove) 和 ip' });
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 面板设置 =====
// ============================

/** POST /api/v1/settings/change-admin-password — 修改管理员账号密码 */
router.post('/change-admin-password', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword, newUsername } = req.body;
    if (!oldPassword) {
      return res.status(400).json({ ok: false, msg: '请输入旧密码' });
    }
    if (!newPassword && !newUsername) {
      return res.status(400).json({ ok: false, msg: '请输入新密码或新用户名' });
    }
    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ ok: false, msg: '密码至少 6 位' });
    }

    const user = db.select().from(users).where(eq(users.id, req.user!.userId)).get();
    if (!user) return res.status(404).json({ ok: false, msg: '用户不存在' });

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) return res.status(400).json({ ok: false, msg: '旧密码错误' });

    const updates: any = {};
    if (newPassword) {
      updates.password = await bcrypt.hash(newPassword, 10);
    }
    if (newUsername && newUsername.trim() && newUsername !== user.username) {
      const existing = db.select().from(users).where(eq(users.username, newUsername.trim())).get();
      if (existing) return res.status(400).json({ ok: false, msg: '用户名已被占用' });
      updates.username = newUsername.trim();
    }

    db.update(users).set(updates).where(eq(users.id, user.id)).run();

    db.insert(opLogs).values({
      action: 'change_credentials',
      target: `${user.username} → ${updates.username || user.username}`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, msg: '修改成功' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/settings/backup — 备份数据库 */
router.post('/backup', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `/opt/unified-panel/data/backup-${timestamp}.db`;
    
    const { ENV } = await import('../config.js');
    await runCommand(`cp "${ENV.DB_PATH}" "${backupPath}"`);

    res.json({ ok: true, data: { path: backupPath } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/settings/service-status — 各服务进程状态 */
router.get('/service-status', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [gost, xui, nginx, pm2] = await Promise.all([
      runCommand('systemctl is-active gost 2>/dev/null || echo inactive'),
      runCommand('systemctl is-active x-ui 2>/dev/null || echo inactive'),
      runCommand('systemctl is-active nginx 2>/dev/null || echo inactive'),
      runCommand('pm2 jlist 2>/dev/null || echo "[]"'),
    ]);

    let pm2Apps: any[] = [];
    try { pm2Apps = JSON.parse(pm2.stdout); } catch {}

    res.json({
      ok: true,
      data: {
        gost: gost.stdout.trim(),
        xui: xui.stdout.trim(),
        nginx: nginx.stdout.trim(),
        panel: pm2Apps.find((a: any) => a.name === 'unified-panel')?.pm2_env?.status || 'unknown',
        pm2Apps: pm2Apps.map((a: any) => ({
          name: a.name,
          status: a.pm2_env?.status,
          memory: a.monit?.memory,
          cpu: a.monit?.cpu,
          uptime: a.pm2_env?.pm_uptime,
        })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/settings/restart-service — 重启指定服务 */
router.post('/restart-service', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { service } = req.body;
    const allowed = ['gost', 'x-ui', 'nginx', 'unified-panel'];
    
    if (!allowed.includes(service)) {
      return res.status(400).json({ ok: false, msg: `不允许重启: ${service}` });
    }

    if (service === 'unified-panel') {
      await runCommand('pm2 restart unified-panel');
    } else {
      await runCommand(`systemctl restart ${service}`);
    }

    db.insert(opLogs).values({
      action: 'restart_service',
      target: service,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, msg: `${service} 已重启` });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
