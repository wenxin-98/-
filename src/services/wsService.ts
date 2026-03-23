// src/services/wsService.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from '../utils/logger.js';
import { verifyToken, type JwtPayload } from '../middleware/auth.js';

interface WsClient {
  ws: WebSocket;
  user: JwtPayload;
  subscribedChannels: Set<string>;
  lastPing: number;
}

/**
 * WebSocket 实时推送
 *
 * 频道:
 *   - nodes:status     节点在线/离线状态变更
 *   - traffic:realtime 实时流量数据 (每 5 秒)
 *   - deploy:log       SSH 部署实时日志
 *   - alerts           告警 (证书过期、节点离线)
 */
class WsService {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WsClient>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  init(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      // 从 URL 参数提取 token
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, '缺少 token');
        return;
      }

      const user = verifyToken(token);
      if (!user) {
        ws.close(4002, 'token 无效');
        return;
      }

      const clientId = `${user.userId}-${Date.now()}`;
      const client: WsClient = {
        ws,
        user,
        subscribedChannels: new Set(['nodes:status', 'alerts']),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);
      logger.debug(`WS 连接: ${user.username} (${clientId})`);

      ws.on('message', (raw) => {
        try {
          let msg: any; try { msg = JSON.parse(raw.toString()); } catch { return; }
          this.handleMessage(clientId, msg);
        } catch {}
      });

      ws.on('pong', () => {
        client.lastPing = Date.now();
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        logger.debug(`WS 断开: ${clientId}`);
      });

      // 发送欢迎消息
      this.sendTo(ws, { type: 'connected', clientId, channels: [...client.subscribedChannels] });
    });

    // 心跳检测 30 秒
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastPing > 60000) {
          client.ws.terminate();
          this.clients.delete(id);
        } else {
          client.ws.ping();
        }
      }
    }, 30000);

    logger.info('WebSocket 服务已启动 (/ws)');
  }

  private handleMessage(clientId: string, msg: any) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'subscribe':
        if (msg.channel) client.subscribedChannels.add(msg.channel);
        break;
      case 'unsubscribe':
        if (msg.channel) client.subscribedChannels.delete(msg.channel);
        break;
      case 'ping':
        this.sendTo(client.ws, { type: 'pong', ts: Date.now() });
        break;
    }
  }

  // ===== 广播方法 =====

  /** 向指定频道广播 */
  broadcast(channel: string, data: any) {
    const msg = JSON.stringify({ type: 'push', channel, data, ts: Date.now() });
    for (const client of this.clients.values()) {
      if (client.subscribedChannels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** 向特定用户推送 */
  sendToUser(userId: number, channel: string, data: any) {
    const msg = JSON.stringify({ type: 'push', channel, data, ts: Date.now() });
    for (const client of this.clients.values()) {
      if (client.user.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** 节点状态变更推送 */
  pushNodeStatus(nodeId: number, name: string, status: string) {
    this.broadcast('nodes:status', { nodeId, name, status });
  }

  /** 部署日志实时推送 */
  pushDeployLog(userId: number, nodeId: number, line: string) {
    this.sendToUser(userId, 'deploy:log', { nodeId, line });
  }

  /** 告警推送 */
  pushAlert(alert: { level: 'info' | 'warn' | 'error'; title: string; detail?: string }) {
    this.broadcast('alerts', alert);
  }

  /** 流量数据推送 */
  pushTrafficData(data: any) {
    this.broadcast('traffic:realtime', data);
  }

  get clientCount() { return this.clients.size; }

  private sendTo(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss?.close();
  }
}

export const wsService = new WsService();