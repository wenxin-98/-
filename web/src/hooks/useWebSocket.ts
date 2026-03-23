// src/hooks/useWebSocket.ts
import { useState, useEffect, useRef, useCallback } from 'react';

type WsMessage = {
  type: string;
  channel?: string;
  data?: any;
  ts?: number;
};

type WsListener = (data: any) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<WsListener>>>(new Map());
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?token=${token}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCount.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const msg: WsMessage = JSON.parse(e.data);
          if (msg.type === 'push' && msg.channel) {
            const listeners = listenersRef.current.get(msg.channel);
            listeners?.forEach(fn => fn(msg.data));
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // 重连 (指数退避, 最大 30 秒)
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30000);
        retryCount.current++;
        reconnectRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    } catch {}
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((channel: string, listener: WsListener) => {
    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel)!.add(listener);

    // 通知服务端订阅
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel }));
    }

    return () => {
      listenersRef.current.get(channel)?.delete(listener);
    };
  }, []);

  return { connected, subscribe };
}
