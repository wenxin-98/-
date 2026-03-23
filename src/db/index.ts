// src/db/index.ts
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { ENV } from '../config.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

// 确保数据目录存在
const dbDir = dirname(ENV.DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite: DatabaseType = new Database(ENV.DB_PATH);

// 启用 WAL 模式 (并发性能)
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

/** 初始化数据库表 */
export function initDatabase() {
  logger.info(`数据库路径: ${ENV.DB_PATH}`);
  
  sqlite.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      traffic_quota INTEGER DEFAULT 0,
      traffic_used INTEGER DEFAULT 0,
      quota_reset_day INTEGER DEFAULT 1,
      expires_at TEXT,
      max_rules INTEGER DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      telegram_id TEXT,
      sub_token TEXT,
      last_login_at TEXT,
      last_login_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- API Key 表
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      permissions TEXT,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 系统配置表
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 转发规则表
    CREATE TABLE IF NOT EXISTS forward_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'gost',
      listen_addr TEXT NOT NULL DEFAULT '',
      target_addr TEXT NOT NULL DEFAULT '',
      transport TEXT,
      auth_user TEXT,
      auth_pass TEXT,
      gost_service_name TEXT,
      gost_chain_name TEXT,
      xui_inbound_id INTEGER,
      config TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      traffic_up INTEGER NOT NULL DEFAULT 0,
      traffic_down INTEGER NOT NULL DEFAULT 0,
      node_id INTEGER,
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 隧道链路表
    CREATE TABLE IF NOT EXISTS tunnel_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hops TEXT NOT NULL,
      gost_chain_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 节点表
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'standalone',
      gost_installed INTEGER NOT NULL DEFAULT 0,
      gost_api_port INTEGER DEFAULT 18080,
      xui_installed INTEGER NOT NULL DEFAULT 0,
      xui_port INTEGER DEFAULT 2053,
      agent_key TEXT,
      agent_version TEXT,
      system_info TEXT,
      last_heartbeat TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 操作日志表
    CREATE TABLE IF NOT EXISTS op_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      user_id INTEGER,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 流量统计表
    CREATE TABLE IF NOT EXISTS traffic_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      node_id INTEGER,
      hour TEXT NOT NULL,
      traffic_up INTEGER NOT NULL DEFAULT 0,
      traffic_down INTEGER NOT NULL DEFAULT 0,
      connections INTEGER NOT NULL DEFAULT 0
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_forward_rules_status ON forward_rules(status);
    CREATE INDEX IF NOT EXISTS idx_forward_rules_node ON forward_rules(node_id);
    CREATE INDEX IF NOT EXISTS idx_forward_rules_user ON forward_rules(user_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
    CREATE INDEX IF NOT EXISTS idx_traffic_stats_hour ON traffic_stats(hour);
    CREATE INDEX IF NOT EXISTS idx_traffic_stats_rule ON traffic_stats(rule_id);
    CREATE INDEX IF NOT EXISTS idx_op_logs_created ON op_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_sub_token ON users(sub_token);
  `);

  // === 安全迁移: 给已有表添加新列 (不存在时才加) ===
  const safeAddColumn = (table: string, column: string, def: string) => {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    } catch {
      // 列已存在，忽略
    }
  };

  // v1.1 用户表扩展
  safeAddColumn('users', 'traffic_quota', 'INTEGER DEFAULT 0');
  safeAddColumn('users', 'traffic_used', 'INTEGER DEFAULT 0');
  safeAddColumn('users', 'quota_reset_day', 'INTEGER DEFAULT 1');
  safeAddColumn('users', 'expires_at', 'TEXT');
  safeAddColumn('users', 'max_rules', 'INTEGER DEFAULT 0');
  safeAddColumn('users', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('users', 'telegram_id', 'TEXT');
  safeAddColumn('users', 'sub_token', 'TEXT');
  safeAddColumn('users', 'last_login_at', 'TEXT');
  safeAddColumn('users', 'last_login_ip', 'TEXT');

  // v1.1 规则表扩展
  safeAddColumn('forward_rules', 'user_id', 'INTEGER');

  logger.info('数据库表初始化完成');
}

export { sqlite as sqliteDb };
