// src/services/protocols.ts
/**
 * 全协议定义 — 面板支持的所有协议类型
 */

export interface ProtocolDef {
  value: string;
  label: string;
  desc: string;
  group: 'gost-forward' | 'gost-tunnel' | 'gost-proxy' | 'xray' | 'xray-modern';
  engine: 'gost' | 'xui';
  fields: FieldDef[];
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'password' | 'select' | 'checkbox';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: string;
  hint?: string;
}

// 通用字段
const F_NAME: FieldDef = { key: 'name', label: '规则名称', type: 'text', placeholder: 'HK-中转-01', required: true };
const F_REMARK: FieldDef = { key: 'remark', label: '备注名称', type: 'text', placeholder: 'VLESS-Reality', required: true };
const F_LISTEN: FieldDef = { key: 'listenPort', label: '监听端口', type: 'number', placeholder: '10001', required: true };
const F_TARGET_HOST: FieldDef = { key: 'targetHost', label: '目标地址', type: 'text', placeholder: '45.12.88.3', required: true };
const F_TARGET_PORT: FieldDef = { key: 'targetPort', label: '目标端口', type: 'number', placeholder: '443', required: true };
const F_AUTH_USER: FieldDef = { key: 'authUser', label: '认证用户', type: 'text', placeholder: '可选' };
const F_AUTH_PASS: FieldDef = { key: 'authPass', label: '认证密码', type: 'password', placeholder: '可选' };

export const ALL_PROTOCOLS: ProtocolDef[] = [
  // ===== GOST 端口转发 =====
  {
    value: 'port-forward-tcp', label: 'TCP 端口转发', desc: '直接转发 TCP 流量到目标',
    group: 'gost-forward', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT],
  },
  {
    value: 'port-forward-udp', label: 'UDP 端口转发', desc: '直接转发 UDP 流量到目标',
    group: 'gost-forward', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT],
  },
  {
    value: 'port-range-tcp', label: 'TCP 端口范围转发', desc: '批量端口映射 (如 10000-10100)',
    group: 'gost-forward', engine: 'gost',
    fields: [
      F_NAME,
      { key: 'listenStart', label: '起始端口', type: 'number', placeholder: '10000', required: true },
      { key: 'listenEnd', label: '结束端口', type: 'number', placeholder: '10100', required: true },
      F_TARGET_HOST,
      { key: 'targetStart', label: '目标起始端口', type: 'number', placeholder: '10000', required: true },
    ],
  },
  {
    value: 'reverse-tcp', label: 'TCP 反向转发', desc: '远程端口转到本地 (内网穿透)',
    group: 'gost-forward', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT],
  },
  {
    value: 'reverse-udp', label: 'UDP 反向转发', desc: '远程 UDP 端口转到本地',
    group: 'gost-forward', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT],
  },

  // ===== GOST 加密隧道 =====
  {
    value: 'tunnel-tls', label: 'TLS 隧道', desc: 'TLS 加密传输，最通用',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'tunnel-wss', label: 'WSS 隧道', desc: 'WebSocket Secure，伪装 HTTPS 流量',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS,
      { key: 'wsPath', label: 'WS 路径', type: 'text', placeholder: '/ws', default: '/ws' },
    ],
  },
  {
    value: 'tunnel-kcp', label: 'KCP 隧道', desc: 'KCP 加速协议 (UDP 底层)',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'tunnel-quic', label: 'QUIC 隧道', desc: 'QUIC 协议，低延迟多路复用',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'tunnel-mwss', label: 'mWSS 隧道', desc: '多路复用 WSS (推荐)',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'tunnel-mtls', label: 'mTLS 隧道', desc: '多路复用 TLS',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'tunnel-ssh', label: 'SSH 隧道', desc: '基于 SSH 的端口转发',
    group: 'gost-tunnel', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_TARGET_HOST, F_TARGET_PORT,
      { key: 'authUser', label: 'SSH 用户', type: 'text', placeholder: 'root', required: true },
      { key: 'authPass', label: 'SSH 密码', type: 'password', placeholder: '' },
    ],
  },

  // ===== GOST 代理 =====
  {
    value: 'proxy-socks5', label: 'SOCKS5 代理', desc: '标准 SOCKS5 代理服务',
    group: 'gost-proxy', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'proxy-http', label: 'HTTP 代理', desc: 'HTTP/HTTPS 代理服务',
    group: 'gost-proxy', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'proxy-ss', label: 'Shadowsocks (GOST)', desc: 'GOST 内建 SS 代理',
    group: 'gost-proxy', engine: 'gost',
    fields: [F_NAME, F_LISTEN,
      { key: 'ssMethod', label: '加密方式', type: 'select', required: true, options: [
        { value: 'aes-256-gcm', label: 'aes-256-gcm' },
        { value: 'aes-128-gcm', label: 'aes-128-gcm' },
        { value: 'chacha20-ietf-poly1305', label: 'chacha20-poly1305' },
      ], default: 'aes-256-gcm' },
      { key: 'ssPassword', label: 'SS 密码', type: 'password', required: true },
    ],
  },
  {
    value: 'proxy-relay', label: 'Relay 中继', desc: 'TCP/UDP 通用中继服务',
    group: 'gost-proxy', engine: 'gost',
    fields: [F_NAME, F_LISTEN, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'proxy-sni', label: 'SNI 代理', desc: '基于 SNI 的分流代理',
    group: 'gost-proxy', engine: 'gost',
    fields: [F_NAME, F_LISTEN],
  },

  // ===== Xray 经典协议 =====
  {
    value: 'xray-vless', label: 'VLESS', desc: '轻量级协议，推荐 Reality',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'security', label: '安全层', type: 'select', default: 'reality', options: [
        { value: 'reality', label: 'Reality (推荐)' },
        { value: 'tls', label: 'TLS' },
        { value: 'none', label: '无' },
      ]},
      { key: 'network', label: '传输协议', type: 'select', default: 'tcp', options: [
        { value: 'tcp', label: 'TCP' },
        { value: 'ws', label: 'WebSocket' },
        { value: 'grpc', label: 'gRPC' },
        { value: 'h2', label: 'HTTP/2' },
      ]},
      { key: 'flow', label: 'Flow', type: 'select', default: 'xtls-rprx-vision', options: [
        { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
        { value: '', label: '无' },
      ]},
      { key: 'realityDest', label: 'Reality 目标', type: 'text', placeholder: 'www.google.com:443', hint: 'Reality 模式必填' },
    ],
  },
  {
    value: 'xray-vmess', label: 'VMess', desc: 'V2Ray 主协议',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'network', label: '传输协议', type: 'select', default: 'ws', options: [
        { value: 'ws', label: 'WebSocket (推荐)' },
        { value: 'tcp', label: 'TCP' },
        { value: 'grpc', label: 'gRPC' },
        { value: 'h2', label: 'HTTP/2' },
      ]},
      { key: 'security', label: '安全层', type: 'select', default: 'none', options: [
        { value: 'tls', label: 'TLS' },
        { value: 'none', label: '无 (搭配 CDN)' },
      ]},
      { key: 'wsPath', label: 'WS 路径', type: 'text', placeholder: '/vmws', default: '/vmws' },
    ],
  },
  {
    value: 'xray-trojan', label: 'Trojan', desc: '模拟 HTTPS 流量',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'network', label: '传输协议', type: 'select', default: 'tcp', options: [
        { value: 'tcp', label: 'TCP (经典)' },
        { value: 'ws', label: 'WebSocket' },
        { value: 'grpc', label: 'gRPC' },
      ]},
      { key: 'security', label: '安全层', type: 'select', default: 'tls', options: [
        { value: 'tls', label: 'TLS' },
        { value: 'reality', label: 'Reality' },
        { value: 'none', label: '无' },
      ]},
    ],
  },
  {
    value: 'xray-shadowsocks', label: 'Shadowsocks', desc: '经典 SS 协议 (Xray 版)',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'ssMethod', label: '加密方式', type: 'select', default: '2022-blake3-aes-256-gcm', options: [
        { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm (推荐)' },
        { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
        { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
        { value: 'aes-256-gcm', label: 'aes-256-gcm (旧版)' },
        { value: 'aes-128-gcm', label: 'aes-128-gcm' },
        { value: 'chacha20-ietf-poly1305', label: 'chacha20-poly1305' },
        { value: 'xchacha20-ietf-poly1305', label: 'xchacha20-poly1305' },
      ]},
      { key: 'ssNetwork', label: '网络', type: 'select', default: 'tcp,udp', options: [
        { value: 'tcp,udp', label: 'TCP + UDP' },
        { value: 'tcp', label: '仅 TCP' },
        { value: 'udp', label: '仅 UDP' },
      ]},
    ],
  },

  // ===== Xray 新协议 =====
  {
    value: 'xray-hysteria2', label: 'Hysteria2', desc: 'QUIC 高性能协议',
    group: 'xray-modern', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'hy2UpMbps', label: '上行带宽 (Mbps)', type: 'number', placeholder: '100', default: '100' },
      { key: 'hy2DownMbps', label: '下行带宽 (Mbps)', type: 'number', placeholder: '200', default: '200' },
      { key: 'hy2Obfs', label: '混淆类型', type: 'select', default: '', options: [
        { value: '', label: '无' },
        { value: 'salamander', label: 'Salamander' },
      ]},
      { key: 'hy2ObfsPassword', label: '混淆密码', type: 'password', placeholder: '可选' },
    ],
  },
  {
    value: 'xray-tuic', label: 'TUIC v5', desc: 'QUIC 多路复用协议',
    group: 'xray-modern', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'tuicCongestion', label: '拥塞控制', type: 'select', default: 'bbr', options: [
        { value: 'bbr', label: 'BBR' },
        { value: 'cubic', label: 'Cubic' },
        { value: 'new_reno', label: 'New Reno' },
      ]},
    ],
  },
  {
    value: 'xray-wireguard', label: 'WireGuard', desc: 'WG 隧道协议',
    group: 'xray-modern', engine: 'xui',
    fields: [F_REMARK, F_LISTEN,
      { key: 'wgMtu', label: 'MTU', type: 'number', placeholder: '1420', default: '1420' },
    ],
  },
  {
    value: 'xray-socks', label: 'SOCKS 入站', desc: 'Xray SOCKS5 入站',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN, F_AUTH_USER, F_AUTH_PASS],
  },
  {
    value: 'xray-http', label: 'HTTP 入站', desc: 'Xray HTTP 代理入站',
    group: 'xray', engine: 'xui',
    fields: [F_REMARK, F_LISTEN, F_AUTH_USER, F_AUTH_PASS],
  },
];

export const PROTOCOL_MAP = new Map(ALL_PROTOCOLS.map(p => [p.value, p]));

export const PROTOCOL_GROUPS = [
  { key: 'gost-forward', label: 'GOST 端口转发' },
  { key: 'gost-tunnel', label: 'GOST 加密隧道' },
  { key: 'gost-proxy', label: 'GOST 代理服务' },
  { key: 'xray', label: 'Xray 经典协议' },
  { key: 'xray-modern', label: 'Xray 新一代协议' },
];

export function getProtocolsByGroup(group: string): ProtocolDef[] {
  return ALL_PROTOCOLS.filter(p => p.group === group);
}
