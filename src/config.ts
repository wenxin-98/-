// src/config.ts
import { config } from 'dotenv';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { hostname } from 'os';

config({ path: resolve(process.cwd(), '.env') });

// 稳定的 JWT fallback: 基于主机名 + 安装路径派生，重启不变
const stableSecret = createHash('sha256')
  .update(`unified-panel:${hostname()}:${resolve(process.cwd())}`)
  .digest('hex');

export const ENV = {
  // 面板
  PORT: parseInt(process.env.PORT || '9527'),
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET || stableSecret,
  
  // 数据库
  DB_PATH: process.env.DB_PATH || resolve(process.cwd(), 'data/panel.db'),
  
  // GOST
  GOST_API: process.env.GOST_API || 'http://127.0.0.1:18080',
  GOST_BIN: process.env.GOST_BIN || '/usr/local/bin/gost',
  GOST_CONFIG: process.env.GOST_CONFIG || '/opt/unified-panel/data/gost/config.yaml',
  
  // 3X-UI
  XUI_API: process.env.XUI_API || 'http://127.0.0.1:2053',
  XUI_USER: process.env.XUI_USER || 'admin',
  XUI_PASS: process.env.XUI_PASS || 'admin',
  
  // 管理员
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',

  // NAT 端口范围 (可选，不设则不限制)
  PORT_RANGE_MIN: parseInt(process.env.PORT_RANGE_MIN || '0'),
  PORT_RANGE_MAX: parseInt(process.env.PORT_RANGE_MAX || '0'),
} as const;

/** 检查端口是否在允许的 NAT 范围内 */
export function isPortAllowed(port: number): { ok: boolean; msg?: string } {
  if (!ENV.PORT_RANGE_MIN || !ENV.PORT_RANGE_MAX) return { ok: true };
  if (port >= ENV.PORT_RANGE_MIN && port <= ENV.PORT_RANGE_MAX) return { ok: true };
  return {
    ok: false,
    msg: `端口 ${port} 超出允许范围 ${ENV.PORT_RANGE_MIN}-${ENV.PORT_RANGE_MAX} (NAT 限制)`,
  };
}
