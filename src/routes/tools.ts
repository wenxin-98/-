// src/routes/tools.ts
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { db, sqliteDb } from '../db/index.js';
import { forwardRules, tunnelChains, nodes, users, opLogs, systemConfig, trafficStats } from '../db/schema.js';
import { telegramBot } from '../services/telegramBot.js';
import { generateUUID, generateShortId, generatePassword, generateSS2022Key, generateX25519, generateRealityConfig, generateWgKeys } from '../utils/xrayCrypto.js';
import { desc, count, sql } from 'drizzle-orm';

const router = Router();

// ============================
// ===== 数据导出/导入 =====
// ============================

/** GET /api/v1/tools/export — 导出所有配置数据 (JSON) */
router.get('/export', requireAdmin, async (req: Request, res: Response) => {
  try {
    const data = {
      version: '1.9.0',
      exportedAt: new Date().toISOString(),
      rules: db.select().from(forwardRules).all(),
      chains: db.select().from(tunnelChains).all(),
      nodes: db.select().from(nodes).all().map(n => ({
        ...n, agentKey: undefined, // 不导出密钥
      })),
      users: db.select().from(users).all().map(u => ({
        ...u, password: undefined, subToken: undefined, // 不导出密码
      })),
      config: db.select().from(systemConfig).all(),
    };

    const include = req.query.include as string;
    if (include === 'logs' || include === 'all') {
      (data as any).logs = db.select().from(opLogs)
        .orderBy(desc(opLogs.createdAt)).limit(1000).all();
    }
    if (include === 'traffic' || include === 'all') {
      (data as any).trafficStats = db.select().from(trafficStats)
        .orderBy(desc(trafficStats.hour)).limit(5000).all();
    }

    res.setHeader('Content-Disposition',
      `attachment; filename="unified-panel-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/import — 导入配置数据 */
router.post('/import', requireAdmin, async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data?.version) {
      return res.status(400).json({ ok: false, msg: '无效的导入数据格式' });
    }

    const stats = { rules: 0, chains: 0, nodes: 0 };

    // 导入规则
    if (data.rules?.length) {
      for (const rule of data.rules) {
        try {
          db.insert(forwardRules).values({
            name: rule.name,
            type: rule.type,
            source: rule.source,
            listenAddr: rule.listen_addr || rule.listenAddr || '',
            targetAddr: rule.target_addr || rule.targetAddr || '',
            transport: rule.transport,
            authUser: rule.auth_user || rule.authUser,
            authPass: rule.auth_pass || rule.authPass,
            config: rule.config,
            status: 'stopped', // 导入后默认停止
          }).run();
          stats.rules++;
        } catch {}
      }
    }

    // 导入链路
    if (data.chains?.length) {
      for (const chain of data.chains) {
        try {
          db.insert(tunnelChains).values({
            name: chain.name,
            hops: typeof chain.hops === 'string' ? chain.hops : JSON.stringify(chain.hops),
            status: 'stopped',
          }).run();
          stats.chains++;
        } catch {}
      }
    }

    // 导入节点 (不覆盖已有)
    if (data.nodes?.length) {
      for (const node of data.nodes) {
        try {
          const existing = db.select().from(nodes)
            .where(sql`${nodes.host} = ${node.host}`).get();
          if (!existing) {
            db.insert(nodes).values({
              name: node.name,
              host: node.host,
              role: node.role || 'standalone',
              status: 'offline',
            }).run();
            stats.nodes++;
          }
        } catch {}
      }
    }

    db.insert(opLogs).values({
      action: 'import_data',
      target: `规则=${stats.rules} 链路=${stats.chains} 节点=${stats.nodes}`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== Telegram Bot =====
// ============================

/** GET /api/v1/tools/telegram — 获取 TG 配置 */
router.get('/telegram', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const config = telegramBot.getConfig();
    // 隐藏 botToken 中间部分
    const masked = config ? {
      ...config,
      botToken: config.botToken
        ? config.botToken.slice(0, 6) + '****' + config.botToken.slice(-4)
        : '',
    } : null;
    res.json({ ok: true, data: masked });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/telegram — 保存 TG 配置 */
router.post('/telegram', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { botToken, adminChatId, enabled } = req.body;
    if (!botToken || !adminChatId) {
      return res.status(400).json({ ok: false, msg: '缺少 botToken 或 adminChatId' });
    }
    telegramBot.saveConfig({ botToken, adminChatId, enabled: enabled !== false });
    res.json({ ok: true, msg: '配置已保存' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/telegram/test — 测试 TG 发送 */
router.post('/telegram/test', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { botToken, chatId } = req.body;
    const result = await telegramBot.testConnection(botToken, chatId);
    res.json({ ok: result.ok, msg: result.msg });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== 密钥生成器 =====
// ============================

/** POST /api/v1/tools/keygen/uuid — 生成 UUID */
router.post('/keygen/uuid', requireAuth, async (_req: Request, res: Response) => {
  res.json({ ok: true, data: { uuid: generateUUID() } });
});

/** POST /api/v1/tools/keygen/reality — 生成 Reality 密钥对 + shortId */
router.post('/keygen/reality', requireAuth, async (req: Request, res: Response) => {
  try {
    const { dest, serverNames } = req.body;
    const config = await generateRealityConfig({ dest, serverNames });
    res.json({ ok: true, data: config });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/keygen/x25519 — 生成 X25519 密钥对 */
router.post('/keygen/x25519', requireAuth, async (_req: Request, res: Response) => {
  try {
    const keys = await generateX25519();
    res.json({ ok: true, data: keys });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/keygen/wireguard — 生成 WireGuard 密钥对 */
router.post('/keygen/wireguard', requireAuth, async (_req: Request, res: Response) => {
  try {
    const keys = await generateWgKeys();
    res.json({ ok: true, data: keys });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/tools/keygen/ss2022 — 生成 SS-2022 密钥 */
router.post('/keygen/ss2022', requireAuth, async (req: Request, res: Response) => {
  const method = req.body.method || '2022-blake3-aes-256-gcm';
  const key = generateSS2022Key(method);
  res.json({ ok: true, data: { method, key } });
});

/** POST /api/v1/tools/keygen/password — 生成随机密码 */
router.post('/keygen/password', requireAuth, async (req: Request, res: Response) => {
  const length = Math.min(Math.max(req.body.length || 16, 8), 64);
  res.json({ ok: true, data: { password: generatePassword(length) } });
});

/** POST /api/v1/tools/keygen/shortid — 生成 Short ID */
router.post('/keygen/shortid', requireAuth, async (req: Request, res: Response) => {
  const length = Math.min(Math.max(req.body.length || 8, 1), 16);
  res.json({ ok: true, data: { shortId: generateShortId(length) } });
});

// ============================
// ===== 版本更新检查 =====
// ============================

const CURRENT_VERSION = '1.9.0';
const GITHUB_REPO = 'wenxin-98/-'; // 替换为实际仓库

/** GET /api/v1/tools/version — 当前版本信息 */
router.get('/version', requireAuth, async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    data: {
      version: CURRENT_VERSION,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: Math.floor(process.uptime()),
    },
  });
});

/** GET /api/v1/tools/check-update — 检查 GitHub 最新版本 */
router.get('/check-update', requireAuth, async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'unified-panel' },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({
        ok: true,
        data: { current: CURRENT_VERSION, latest: null, hasUpdate: false, error: 'GitHub API 不可达' },
      });
    }

    const release = await response.json() as any;
    const latest = release.tag_name?.replace(/^v/, '') || '';
    const hasUpdate = latest && latest !== CURRENT_VERSION && latest > CURRENT_VERSION;

    res.json({
      ok: true,
      data: {
        current: CURRENT_VERSION,
        latest,
        hasUpdate,
        releaseUrl: release.html_url,
        publishedAt: release.published_at,
        body: release.body?.slice(0, 500),
      },
    });
  } catch (err: any) {
    res.json({
      ok: true,
      data: { current: CURRENT_VERSION, latest: null, hasUpdate: false, error: err.message },
    });
  }
});

export default router;
