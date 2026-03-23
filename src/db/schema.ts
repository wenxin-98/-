// src/db/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ===== 用户表 =====
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),  // bcrypt hash
  role: text('role', { enum: ['admin', 'user', 'viewer'] }).default('admin').notNull(),
  
  // 流量配额 (v1.1)
  trafficQuota: integer('traffic_quota').default(0),    // 字节, 0=无限
  trafficUsed: integer('traffic_used').default(0),       // 已用字节
  quotaResetDay: integer('quota_reset_day').default(1),  // 每月重置日 (1-28)
  
  // 到期时间 (v1.1)
  expiresAt: text('expires_at'),       // null=永不过期
  
  // 用户设置
  maxRules: integer('max_rules').default(0),  // 最大规则数, 0=无限
  enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
  
  // Telegram 绑定
  telegramId: text('telegram_id'),
  
  // 个人订阅 token
  subToken: text('sub_token'),
  
  lastLoginAt: text('last_login_at'),
  lastLoginIp: text('last_login_ip'),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== API Key 表 =====
export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),   // SHA256 hash
  prefix: text('prefix').notNull(),       // 前 8 位，用于展示
  permissions: text('permissions'),        // JSON: ["read", "write", "admin"]
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 系统配置表 (KV) =====
export const systemConfig = sqliteTable('system_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 转发规则表 =====
export const forwardRules = sqliteTable('forward_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  // 类型: port-forward-tcp, port-forward-udp, tunnel-tls, tunnel-wss, tunnel-kcp, tunnel-quic
  source: text('source', { enum: ['gost', 'xui'] }).notNull().default('gost'),
  
  listenAddr: text('listen_addr').notNull().default(''),      // :10001
  targetAddr: text('target_addr').notNull().default(''),      // 1.2.3.4:443
  
  transport: text('transport'),        // tls, wss, kcp, quic
  authUser: text('auth_user'),
  authPass: text('auth_pass'),
  
  // GOST 内部标识 (用于 API 操作)
  gostServiceName: text('gost_service_name'),
  gostChainName: text('gost_chain_name'),
  
  // 3X-UI 关联
  xuiInboundId: integer('xui_inbound_id'),
  
  // 完整配置快照 (JSON)
  config: text('config'),
  
  status: text('status', { enum: ['active', 'stopped', 'error'] }).default('active').notNull(),
  
  // 流量统计
  trafficUp: integer('traffic_up').default(0).notNull(),
  trafficDown: integer('traffic_down').default(0).notNull(),
  
  // 所属节点
  nodeId: integer('node_id'),
  
  // 所属用户 (v1.1 多用户)
  userId: integer('user_id'),
  
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 隧道链路表 (多跳) =====
export const tunnelChains = sqliteTable('tunnel_chains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  
  // 链路配置 JSON: [{ name, addr, transport, auth }]
  hops: text('hops').notNull(),
  
  // GOST chain 名称
  gostChainName: text('gost_chain_name'),
  
  status: text('status', { enum: ['active', 'stopped', 'error'] }).default('active').notNull(),
  
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 节点表 =====
export const nodes = sqliteTable('nodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  host: text('host').notNull(),
  
  role: text('role', { enum: ['entry', 'relay', 'exit', 'standalone'] }).notNull().default('standalone'),
  
  gostInstalled: integer('gost_installed', { mode: 'boolean' }).default(false).notNull(),
  gostApiPort: integer('gost_api_port').default(18080),
  
  xuiInstalled: integer('xui_installed', { mode: 'boolean' }).default(false).notNull(),
  xuiPort: integer('xui_port').default(2053),
  
  // Agent 通信
  agentKey: text('agent_key'),
  agentVersion: text('agent_version'),
  
  // 系统信息 (心跳上报)
  systemInfo: text('system_info'),      // JSON
  lastHeartbeat: text('last_heartbeat'),
  
  status: text('status', { enum: ['online', 'offline', 'error'] }).default('offline').notNull(),
  
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 操作日志表 =====
export const opLogs = sqliteTable('op_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),       // create_forward, delete_forward, start_tunnel ...
  target: text('target'),                  // 操作目标描述
  detail: text('detail'),                  // JSON 详情
  userId: integer('user_id'),
  ip: text('ip'),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});

// ===== 流量统计表 (按小时聚合) =====
export const trafficStats = sqliteTable('traffic_stats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ruleId: integer('rule_id').notNull(),
  nodeId: integer('node_id'),
  hour: text('hour').notNull(),            // 2024-03-23T14:00:00
  trafficUp: integer('traffic_up').default(0).notNull(),
  trafficDown: integer('traffic_down').default(0).notNull(),
  connections: integer('connections').default(0).notNull(),
});
