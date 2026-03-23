// src/services/xuiService.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import http from 'http';
import { ENV } from '../config.js';
import { logger } from '../utils/logger.js';
import { generateUUID, generateShortId, generatePassword, generateSS2022Key, generateX25519, generateRealityConfig, generateWgKeys } from '../utils/xrayCrypto.js';

// ===== 类型定义 =====

export interface XuiInbound {
  id: number;
  remark: string;
  protocol: 'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'tuic' | 'wireguard' | 'socks' | 'http' | 'dokodemo';
  port: number;
  settings: string;         // JSON string
  streamSettings: string;   // JSON string
  sniffing: string;         // JSON string
  tag: string;
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
  clientStats: any[];
}

export interface CreateInboundOpts {
  remark: string;
  protocol: 'vmess' | 'vless' | 'trojan' | 'shadowsocks' | 'hysteria2' | 'tuic' | 'wireguard' | 'socks' | 'http' | 'dokodemo';
  port: number;
  settings?: any;
  streamSettings?: any;
  sniffing?: any;
  enable?: boolean;
  extra?: Record<string, any>;  // 额外参数传给默认配置生成
}

export interface XuiServerStatus {
  cpu: number;
  mem: { current: number; total: number };
  disk: { current: number; total: number };
  xray: { state: string; version: string };
  uptime: number;
  loads: number[];
  tcpCount: number;
  udpCount: number;
  netIO: { up: number; down: number };
  netTraffic: { sent: number; recv: number };
}

// ===== 3X-UI Service 类 =====

class XuiApiService {
  private api: AxiosInstance;
  private cookie: string = '';
  private loginTime: number = 0;
  private connected = false;
  private xuiUser: string;
  private xuiPass: string;

  constructor(baseUrl?: string, user?: string, pass?: string) {
    this.api = axios.create({
      baseURL: baseUrl || ENV.XUI_API,
      timeout: 15000,
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 5 }),
    });
    this.xuiUser = user || ENV.XUI_USER;
    this.xuiPass = pass || ENV.XUI_PASS;
  }

  // ===== 认证 =====

  /** 登录 3X-UI 获取 session cookie */
  async login(): Promise<boolean> {
    try {
      // 3X-UI 只接受 form-urlencoded 格式登录
      const res = await this.api.post('/login',
        `username=${encodeURIComponent(this.xuiUser)}&password=${encodeURIComponent(this.xuiPass)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      logger.info(`3X-UI login 响应: success=${res.data?.success}, set-cookie=${res.headers['set-cookie']?.length || 0} 条`);

      if (res.data?.success) {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          this.cookie = setCookie.map((c: string) => c.split(';')[0]).join('; ');
          logger.info(`3X-UI cookie 获取成功 (${this.cookie.length} 字符)`);
        } else {
          logger.error('3X-UI 登录成功但未返回 cookie');
        }
        this.loginTime = Date.now();
        this.connected = true;
        return true;
      }

      logger.error('3X-UI 登录失败: ', res.data?.msg);
      return false;
    } catch (err: any) {
      logger.error(`3X-UI 登录异常: ${err.message}`);
      this.connected = false;
      return false;
    }
  }

  /** 带认证的请求 (自动重试登录) */
  private async request<T = any>(method: string, path: string, data?: any): Promise<T> {
    // cookie 超过 30 分钟自动重新登录
    if (!this.cookie || Date.now() - this.loginTime > 30 * 60 * 1000) {
      const ok = await this.login();
      if (!ok) throw new Error('3X-UI 登录失败');
    }

    logger.info(`3X-UI 请求: ${method} ${path} | cookie: ${this.cookie ? this.cookie.substring(0, 30) + '...' : '(空)'}`);

    const doRequest = () =>
      this.api.request({
        method, url: path, data,
        headers: { Cookie: this.cookie },
        maxRedirects: 0,
      });

    try {
      const res = await doRequest();
      return res.data;
    } catch (err: any) {
      const status = err.response?.status;
      const respData = err.response?.data;
      logger.error(`3X-UI 请求失败: ${method} ${path} → ${status || err.code || err.message} | resp: ${typeof respData === 'string' ? respData.substring(0, 100) : JSON.stringify(respData)?.substring(0, 100)}`);
      // 302/307 重定向 = session 过期; 401 = 未授权
      if (status === 302 || status === 307 || status === 401) {
        logger.debug(`3X-UI session 过期 (${status})，重新登录`);
        await this.login();
        try {
          const res = await doRequest();
          return res.data;
        } catch (retryErr: any) {
          logger.error(`3X-UI 重试失败: ${method} ${path} → ${retryErr.response?.status || retryErr.message}`);
          throw retryErr;
        }
      }
      throw err;
    }
  }

  // ===== 连接检测 =====

  async checkConnection(): Promise<boolean> {
    try {
      await this.login();
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  get isConnected() { return this.connected; }

  // ===== 入站管理 =====

  /** 获取所有入站 */
  async listInbounds(): Promise<XuiInbound[]> {
    const res = await this.request('POST', '/panel/inbound/list');
    return res?.obj || [];
  }

  /** 获取单个入站 */
  async getInbound(id: number): Promise<XuiInbound | null> {
    const res = await this.request('GET', `/panel/inbound/get/${id}`);
    return res?.obj || null;
  }

  /** 创建入站 — 自动生成所有密钥/UUID/密码 */
  async addInbound(opts: CreateInboundOpts): Promise<any> {
    const settings = opts.settings || await this.buildDefaultSettings(opts.protocol, opts.extra);
    const streamSettings = opts.streamSettings || await this.buildDefaultStreamSettings(opts.protocol, opts.extra);

    const payload = {
      remark: opts.remark,
      protocol: opts.protocol,
      port: opts.port,
      enable: opts.enable !== false,
      settings: JSON.stringify(settings),
      streamSettings: JSON.stringify(streamSettings),
      sniffing: JSON.stringify(opts.sniffing || {
        enabled: true,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
      }),
    };

    const res = await this.request('POST', '/panel/inbound/add', payload);
    logger.info(`创建 3X-UI 入站: ${opts.remark} (${opts.protocol}:${opts.port})`);
    return res;
  }

  /** 删除入站 */
  async deleteInbound(id: number): Promise<any> {
    const res = await this.request('POST', `/panel/inbound/del/${id}`);
    logger.info(`删除 3X-UI 入站: ID=${id}`);
    return res;
  }

  /** 更新入站 */
  async updateInbound(id: number, opts: Partial<CreateInboundOpts>): Promise<any> {
    const current = await this.getInbound(id);
    if (!current) throw new Error(`入站 ${id} 不存在`);

    const payload: any = {
      ...current,
      ...(opts.remark && { remark: opts.remark }),
      ...(opts.port && { port: opts.port }),
      ...(opts.enable !== undefined && { enable: opts.enable }),
    };

    if (opts.settings) payload.settings = JSON.stringify(opts.settings);
    if (opts.streamSettings) payload.streamSettings = JSON.stringify(opts.streamSettings);

    const res = await this.request('POST', `/panel/inbound/update/${id}`, payload);
    logger.info(`更新 3X-UI 入站: ID=${id}`);
    return res;
  }

  /** 重置入站流量 */
  async resetInboundTraffic(id: number): Promise<any> {
    return this.request('POST', `/panel/inbound/resetTraffic/${id}`);
  }

  /** 启用/禁用入站 */
  async toggleInbound(id: number, enable: boolean): Promise<any> {
    return this.updateInbound(id, { enable });
  }

  // ===== 客户端管理 =====

  /** 获取入站的所有客户端 */
  async getClients(inboundId: number): Promise<any[]> {
    const ib = await this.getInbound(inboundId);
    if (!ib) throw new Error(`入站 ${inboundId} 不存在`);

    const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
    const clients = settings?.clients || [];

    // 合并流量统计
    const stats = ib.clientStats || [];
    return clients.map((c: any) => {
      const stat = stats.find((s: any) => s.email === c.email);
      return {
        ...c,
        up: stat?.up || 0,
        down: stat?.down || 0,
        total: stat?.total || 0,
        enable: c.enable !== false,
        inboundId,
      };
    });
  }

  /** 添加客户端到入站 */
  async addClient(inboundId: number, client: {
    email: string;
    uuid?: string;       // vless/vmess/tuic
    password?: string;   // trojan/hysteria2
    flow?: string;
    limitIp?: number;
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
  }): Promise<any> {
    const ib = await this.getInbound(inboundId);
    if (!ib) throw new Error(`入站 ${inboundId} 不存在`);

    const protocol = ib.protocol;
    const newClient: any = {
      email: client.email || `user-${Date.now()}@panel`,
      limitIp: client.limitIp || 0,
      totalGB: (client.totalGB || 0) * 1073741824, // GB → bytes
      expiryTime: client.expiryTime || 0,
      enable: client.enable !== false,
    };

    // 按协议设置标识字段
    if (protocol === 'vless' || protocol === 'vmess') {
      newClient.id = client.uuid || generateUUID();
      if (protocol === 'vless') {
        newClient.flow = client.flow || '';
      }
      if (protocol === 'vmess') {
        newClient.alterId = 0;
      }
    } else if (protocol === 'trojan' || protocol === 'hysteria2') {
      newClient.password = client.password || generatePassword(24);
    } else if (protocol === 'tuic') {
      newClient.id = client.uuid || generateUUID();
      newClient.password = client.password || generatePassword(16);
    }

    // 3X-UI 的 addClient API
    const payload = {
      id: inboundId,
      settings: JSON.stringify({ clients: [newClient] }),
    };

    const res = await this.request('POST', `/panel/inbound/addClient`, payload);
    logger.info(`添加客户端: inbound=${inboundId} email=${newClient.email}`);
    return { ...res, client: newClient };
  }

  /** 更新客户端 */
  async updateClient(inboundId: number, clientUUID: string, updates: {
    email?: string;
    limitIp?: number;
    totalGB?: number;
    expiryTime?: number;
    enable?: boolean;
  }): Promise<any> {
    const ib = await this.getInbound(inboundId);
    if (!ib) throw new Error(`入站 ${inboundId} 不存在`);

    const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
    const clients: any[] = settings?.clients || [];

    const target = clients.find((c: any) => c.id === clientUUID || c.password === clientUUID || c.email === clientUUID);
    if (!target) throw new Error('客户端不存在');

    // 合并更新
    if (updates.email) target.email = updates.email;
    if (updates.limitIp !== undefined) target.limitIp = updates.limitIp;
    if (updates.totalGB !== undefined) target.totalGB = updates.totalGB * 1073741824;
    if (updates.expiryTime !== undefined) target.expiryTime = updates.expiryTime;
    if (updates.enable !== undefined) target.enable = updates.enable;

    // 3X-UI updateClient API 用 client UUID 作路径
    const payload = {
      id: inboundId,
      settings: JSON.stringify({ clients: [target] }),
    };

    const clientId = target.id || target.password;
    const res = await this.request('POST', `/panel/inbound/updateClient/${clientId}`, payload);
    logger.info(`更新客户端: inbound=${inboundId} id=${clientId}`);
    return res;
  }

  /** 删除客户端 */
  async removeClient(inboundId: number, clientId: string): Promise<any> {
    const res = await this.request('POST', `/panel/inbound/${inboundId}/delClient/${clientId}`);
    logger.info(`删除客户端: inbound=${inboundId} id=${clientId}`);
    return res;
  }

  /** 重置客户端流量 */
  async resetClientTraffic(inboundId: number, email: string): Promise<any> {
    return this.request('POST', `/panel/inbound/${inboundId}/resetClientTraffic/${email}`);
  }

  // ===== 服务器状态 =====

  /** 获取服务器状态 */
  async getServerStatus(): Promise<XuiServerStatus | null> {
    const res = await this.request('POST', '/server/status');
    return res?.obj || null;
  }

  /** 获取 Xray 版本 */
  async getXrayVersion(): Promise<string> {
    const res = await this.request('POST', '/server/getXrayVersion');
    return res?.obj || 'unknown';
  }

  /** 重启 Xray */
  async restartXray(): Promise<any> {
    const res = await this.request('POST', '/server/restartXray');
    logger.info('Xray 已重启');
    return res;
  }

  // ===== 面板设置 =====

  /** 获取面板设置 */
  async getPanelSettings(): Promise<any> {
    const res = await this.request('POST', '/panel/setting/all');
    return res?.obj || {};
  }

  // ===== 自动生成配置 (异步, 含密钥生成) =====

  private async buildDefaultSettings(protocol: string, extra?: Record<string, any>): Promise<any> {
    const uuid = generateUUID();
    const email = `user-${Date.now()}@panel`;
    const clientBase = { email, limitIp: 0, totalGB: 0, expiryTime: 0, enable: true };

    switch (protocol) {
      case 'vless':
        // xtls-rprx-vision 只兼容 TCP，其他传输必须清空 flow
        const network = extra?.network || 'tcp';
        const vlessFlow = (network === 'tcp') ? (extra?.flow || 'xtls-rprx-vision') : '';
        return {
          clients: [{
            ...clientBase,
            id: uuid,
            flow: vlessFlow,
          }],
          decryption: 'none',
          fallbacks: extra?.fallbackAddr ? [{ dest: extra.fallbackAddr }] : [],
        };

      case 'vmess':
        return {
          clients: [{
            ...clientBase,
            id: uuid,
            alterId: 0,
          }],
        };

      case 'trojan':
        return {
          clients: [{
            ...clientBase,
            password: generatePassword(24),
          }],
          fallbacks: extra?.fallbackAddr ? [{ dest: extra.fallbackAddr }] : [],
        };

      case 'shadowsocks': {
        const method = extra?.ssMethod || '2022-blake3-aes-256-gcm';
        const isSS2022 = method.startsWith('2022-');
        return {
          method,
          password: isSS2022 ? generateSS2022Key(method) : generatePassword(16),
          network: extra?.ssNetwork || 'tcp,udp',
          clients: [],
        };
      }

      case 'hysteria2':
        return {
          clients: [{
            ...clientBase,
            password: generatePassword(24),
          }],
          ...(extra?.hy2Obfs && extra.hy2Obfs !== '' && {
            obfs: {
              type: extra.hy2Obfs,
              password: extra.hy2ObfsPassword || generatePassword(16),
            },
          }),
        };

      case 'tuic':
        return {
          clients: [{
            ...clientBase,
            id: uuid,
            password: generatePassword(16),
          }],
          congestion: extra?.tuicCongestion || 'bbr',
        };

      case 'wireguard': {
        // WireGuard 需要两对密钥: 服务端 + 客户端
        let serverKeys: { privateKey: string; publicKey: string };
        let clientKeys: { privateKey: string; publicKey: string };
        try {
          serverKeys = await generateWgKeys();
          clientKeys = await generateWgKeys();
        } catch {
          serverKeys = { privateKey: '', publicKey: '' };
          clientKeys = { privateKey: '', publicKey: '' };
          logger.warn('WireGuard 密钥生成失败，需手动填写');
        }
        return {
          mtu: parseInt(extra?.wgMtu) || 1420,
          secretKey: serverKeys.privateKey,          // 服务端私钥 (Xray 使用)
          peers: [{
            publicKey: clientKeys.publicKey,          // 客户端公钥 (服务端验证用)
            allowedIPs: ['0.0.0.0/0', '::/0'],
          }],
          // 额外存储: 客户端配置信息 (用于生成订阅链接)
          _clientPrivateKey: clientKeys.privateKey,   // 客户端私钥 (给用户)
          _serverPublicKey: serverKeys.publicKey,     // 服务端公钥 (客户端连接用)
        };
      }

      case 'socks':
        return {
          auth: (extra?.authUser) ? 'password' : 'noauth',
          accounts: (extra?.authUser) ? [{
            user: extra.authUser,
            pass: extra.authPass || generatePassword(12),
          }] : [],
          udp: true,
          ip: '127.0.0.1',
        };

      case 'http':
        return {
          accounts: (extra?.authUser) ? [{
            user: extra.authUser,
            pass: extra.authPass || generatePassword(12),
          }] : [],
          allowTransparent: false,
        };

      case 'dokodemo':
        return {
          address: extra?.dokoDest || '127.0.0.1',
          port: parseInt(extra?.dokoDestPort) || 80,
          network: extra?.dokoNetwork || 'tcp,udp',
          followRedirect: extra?.dokoFollowRedirect === 'true',
        };

      default:
        return {};
    }
  }

  private async buildDefaultStreamSettings(protocol: string, extra?: Record<string, any>): Promise<any> {
    if (protocol === 'vless') {
      const security = extra?.security || 'reality';
      if (security === 'reality') {
        // 自动生成 X25519 密钥对 + ShortID
        let realityKeys: { privateKey: string; publicKey: string; shortIds: string[]; dest: string; serverNames: string[] };
        try {
          realityKeys = await generateRealityConfig({
            dest: extra?.realityDest || 'www.google.com:443',
            serverNames: extra?.realityDest ? [extra.realityDest.split(':')[0]] : undefined,
          });
        } catch {
          logger.warn('X25519 密钥生成失败，Reality 配置为空');
          realityKeys = {
            privateKey: '', publicKey: '',
            shortIds: [generateShortId(8)],
            dest: extra?.realityDest || 'www.google.com:443',
            serverNames: [(extra?.realityDest || 'www.google.com:443').split(':')[0]],
          };
        }
        return {
          network: extra?.network || 'tcp',
          security: 'reality',
          realitySettings: {
            show: false, xver: 0,
            dest: realityKeys.dest,
            serverNames: realityKeys.serverNames,
            privateKey: realityKeys.privateKey,
            shortIds: realityKeys.shortIds,
            settings: {
              publicKey: realityKeys.publicKey,
              fingerprint: extra?.fingerprint || 'chrome',
              serverName: '',
            },
          },
          tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
        };
      }
      const fp = extra?.fingerprint || 'chrome';
      return {
        network: extra?.network || 'tcp',
        security,
        ...(security === 'tls' && {
          tlsSettings: { serverName: '', fingerprint: fp, certificates: [], alpn: extra?.alpn ? extra.alpn.split(',') : ['h2', 'http/1.1'] },
        }),
        ...this.buildTransportSettings(extra?.network || 'tcp', extra),
      };
    }

    if (protocol === 'vmess') {
      const network = extra?.network || 'ws';
      const fp = extra?.fingerprint || 'chrome';
      return {
        network,
        security: extra?.security || 'none',
        ...(extra?.security === 'tls' && {
          tlsSettings: { serverName: '', fingerprint: fp, certificates: [], alpn: extra?.alpn ? extra.alpn.split(',') : ['h2', 'http/1.1'] },
        }),
        ...this.buildTransportSettings(network, extra),
      };
    }

    if (protocol === 'trojan') {
      const security = extra?.security || 'tls';
      const fp = extra?.fingerprint || 'chrome';
      if (security === 'reality') {
        // Trojan + Reality: 同样需要 X25519 密钥
        let realityKeys;
        try {
          realityKeys = await generateRealityConfig({
            dest: extra?.realityDest || 'www.google.com:443',
            serverNames: extra?.realityDest ? [extra.realityDest.split(':')[0]] : undefined,
          });
        } catch {
          realityKeys = {
            privateKey: '', publicKey: '',
            shortIds: [generateShortId(8)],
            dest: extra?.realityDest || 'www.google.com:443',
            serverNames: [(extra?.realityDest || 'www.google.com:443').split(':')[0]],
          };
        }
        return {
          network: extra?.network || 'tcp',
          security: 'reality',
          realitySettings: {
            show: false, xver: 0,
            dest: realityKeys.dest,
            serverNames: realityKeys.serverNames,
            privateKey: realityKeys.privateKey,
            shortIds: realityKeys.shortIds,
            settings: { publicKey: realityKeys.publicKey, fingerprint: fp, serverName: '' },
          },
          ...this.buildTransportSettings(extra?.network || 'tcp', extra),
        };
      }
      return {
        network: extra?.network || 'tcp',
        security,
        ...(security === 'tls' && {
          tlsSettings: { serverName: '', fingerprint: fp, certificates: [], alpn: extra?.alpn ? extra.alpn.split(',') : ['h2', 'http/1.1'] },
        }),
        ...this.buildTransportSettings(extra?.network || 'tcp', extra),
      };
    }

    if (protocol === 'hysteria2') {
      return {
        network: 'tcp',
        security: 'tls',
        tlsSettings: {
          serverName: '',
          fingerprint: extra?.fingerprint || 'chrome',
          alpn: ['h3'],
          certificates: [],
        },
      };
    }

    if (protocol === 'tuic') {
      return {
        network: 'tcp',
        security: 'tls',
        tlsSettings: {
          serverName: '',
          fingerprint: extra?.fingerprint || 'chrome',
          alpn: ['h3'],
          certificates: [],
        },
      };
    }

    // dokodemo / socks / http / wireguard / default
    return {
      network: 'tcp',
      security: 'none',
      tcpSettings: { header: { type: 'none' } },
    };
  }

  /** 按传输类型生成对应 settings (ws/grpc/httpupgrade/splithttp/h2) */
  private buildTransportSettings(network: string, extra?: Record<string, any>): Record<string, any> {
    const path = extra?.wsPath || `/${generateShortId(8)}`;
    const base: Record<string, any> = {};

    switch (network) {
      case 'ws':
        base.wsSettings = { path, headers: {} };
        break;
      case 'grpc':
        base.grpcSettings = { serviceName: generateShortId(8), multiMode: false };
        break;
      case 'httpupgrade':
        base.httpupgradeSettings = { path, host: '' };
        break;
      case 'splithttp':
        base.splithttpSettings = { path, host: '', maxConcurrentUploads: 10 };
        break;
      case 'h2':
        base.httpSettings = { path, host: [''] };
        break;
    }

    // S4: TCP Fast Open + 优化 sockopt
    base.sockopt = {
      tcpFastOpen: true,            // 减少 1 个 RTT
      tcpKeepAliveInterval: 30,     // 保活间隔 (秒)
    };

    return base;
  }

  /** S3: 构建 Xray Mux 配置 (短连接优化) */
  private buildMuxSettings(protocol: string, extra?: Record<string, any>): Record<string, any> | undefined {
    // mux.cool 不支持 XTLS (vision flow) 和 UDP 协议
    if (protocol === 'hysteria2' || protocol === 'tuic' || protocol === 'wireguard') return undefined;
    if (extra?.flow === 'xtls-rprx-vision') return undefined;

    if (extra?.enableMux === 'true') {
      return {
        enabled: true,
        concurrency: parseInt(extra?.muxConcurrency) || 8,
        xudpConcurrency: 16,
        xudpProxyUDP443: 'reject',
      };
    }
    return undefined;
  }

  // 保留旧同步方法供内部/测试使用
  private generateUUIDSync(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  private generateShortIdSync(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}

// 单例导出 (本机)
export const xuiApi = new XuiApiService();

// ===== 多节点 XUI 连接工厂 =====

/** 远程节点的 3X-UI 连接缓存 */
const remoteXuiCache = new Map<string, XuiApiService>();

/**
 * 获取指定节点的 XUI API 连接
 * nodeId = 0 或 null → 返回本机连接
 */
export function getXuiForNode(node: { host: string; xuiPort?: number | null }): XuiApiService {
  if (node.host === '127.0.0.1' || node.host === 'localhost' || node.host === '::1') return xuiApi;

  const key = `${node.host}:${node.xuiPort || 2053}`;
  if (remoteXuiCache.has(key)) return remoteXuiCache.get(key)!;

  // IPv6 地址需要方括号
  const hostForUrl = node.host.includes(':') ? `[${node.host}]` : node.host;
  const remote = new XuiApiService(
    `http://${hostForUrl}:${node.xuiPort || 2053}`,
    ENV.XUI_USER,
    ENV.XUI_PASS,
  );
  remoteXuiCache.set(key, remote);
  return remote;
}
