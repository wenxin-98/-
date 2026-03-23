// src/services/telegramBot.ts
import { logger } from '../utils/logger.js';
import { safeJsonParse } from '../utils/shell.js';
import { db } from '../db/index.js';
import { systemConfig, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Telegram Bot 通知服务
 *
 * 告警场景:
 *   - 节点离线
 *   - 证书即将过期
 *   - 流量配额用尽
 *   - 用户账号过期
 *   - 登录异常 (非白名单 IP)
 *   - BBR 调参变更
 */

interface TgConfig {
  botToken: string;
  adminChatId: string;  // 管理员通知目标
  enabled: boolean;
}

class TelegramBotService {
  private config: TgConfig | null = null;

  /** 从数据库加载配置 */
  loadConfig() {
    try {
      const row = db.select().from(systemConfig)
        .where(eq(systemConfig.key, 'telegram')).get();
      if (row) {
        this.config = safeJsonParse(row.value);
      }
    } catch {
      this.config = null;
    }
  }

  /** 保存配置到数据库 */
  saveConfig(cfg: TgConfig) {
    this.config = cfg;
    const existing = db.select().from(systemConfig)
      .where(eq(systemConfig.key, 'telegram')).get();

    if (existing) {
      db.update(systemConfig).set({
        value: JSON.stringify(cfg),
        updatedAt: new Date().toISOString(),
      }).where(eq(systemConfig.key, 'telegram')).run();
    } else {
      db.insert(systemConfig).values({
        key: 'telegram',
        value: JSON.stringify(cfg),
      }).run();
    }
  }

  getConfig(): TgConfig | null {
    if (!this.config) this.loadConfig();
    return this.config;
  }

  get isEnabled(): boolean {
    return !!this.config?.enabled && !!this.config.botToken;
  }

  // ===== 发送消息 =====

  /** 发送消息到指定 chatId */
  async send(chatId: string, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
    if (!this.config?.botToken) return false;

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });
      const data = await res.json() as any;
      if (!data.ok) {
        logger.error(`Telegram 发送失败: ${data.description}`);
        return false;
      }
      return true;
    } catch (err: any) {
      logger.error(`Telegram 发送异常: ${err.message}`);
      return false;
    }
  }

  /** 发送给管理员 */
  async notifyAdmin(text: string): Promise<boolean> {
    if (!this.isEnabled || !this.config?.adminChatId) return false;
    return this.send(this.config.adminChatId, text);
  }

  /** 发送给指定用户 (通过 telegramId) */
  async notifyUser(userId: number, text: string): Promise<boolean> {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user?.telegramId) return false;
    return this.send(user.telegramId, text);
  }

  // ===== 预定义告警模板 =====

  async alertNodeOffline(nodeName: string, nodeHost: string) {
    return this.notifyAdmin(
      `🔴 <b>节点离线</b>\n\n` +
      `节点: <code>${nodeName}</code>\n` +
      `地址: <code>${nodeHost}</code>\n` +
      `时间: ${new Date().toLocaleString('zh-CN')}`
    );
  }

  async alertNodeOnline(nodeName: string, nodeHost: string) {
    return this.notifyAdmin(
      `🟢 <b>节点恢复</b>\n\n` +
      `节点: <code>${nodeName}</code>\n` +
      `地址: <code>${nodeHost}</code>\n` +
      `时间: ${new Date().toLocaleString('zh-CN')}`
    );
  }

  async alertCertExpiring(domain: string, daysLeft: number) {
    return this.notifyAdmin(
      `⚠️ <b>证书即将过期</b>\n\n` +
      `域名: <code>${domain}</code>\n` +
      `剩余: ${daysLeft} 天\n` +
      `请及时续签！`
    );
  }

  async alertTrafficQuota(username: string, usedPct: number) {
    return this.notifyAdmin(
      `📊 <b>流量配额告警</b>\n\n` +
      `用户: <code>${username}</code>\n` +
      `已用: ${usedPct.toFixed(0)}%\n` +
      `${usedPct >= 100 ? '⛔ 配额已用尽，规则已暂停' : '⚠️ 即将用尽'}`
    );
  }

  async alertLoginAttempt(username: string, ip: string, success: boolean) {
    if (success) return; // 仅通知失败
    return this.notifyAdmin(
      `🔐 <b>登录失败</b>\n\n` +
      `用户: <code>${username}</code>\n` +
      `IP: <code>${ip}</code>\n` +
      `时间: ${new Date().toLocaleString('zh-CN')}`
    );
  }

  async alertBbrTune(target: string, from: string, to: string, reason: string) {
    return this.notifyAdmin(
      `⚡ <b>BBR 调参</b>\n\n` +
      `目标: <code>${target}</code>\n` +
      `变更: ${from} → <b>${to}</b>\n` +
      `原因: ${reason}`
    );
  }

  /** 发送每日摘要 */
  async sendDailySummary(stats: {
    nodesOnline: number; nodesTotal: number;
    rulesActive: number; rulesTotal: number;
    trafficUp: string; trafficDown: string;
    usersActive: number;
  }) {
    return this.notifyAdmin(
      `📋 <b>每日摘要</b>\n\n` +
      `节点: ${stats.nodesOnline}/${stats.nodesTotal} 在线\n` +
      `规则: ${stats.rulesActive}/${stats.rulesTotal} 运行\n` +
      `流量: ↑${stats.trafficUp} ↓${stats.trafficDown}\n` +
      `用户: ${stats.usersActive} 活跃\n` +
      `时间: ${new Date().toLocaleDateString('zh-CN')}`
    );
  }

  /** 测试连接 */
  async testConnection(botToken: string, chatId: string): Promise<{ ok: boolean; msg: string }> {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ 统一转发管理面板 — Telegram 通知测试成功！',
        }),
      });
      const data = await res.json() as any;
      return { ok: data.ok, msg: data.ok ? '发送成功' : (data.description || '发送失败') };
    } catch (err: any) {
      return { ok: false, msg: err.message };
    }
  }
}

export const telegramBot = new TelegramBotService();
