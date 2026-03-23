// src/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { ENV } from './config.js';
import { initDatabase } from './db/index.js';
import { logger } from './utils/logger.js';
import { gostApi } from './services/gostService.js';
import { xuiApi } from './services/xuiService.js';
import { healthMonitor } from './services/healthMonitor.js';

// 路由
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import gostRoutes from './routes/gost.js';
import xuiRoutes from './routes/xui.js';
import nodeRoutes from './routes/nodes.js';
import settingsRoutes from './routes/settings.js';
import trafficRoutes from './routes/traffic.js';
import subscriptionRoutes from './routes/subscription.js';
import bbrRoutes from './routes/bbr.js';
import userRoutes from './routes/users.js';
import toolRoutes from './routes/tools.js';
import diagnosticRoutes from './routes/diagnostic.js';

// 安全中间件
import { rateLimit, loginProtection, ipFilter, securityHeaders, auditLog } from './middleware/security.js';

// 初始化 seed
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';
import { users, nodes } from './db/schema.js';
import { eq } from 'drizzle-orm';

const app = express();

// ===== 中间件 =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ENV.NODE_ENV === 'production' ? false : true,  // 生产环境只允许同域，开发环境全开
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// P7: 安全中间件
app.use(securityHeaders);
app.use(ipFilter);
app.use(auditLog);
app.use('/api/', rateLimit({ windowMs: 60000, max: 120 }));   // 全局 120 次/分
app.use('/api/v1/auth/login', loginProtection);                 // 登录防暴力

// 请求日志
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

// ===== API 路由 =====
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/gost', gostRoutes);
app.use('/api/v1/xui', xuiRoutes);
app.use('/api/v1/nodes', nodeRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/traffic', trafficRoutes);
app.use('/api/v1/sub', subscriptionRoutes);
app.use('/api/v1/bbr', bbrRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/tools', toolRoutes);
app.use('/api/v1/diag', diagnosticRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ===== 前端静态文件 (生产环境) =====
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '../dist-web');

if (existsSync(webDir)) {
  app.use(express.static(webDir, {
    maxAge: '1d',
    etag: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    },
  }));
  // SPA fallback — 非 API/WS 路由都返回 index.html
  app.get(/^(?!\/api\/|\/ws).*/, (_req, res) => {
    res.sendFile(resolve(webDir, 'index.html'));
  });
  logger.info(`前端静态文件: ${webDir}`);
}

// 404
app.use('/api/*', (_req, res) => {
  res.status(404).json({ ok: false, msg: 'API 路由不存在' });
});

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('未捕获异常', { error: err.message, stack: err.stack });
  res.status(500).json({ ok: false, msg: '服务器内部错误' });
});

// ===== 启动 =====
let server: any;

async function bootstrap() {
  // 1. 初始化数据库
  logger.info('初始化数据库...');
  initDatabase();

  // 2. Seed 管理员
  const existing = db.select().from(users).where(eq(users.username, ENV.ADMIN_USER)).get();
  if (!existing) {
    const hash = await bcrypt.hash(ENV.ADMIN_PASS, 10);
    db.insert(users).values({
      username: ENV.ADMIN_USER,
      password: hash,
      role: 'admin',
    }).run();
    logger.info(`管理员账号已创建: ${ENV.ADMIN_USER}`);
  }

  // 3. Seed 本机节点
  const localNode = db.select().from(nodes).where(eq(nodes.host, '127.0.0.1')).get();
  if (!localNode) {
    db.insert(nodes).values({
      name: '本机',
      host: '127.0.0.1',
      role: 'standalone',
      gostInstalled: false,
      xuiInstalled: false,
      status: 'offline',
    }).run();
  }

  // 4. 检测外部服务连接
  logger.info('检测 GOST 连接...');
  const gostOk = await gostApi.checkConnection();
  logger.info(gostOk ? '✓ GOST API 已连接' : '✗ GOST API 未连接 (部分功能不可用)');

  logger.info('检测 3X-UI 连接...');
  const xuiOk = await xuiApi.checkConnection();
  logger.info(xuiOk ? '✓ 3X-UI 已连接' : '✗ 3X-UI 未连接 (部分功能不可用)');

  // 更新本机节点状态
  if (localNode) {
    db.update(nodes).set({
      gostInstalled: gostOk,
      xuiInstalled: xuiOk,
      status: 'online',
      lastHeartbeat: new Date().toISOString(),
    }).where(eq(nodes.host, '127.0.0.1')).run();
  }

  // 5. 启动服务
  const { createServer } = await import('http');
  server = createServer(app);

  // 初始化 WebSocket
  const { wsService } = await import('./services/wsService.js');
  wsService.init(server);

  server.listen(ENV.PORT, '0.0.0.0', () => {
    logger.info('=========================================');
    logger.info(`  统一转发管理面板 v1.0.0`);
    logger.info(`  监听: http://0.0.0.0:${ENV.PORT}`);
    logger.info(`  GOST: ${gostOk ? '已连接' : '离线'}`);
    logger.info(`  3X-UI: ${xuiOk ? '已连接' : '离线'}`);
    logger.info(`  安全: 速率限制 + 登录保护 + IP 过滤`);
    logger.info(`  环境: ${ENV.NODE_ENV}`);
    logger.info('=========================================');

    // 6. 启动健康监控
    healthMonitor.start();

    // 7. 启动流量采集
    import('./services/trafficCollector.js').then(({ trafficCollector }) => {
      trafficCollector.start();
      logger.info('✓ 流量采集已启动');
    });

    // 8. 启动网络探测 + BBR 自动调参
    import('./services/networkProbe.js').then(({ networkProbe }) => {
      networkProbe.start(60000); // 每 60 秒探测
      logger.info('✓ 网络探测已启动');
    });

    import('./services/bbrTuner.js').then(async ({ bbrTuner }) => {
      // 检测系统 BBR 状态
      const bbrStatus = await bbrTuner.getBbrStatus();
      if (bbrStatus.enabled) {
        logger.info(`✓ 系统 BBR 已启用 (${bbrStatus.congestionControl}, qdisc=${bbrStatus.qdisc})`);
      } else if (bbrStatus.available) {
        logger.warn('⚠ 系统 BBR 可用但未启用，建议在 BBR 调参页面启用');
      } else {
        logger.warn('⚠ 内核不支持 BBR (需要 Linux 4.9+)');
      }

      // 如果环境变量开启了自动调参
      if (process.env.BBR_AUTO_TUNE === 'true') {
        const interval = parseInt(process.env.BBR_TUNE_INTERVAL || '120000');
        bbrTuner.startAutoTune(interval);
        logger.info(`✓ BBR 自动调参已启动 (${interval / 1000}s)`);
      }
    }).catch(() => {});

    // 8. 检查证书过期
    import('./services/certService.js').then(({ certService }) => {
      certService.checkExpiring().then(expiring => {
        if (expiring.length > 0) {
          logger.warn(`${expiring.length} 个证书即将过期!`);
        }
      }).catch(() => {});
    });
  });
}

bootstrap().catch(err => {
  logger.error('启动失败', { error: err.message });
  process.exit(1);
});

// ===== 优雅关闭 =====
function gracefulShutdown(signal: string) {
  logger.info(`收到 ${signal}，开始优雅关闭...`);

  // 1. 停止接受新连接
  server.close(() => {
    logger.info('HTTP 服务已关闭');
  });

  // 2. 关闭 WebSocket
  import('./services/wsService.js').then(({ wsService }) => {
    wsService.destroy();
  }).catch(() => {});

  // 3. 停止定时任务
  import('./services/trafficCollector.js').then(({ trafficCollector }) => {
    trafficCollector.stop();
  }).catch(() => {});

  // 4. 关闭数据库
  setTimeout(() => {
    try {
      const { sqliteDb } = require('./db/index.js');
      sqliteDb.close();
      logger.info('数据库已关闭');
    } catch {}
    process.exit(0);
  }, 3000); // 最多等 3 秒
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
