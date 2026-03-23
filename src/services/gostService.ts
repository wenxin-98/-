// src/services/gostService.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import { randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import http from 'http';
import { ENV } from '../config.js';
import { logger } from '../utils/logger.js';

// HTTP Keep-Alive 连接池 — 复用 TCP 连接减少延迟
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30000 });

// ===== 类型定义 =====

export interface GostNode {
  name: string;
  addr: string;
  connector?: {
    type: string;
    auth?: { username: string; password: string };
    metadata?: Record<string, string>;
  };
  dialer?: {
    type: string;
    tls?: { secure?: boolean; serverName?: string; minVersion?: string };
    metadata?: Record<string, string>;
  };
}

export interface GostHop {
  name: string;
  nodes: GostNode[];
}

export interface GostService {
  name: string;
  addr: string;
  handler: {
    type: string;
    chain?: string;
    auth?: { username: string; password: string };
    metadata?: Record<string, string>;
  };
  listener: {
    type: string;
    tls?: { certFile?: string; keyFile?: string; minVersion?: string };
    metadata?: Record<string, string>;
  };
  forwarder?: {
    nodes: Array<{ name: string; addr: string }>;
  };
  metadata?: Record<string, string>;
}

export interface GostChain {
  name: string;
  hops: GostHop[];
  metadata?: Record<string, string>;
}

// ===== 转发类型 =====

export type ForwardType =
  // 端口转发
  | 'port-forward-tcp'
  | 'port-forward-udp'
  | 'port-range-tcp'
  | 'reverse-tcp'
  | 'reverse-udp'
  // 隧道
  | 'tunnel-tls'
  | 'tunnel-wss'
  | 'tunnel-mwss'
  | 'tunnel-mtls'
  | 'tunnel-kcp'
  | 'tunnel-quic'
  | 'tunnel-ssh'
  // 代理
  | 'proxy-socks5'
  | 'proxy-http'
  | 'proxy-ss'
  | 'proxy-relay'
  | 'proxy-sni';

export interface CreateForwardOpts {
  name: string;
  listenPort: number;
  listenAddr?: string;       // 默认 0.0.0.0
  targetHost: string;
  targetPort: number;
  type: ForwardType;
  auth?: { username: string; password: string };
  chain?: string;            // 使用已有的转发链名称
  ssMethod?: string;         // proxy-ss 加密方式
  ssPassword?: string;       // proxy-ss 密码
  // port-range 专用
  listenStart?: number;
  listenEnd?: number;
  targetStart?: number;
}

export interface CreateChainOpts {
  name: string;
  hops: Array<{
    name: string;
    addr: string;
    transport: string;
    auth?: { username: string; password: string };
    tls?: { serverName?: string; minVersion?: string };
  }>;
}

// ===== GOST Service 类 =====

class GostApiService {
  private api: AxiosInstance;
  private connected = false;

  constructor() {
    this.api = axios.create({
      baseURL: ENV.GOST_API,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      httpAgent: keepAliveAgent,
    });

    // 响应拦截器
    this.api.interceptors.response.use(
      res => res,
      (err: AxiosError) => {
        const msg = err.response?.data
          ? JSON.stringify(err.response.data)
          : err.message;
        logger.error(`GOST API 错误: ${err.config?.method?.toUpperCase()} ${err.config?.url} → ${msg}`);
        throw err;
      }
    );
  }

  // ===== 连接检测 =====

  async checkConnection(): Promise<boolean> {
    try {
      await this.api.get('/config');
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  get isConnected() { return this.connected; }

  /** 获取完整 GOST 配置 */
  async getConfig(): Promise<any> {
    const { data } = await this.api.get('/config');
    return data;
  }

  // ============================
  // ===== 服务 (Services) =====
  // ============================

  /** 列出所有服务 */
  async listServices(): Promise<GostService[]> {
    const { data } = await this.api.get('/config');
    return data?.services || [];
  }

  /** 创建端口转发 */
  async createPortForward(opts: CreateForwardOpts): Promise<void> {
    const isTcp = opts.type === 'port-forward-tcp';
    const protocol = isTcp ? 'tcp' : 'udp';
    const bindAddr = opts.listenAddr || '0.0.0.0';

    const service: GostService = {
      name: opts.name,
      addr: `${bindAddr}:${opts.listenPort}`,
      handler: {
        type: protocol,
        ...(opts.chain && { chain: opts.chain }),
      },
      listener: {
        type: protocol,
      },
      forwarder: {
        nodes: [{
          name: `${opts.name}-target`,
          addr: `${opts.targetHost}:${opts.targetPort}`,
        }],
      },
    };

    await this.api.post('/config/services', service);
    logger.info(`创建端口转发: ${opts.name} ${protocol}://${bindAddr}:${opts.listenPort} → ${opts.targetHost}:${opts.targetPort}`);
  }

  /** 创建加密隧道服务端 (监听端) */
  async createTunnelServer(opts: CreateForwardOpts): Promise<void> {
    const transport = opts.type.replace('tunnel-', ''); // tls, wss, kcp, quic

    const service: GostService = {
      name: opts.name,
      addr: `:${opts.listenPort}`,
      handler: {
        type: 'relay',
        ...(opts.auth && { auth: opts.auth }),
      },
      listener: {
        type: transport,
        ...(transport === 'tls' && {
          tls: {
            certFile: resolve(dirname(ENV.DB_PATH), 'certs/server.crt'),
            keyFile: resolve(dirname(ENV.DB_PATH), 'certs/server.key'),
            minVersion: 'VersionTLS12',
          },
        }),
        metadata: {
          keepAlive: 'true',
          keepAlivePeriod: '30s',
        },
      },
    };

    await this.api.post('/config/services', service);
    logger.info(`创建隧道服务端: ${opts.name} ${transport}://:${opts.listenPort}`);
  }

  /** 创建隧道+转发组合 (入口端: 本地监听 → 通过隧道链 → 远端目标) */
  async createTunnelForward(opts: CreateForwardOpts): Promise<{ serviceName: string; chainName: string }> {
    const transport = opts.type.replace('tunnel-', '');
    const chainName = `chain-${opts.name}`;
    const serviceName = `svc-${opts.name}`;

    // 传输层优化参数
    const isMux = transport === 'mwss' || transport === 'mtls';
    const isKcp = transport === 'kcp';
    const isQuic = transport === 'quic';
    const isTls = transport === 'tls' || transport === 'mtls';
    const isWss = transport === 'wss' || transport === 'mwss';

    // TLS 安全: 最低 TLS 1.2
    const tlsConfig = (isTls || isWss) ? {
      tls: {
        secure: false,
        serverName: opts.targetHost,
        minVersion: 'VersionTLS12',
      },
    } : {};

    // 1. 创建转发链 (到远端隧道服务端)
    const chain: GostChain = {
      name: chainName,
      hops: [{
        name: `hop-${opts.name}`,
        nodes: [{
          name: `node-${opts.name}`,
          addr: `${opts.targetHost}:${opts.targetPort}`,
          connector: {
            type: 'relay',
            ...(opts.auth && { auth: opts.auth }),
            metadata: {
              'sniffing': 'true',
              ...(isMux ? { 'mux': 'true', 'mux.maxClients': '10' } : {}),
            },
          },
          dialer: {
            type: transport,
            ...tlsConfig,
            metadata: {
              keepAlive: 'true',
              keepAlivePeriod: '30s',
              ...(isKcp ? { 'kcp.nodelay': '1', 'kcp.interval': '20', 'kcp.resend': '2', 'kcp.nc': '1', 'kcp.sndwnd': '1024', 'kcp.rcvwnd': '1024', 'kcp.mtu': '1350', 'kcp.keepalive': '10' } : {}),
              ...(isQuic ? { 'quic.keepalive': 'true', 'quic.maxIdleTimeout': '30s' } : {}),
            },
          },
        }],
      }],
    };

    await this.api.post('/config/chains', chain);

    // 2. 创建本地监听服务 (绑定到该链)
    const service: GostService = {
      name: serviceName,
      addr: `:${opts.listenPort}`,
      handler: {
        type: 'tcp',
        chain: chainName,
      },
      listener: {
        type: 'tcp',
      },
      forwarder: {
        nodes: [{
          name: `${opts.name}-target`,
          addr: `${opts.targetHost}:${opts.targetPort}`,
        }],
      },
    };

    await this.api.post('/config/services', service);
    logger.info(`创建隧道转发: ${opts.name} :${opts.listenPort} → ${transport}://${opts.targetHost}:${opts.targetPort}`);

    return { serviceName, chainName };
  }

  /** 通用创建 — 根据类型自动分发 */
  async createForward(opts: CreateForwardOpts): Promise<{ serviceName: string; chainName?: string }> {
    const serviceName = `svc-${opts.name}`;

    // 端口转发 (TCP/UDP)
    if (opts.type === 'port-forward-tcp' || opts.type === 'port-forward-udp') {
      await this.createPortForward({ ...opts, name: serviceName });
      return { serviceName };
    }

    // 端口范围转发 — 批量创建多个服务
    if (opts.type === 'port-range-tcp') {
      const start = opts.listenStart || opts.listenPort;
      const end = opts.listenEnd || start;
      const targetStart = opts.targetStart || start;
      const count = end - start + 1;

      if (count < 1 || count > 200) throw new Error(`端口范围无效: ${start}-${end} (最多 200)`);

      const createdNames: string[] = [];
      for (let i = 0; i < count; i++) {
        const svcName = `${serviceName}-${start + i}`;
        const service: GostService = {
          name: svcName,
          addr: `:${start + i}`,
          handler: { type: 'tcp' },
          listener: { type: 'tcp' },
          forwarder: {
            nodes: [{ name: `${svcName}-t`, addr: `${opts.targetHost}:${targetStart + i}` }],
          },
        };
        await this.api.post('/config/services', service);
        createdNames.push(svcName);
      }

      logger.info(`创建端口范围转发: ${serviceName} :${start}-${end} → ${opts.targetHost}:${targetStart}-${targetStart + count - 1} (${count} 条)`);
      return { serviceName: createdNames.join(',') };
    }

    // 反向端口转发
    if (opts.type === 'reverse-tcp' || opts.type === 'reverse-udp') {
      const proto = opts.type === 'reverse-tcp' ? 'rtcp' : 'rudp';
      const service: GostService = {
        name: serviceName,
        addr: `:${opts.listenPort}`,
        handler: { type: proto, ...(opts.chain && { chain: opts.chain }) },
        listener: { type: proto },
        forwarder: {
          nodes: [{ name: `${serviceName}-target`, addr: `${opts.targetHost}:${opts.targetPort}` }],
        },
      };
      await this.api.post('/config/services', service);
      logger.info(`创建反向转发: ${serviceName} ${proto}://:${opts.listenPort}`);
      return { serviceName };
    }

    // 代理类型 (socks5, http, relay, sni)
    if (opts.type.startsWith('proxy-')) {
      const proxyType = opts.type.replace('proxy-', ''); // socks5, http, ss, relay, sni
      let handlerType: string;
      let listenerType = 'tcp';

      switch (proxyType) {
        case 'socks5': handlerType = 'socks5'; break;
        case 'http':   handlerType = 'http'; break;
        case 'relay':  handlerType = 'relay'; break;
        case 'sni':    handlerType = 'sni'; break;
        case 'ss': {
          // Shadowsocks 代理 — 自动生成密码
          const ssPass = opts.ssPassword || randomBytes(16).toString('base64');
          const service: GostService = {
            name: serviceName,
            addr: `:${opts.listenPort}`,
            handler: {
              type: 'ss',
              metadata: {
                method: opts.ssMethod || 'aes-256-gcm',
                password: ssPass,
              },
            },
            listener: { type: 'tcp' },
          };
          await this.api.post('/config/services', service);
          logger.info(`创建 SS 代理: ${serviceName} :${opts.listenPort}`);
          return { serviceName };
        }
        default: handlerType = proxyType;
      }

      const service: GostService = {
        name: serviceName,
        addr: `:${opts.listenPort}`,
        handler: {
          type: handlerType,
          ...(opts.auth && { auth: opts.auth }),
          ...(opts.chain && { chain: opts.chain }),
        },
        listener: { type: listenerType },
      };
      await this.api.post('/config/services', service);
      logger.info(`创建 ${proxyType} 代理: ${serviceName} :${opts.listenPort}`);
      return { serviceName };
    }

    // 隧道类转发 (tunnel-*)
    if (opts.type.startsWith('tunnel-')) {
      return this.createTunnelForward({ ...opts, name: opts.name });
    }

    // 未知类型回退为 TCP 转发
    logger.warn(`未知协议类型: ${opts.type}，回退为 TCP 转发`);
    await this.createPortForward({ ...opts, name: serviceName, type: 'port-forward-tcp' });
    return { serviceName };
  }

  /** 删除服务 */
  async deleteService(name: string): Promise<void> {
    await this.api.delete(`/config/services/${name}`);
    logger.info(`删除服务: ${name}`);
  }

  /** 更新服务 */
  async updateService(name: string, service: Partial<GostService>): Promise<void> {
    await this.api.put(`/config/services/${name}`, service);
    logger.info(`更新服务: ${name}`);
  }

  // ==========================
  // ===== 链 (Chains) =====
  // ==========================

  /** 列出所有转发链 */
  async listChains(): Promise<GostChain[]> {
    const { data } = await this.api.get('/config');
    return data?.chains || [];
  }

  /** 创建多跳转发链 */
  async createChain(opts: CreateChainOpts): Promise<string> {
    const chainName = `chain-${opts.name}`;

    const chain: GostChain = {
      name: chainName,
      hops: opts.hops.map((hop, idx) => ({
        name: `hop-${idx}-${hop.name}`,
        nodes: [{
          name: `node-${idx}-${hop.name}`,
          addr: hop.addr,
          connector: {
            type: 'relay',
            ...(hop.auth && { auth: hop.auth }),
          },
          dialer: {
            type: hop.transport,
            ...(hop.tls && { tls: hop.tls }),
          },
        }],
      })),
    };

    await this.api.post('/config/chains', chain);
    logger.info(`创建转发链: ${chainName} (${opts.hops.length} 跳)`);
    return chainName;
  }

  /** 删除转发链 */
  async deleteChain(name: string): Promise<void> {
    await this.api.delete(`/config/chains/${name}`);
    logger.info(`删除转发链: ${name}`);
  }

  // ===== 工具方法 =====

  /** 批量删除 (先删服务再删链) */
  async deleteForwardAndChain(serviceName: string, chainName?: string): Promise<void> {
    try {
      await this.deleteService(serviceName);
    } catch (e) {
      logger.warn(`删除服务失败: ${serviceName}`);
    }
    if (chainName) {
      try {
        await this.deleteChain(chainName);
      } catch (e) {
        logger.warn(`删除转发链失败: ${chainName}`);
      }
    }
  }

  /** 重载配置 (从文件重新加载) */
  async reloadConfig(): Promise<void> {
    const { runCommand } = await import('../utils/shell.js');
    await runCommand('systemctl restart gost');
    logger.info('GOST 服务已重启');
  }

  // ================================
  // ===== Limiter (限速器) =====
  // ================================

  /** 列出所有限速器 */
  async listLimiters(): Promise<any[]> {
    try {
      const { data } = await this.api.get('/config');
      return data?.limiters || [];
    } catch { return []; }
  }

  /** 创建限速器 */
  async createLimiter(name: string, limits: Array<{
    match?: string;  // "*" = 全局, "cidr" = IP 段
    rate: string;    // "10MB" "1GB"
    period?: string; // "1s" "1m" "1h"
  }>): Promise<void> {
    const limiter = {
      name,
      limits: limits.map(l => ({
        ...(l.match && { match: l.match }),
        rate: l.rate,
        period: l.period || '1s',
      })),
    };
    await this.api.post('/config/limiters', limiter);
    logger.info(`创建限速器: ${name} (${limits.length} 条规则)`);
  }

  /** 删除限速器 */
  async deleteLimiter(name: string): Promise<void> {
    await this.api.delete(`/config/limiters/${name}`);
    logger.info(`删除限速器: ${name}`);
  }

  // ================================
  // ===== Bypass (分流器) =====
  // ================================

  /** 列出所有分流规则 */
  async listBypasses(): Promise<any[]> {
    try {
      const { data } = await this.api.get('/config');
      return data?.bypasses || [];
    } catch { return []; }
  }

  /** 创建分流规则 */
  async createBypass(name: string, matchers: string[], whitelist = false): Promise<void> {
    const bypass = {
      name,
      whitelist,
      matchers: matchers.map(m => ({ match: m })),
    };
    await this.api.post('/config/bypasses', bypass);
    logger.info(`创建分流: ${name} (${matchers.length} 条, whitelist=${whitelist})`);
  }

  /** 删除分流规则 */
  async deleteBypass(name: string): Promise<void> {
    await this.api.delete(`/config/bypasses/${name}`);
    logger.info(`删除分流: ${name}`);
  }

  // ================================
  // ===== Admission (准入控制) =====
  // ================================

  /** 列出准入控制 */
  async listAdmissions(): Promise<any[]> {
    try {
      const { data } = await this.api.get('/config');
      return data?.admissions || [];
    } catch { return []; }
  }

  /** 创建准入控制 */
  async createAdmission(name: string, matchers: string[], whitelist = false): Promise<void> {
    await this.api.post('/config/admissions', {
      name, whitelist,
      matchers: matchers.map(m => ({ match: m })),
    });
    logger.info(`创建准入控制: ${name}`);
  }

  /** 删除准入控制 */
  async deleteAdmission(name: string): Promise<void> {
    await this.api.delete(`/config/admissions/${name}`);
  }

  // ================================
  // ===== Resolver (DNS) =====
  // ================================

  /** 列出 DNS 解析器 */
  async listResolvers(): Promise<any[]> {
    try {
      const { data } = await this.api.get('/config');
      return data?.resolvers || [];
    } catch { return []; }
  }

  /** 创建 DNS 解析器 */
  async createResolver(name: string, nameservers: Array<{
    addr: string;   // "udp://8.8.8.8:53" "tls://1.1.1.1:853"
    prefer?: string; // "ipv4" "ipv6"
  }>): Promise<void> {
    await this.api.post('/config/resolvers', {
      name, nameservers,
    });
    logger.info(`创建 DNS 解析器: ${name}`);
  }

  /** 删除 DNS 解析器 */
  async deleteResolver(name: string): Promise<void> {
    await this.api.delete(`/config/resolvers/${name}`);
  }

  // ======================================
  // ===== Selector (负载均衡) =====
  // ======================================

  /**
   * 创建负载均衡转发 — 单端口多目标
   * strategy: round (轮询) | random (随机) | fifo (优先级)
   */
  async createLoadBalancedForward(opts: {
    name: string;
    listenPort: number;
    targets: Array<{ host: string; port: number; weight?: number }>;
    strategy?: 'round' | 'random' | 'fifo';
    protocol?: 'tcp' | 'udp';
  }): Promise<string> {
    const serviceName = `svc-lb-${opts.name}`;
    const proto = opts.protocol || 'tcp';

    const service: GostService = {
      name: serviceName,
      addr: `:${opts.listenPort}`,
      handler: { type: proto },
      listener: { type: proto },
      forwarder: {
        nodes: opts.targets.map((t, i) => ({
          name: `${serviceName}-t${i}`,
          addr: `${t.host}:${t.port}`,
          ...(t.weight && {
            metadata: { weight: String(t.weight) },
          }),
        })),
        // GOST v3 forwarder selector
        ...(opts.strategy && {
          selector: {
            strategy: opts.strategy,
            ...(opts.strategy === 'round' && { maxFails: 3, failTimeout: '30s' }),
          },
        }),
      },
    };

    await this.api.post('/config/services', service);
    logger.info(`创建负载均衡: ${serviceName} :${opts.listenPort} → ${opts.targets.length} 目标 (${opts.strategy || 'round'})`);
    return serviceName;
  }

  /**
   * 更新转发目标列表 (热更新，不断连)
   */
  async updateForwarderTargets(serviceName: string, targets: Array<{ host: string; port: number; weight?: number }>): Promise<void> {
    // 先获取当前服务配置
    const services = await this.listServices();
    const svc = services.find(s => s.name === serviceName);
    if (!svc) throw new Error(`服务 ${serviceName} 不存在`);

    const updated = {
      ...svc,
      forwarder: {
        ...svc.forwarder,
        nodes: targets.map((t, i) => ({
          name: `${serviceName}-t${i}`,
          addr: `${t.host}:${t.port}`,
          ...(t.weight && { metadata: { weight: String(t.weight) } }),
        })),
      },
    };

    await this.api.put(`/config/services/${serviceName}`, updated);
    logger.info(`更新负载均衡目标: ${serviceName} → ${targets.length} 目标`);
  }
}

// 单例导出
export const gostApi = new GostApiService();
