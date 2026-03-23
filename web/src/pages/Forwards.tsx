// src/pages/Forwards.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Modal, Confirm, Loading, Empty, formatBytes } from '../components/ui';
import toast from 'react-hot-toast';

// ===== Protocol definitions (mirrors backend protocols.ts) =====
const GROUPS = [
  { key: 'gost-forward', label: 'GOST 端口转发', items: [
    { v: 'port-forward-both', l: 'TCP+UDP 端口转发', d: '同时转发 TCP 和 UDP (推荐)' },
    { v: 'port-forward-tcp', l: 'TCP 端口转发', d: '仅转发 TCP 流量' },
    { v: 'port-forward-udp', l: 'UDP 端口转发', d: '仅转发 UDP 流量' },
    { v: 'port-range-tcp', l: 'TCP 端口范围转发', d: '批量端口映射' },
    { v: 'reverse-tcp', l: 'TCP 反向转发', d: '内网穿透' },
    { v: 'reverse-udp', l: 'UDP 反向转发', d: '远程 UDP 转本地' },
  ]},
  { key: 'gost-tunnel', label: 'GOST 加密隧道', items: [
    { v: 'tunnel-tls', l: 'TLS 隧道', d: '通用加密传输' },
    { v: 'tunnel-wss', l: 'WSS 隧道', d: '伪装 HTTPS' },
    { v: 'tunnel-mwss', l: 'mWSS 隧道', d: '多路复用 WSS (推荐)' },
    { v: 'tunnel-mtls', l: 'mTLS 隧道', d: '多路复用 TLS' },
    { v: 'tunnel-kcp', l: 'KCP 隧道', d: 'UDP 加速' },
    { v: 'tunnel-quic', l: 'QUIC 隧道', d: '低延迟多路复用' },
    { v: 'tunnel-ssh', l: 'SSH 隧道', d: 'SSH 端口转发' },
  ]},
  { key: 'gost-proxy', label: 'GOST 代理服务', items: [
    { v: 'proxy-socks5', l: 'SOCKS5 代理', d: '标准 SOCKS5' },
    { v: 'proxy-http', l: 'HTTP 代理', d: 'HTTP/HTTPS 代理' },
    { v: 'proxy-ss', l: 'Shadowsocks', d: 'GOST SS 代理' },
    { v: 'proxy-relay', l: 'Relay 中继', d: 'TCP/UDP 中继' },
    { v: 'proxy-sni', l: 'SNI 代理', d: '基于 SNI 分流' },
  ]},
  { key: 'xray', label: 'Xray 经典协议', items: [
    { v: 'xray-vless', l: 'VLESS', d: '轻量 + Reality' },
    { v: 'xray-vmess', l: 'VMess', d: 'V2Ray 主协议' },
    { v: 'xray-trojan', l: 'Trojan', d: '模拟 HTTPS' },
    { v: 'xray-shadowsocks', l: 'Shadowsocks', d: 'Xray SS (SS-2022)' },
    { v: 'xray-dokodemo', l: 'Dokodemo-door', d: '任意门/透明代理' },
    { v: 'xray-socks', l: 'SOCKS 入站', d: 'SOCKS5 入站' },
    { v: 'xray-http', l: 'HTTP 入站', d: 'HTTP 代理入站' },
  ]},
  { key: 'xray-modern', label: 'Xray 新一代协议', items: [
    { v: 'xray-hysteria2', l: 'Hysteria2', d: 'QUIC 高性能' },
    { v: 'xray-tuic', l: 'TUIC v5', d: 'QUIC 多路复用' },
    { v: 'xray-wireguard', l: 'WireGuard', d: 'WG 隧道' },
  ]},
];

// Dynamic field definitions per protocol type
const XRAY_FIELDS: Record<string, Array<{ key: string; label: string; type: string; options?: any[]; default?: string; placeholder?: string }>> = {
  'xray-vless': [
    { key: 'security', label: '安全层', type: 'select', default: 'reality', options: [
      { value: 'reality', label: 'Reality (推荐)' }, { value: 'tls', label: 'TLS' }, { value: 'none', label: '无' },
    ]},
    { key: 'network', label: '传输', type: 'select', default: 'tcp', options: [
      { value: 'tcp', label: 'TCP' }, { value: 'ws', label: 'WebSocket' }, { value: 'grpc', label: 'gRPC' },
      { value: 'h2', label: 'HTTP/2' }, { value: 'httpupgrade', label: 'HTTPUpgrade (CDN)' },
      { value: 'splithttp', label: 'SplitHTTP' },
      { value: 'xhttp', label: 'XHTTP (Xray 24.12+)' },
    ]},
    { key: 'flow', label: 'Flow', type: 'select', default: 'xtls-rprx-vision', options: [
      { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }, { value: '', label: '无' },
    ]},
    { key: 'fingerprint', label: 'TLS 指纹', type: 'select', default: 'chrome', options: [
      { value: 'chrome', label: 'Chrome' }, { value: 'firefox', label: 'Firefox' },
      { value: 'safari', label: 'Safari' }, { value: 'random', label: '随机' },
      { value: 'randomized', label: '完全随机' }, { value: 'ios', label: 'iOS' },
      { value: 'android', label: 'Android' }, { value: 'edge', label: 'Edge' },
    ]},
    { key: 'alpn', label: 'ALPN', type: 'select', default: 'h2,http/1.1', options: [
      { value: 'h2,http/1.1', label: 'h2, http/1.1 (默认)' },
      { value: 'h3', label: 'h3 (QUIC)' },
      { value: 'http/1.1', label: '仅 http/1.1' },
      { value: 'h2', label: '仅 h2' },
    ]},
    { key: 'realityDest', label: 'Reality 目标域名', type: 'text', placeholder: 'www.google.com:443' },
    { key: 'fallbackAddr', label: 'Fallback 回落地址', type: 'text', placeholder: '127.0.0.1:80 (可选, 无匹配时转发到此)' },
  ],
  'xray-vmess': [
    { key: 'network', label: '传输', type: 'select', default: 'ws', options: [
      { value: 'ws', label: 'WebSocket (推荐)' }, { value: 'tcp', label: 'TCP' }, { value: 'grpc', label: 'gRPC' },
      { value: 'h2', label: 'HTTP/2' }, { value: 'httpupgrade', label: 'HTTPUpgrade (CDN)' },
      { value: 'splithttp', label: 'SplitHTTP' },
      { value: 'xhttp', label: 'XHTTP (Xray 24.12+)' },
    ]},
    { key: 'security', label: '安全层', type: 'select', default: 'none', options: [
      { value: 'tls', label: 'TLS' }, { value: 'none', label: '无 (CDN)' },
    ]},
    { key: 'fingerprint', label: 'TLS 指纹', type: 'select', default: 'chrome', options: [
      { value: 'chrome', label: 'Chrome' }, { value: 'firefox', label: 'Firefox' },
      { value: 'safari', label: 'Safari' }, { value: 'random', label: '随机' },
    ]},
    { key: 'alpn', label: 'ALPN', type: 'select', default: 'h2,http/1.1', options: [
      { value: 'h2,http/1.1', label: 'h2, http/1.1' }, { value: 'http/1.1', label: '仅 http/1.1' },
    ]},
    { key: 'wsPath', label: 'WS/HTTPUpgrade 路径', type: 'text', placeholder: '/vmws' },
  ],
  'xray-trojan': [
    { key: 'network', label: '传输', type: 'select', default: 'tcp', options: [
      { value: 'tcp', label: 'TCP' }, { value: 'ws', label: 'WebSocket' }, { value: 'grpc', label: 'gRPC' },
      { value: 'h2', label: 'HTTP/2' }, { value: 'httpupgrade', label: 'HTTPUpgrade' },
      { value: 'splithttp', label: 'SplitHTTP' }, { value: 'xhttp', label: 'XHTTP' },
    ]},
    { key: 'security', label: '安全层', type: 'select', default: 'tls', options: [
      { value: 'tls', label: 'TLS' }, { value: 'reality', label: 'Reality' }, { value: 'none', label: '无' },
    ]},
    { key: 'fingerprint', label: 'TLS 指纹', type: 'select', default: 'chrome', options: [
      { value: 'chrome', label: 'Chrome' }, { value: 'firefox', label: 'Firefox' },
      { value: 'safari', label: 'Safari' }, { value: 'random', label: '随机' },
    ]},
    { key: 'alpn', label: 'ALPN', type: 'select', default: 'h2,http/1.1', options: [
      { value: 'h2,http/1.1', label: 'h2, http/1.1' }, { value: 'http/1.1', label: '仅 http/1.1' },
    ]},
    { key: 'fallbackAddr', label: 'Fallback 回落地址', type: 'text', placeholder: '127.0.0.1:80 (可选)' },
  ],
  'xray-shadowsocks': [
    { key: 'ssMethod', label: '加密方式', type: 'select', default: '2022-blake3-aes-256-gcm', options: [
      { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm (推荐)' },
      { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
      { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
      { value: 'aes-256-gcm', label: 'aes-256-gcm' },
      { value: 'chacha20-ietf-poly1305', label: 'chacha20-poly1305' },
    ]},
  ],
  'xray-hysteria2': [
    { key: 'hy2UpMbps', label: '上行 Mbps', type: 'text', default: '100', placeholder: '100' },
    { key: 'hy2DownMbps', label: '下行 Mbps', type: 'text', default: '200', placeholder: '200' },
    { key: 'hy2Obfs', label: '混淆', type: 'select', default: '', options: [
      { value: '', label: '无' }, { value: 'salamander', label: 'Salamander' },
    ]},
  ],
  'xray-tuic': [
    { key: 'tuicCongestion', label: '拥塞控制', type: 'select', default: 'bbr', options: [
      { value: 'bbr', label: 'BBR' }, { value: 'cubic', label: 'Cubic' }, { value: 'new_reno', label: 'New Reno' },
    ]},
  ],
  'xray-wireguard': [
    { key: 'wgMtu', label: 'MTU', type: 'text', default: '1420', placeholder: '1420' },
  ],
  'xray-dokodemo': [
    { key: 'dokoDest', label: '目标地址', type: 'text', placeholder: '127.0.0.1', default: '127.0.0.1' },
    { key: 'dokoDestPort', label: '目标端口', type: 'text', placeholder: '80' },
    { key: 'dokoNetwork', label: '网络', type: 'select', default: 'tcp,udp', options: [
      { value: 'tcp,udp', label: 'TCP + UDP' }, { value: 'tcp', label: '仅 TCP' }, { value: 'udp', label: '仅 UDP' },
    ]},
    { key: 'dokoFollowRedirect', label: '透明代理', type: 'select', default: 'false', options: [
      { value: 'false', label: '关闭' }, { value: 'true', label: '开启 (需 iptables)' },
    ]},
  ],
};

function CreateModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [nodeList, setNodeList] = useState<any[]>([]);
  const [portRange, setPortRange] = useState<{ enabled: boolean; min: number; max: number } | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0); setType(''); setForm({});
      api.listNodes().then((res: any) => {
        if (res.ok) setNodeList(res.data || []);
      }).catch(() => {});
      // 加载端口范围
      fetch('/api/v1/dashboard/port-range', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json()).then(r => {
        if (r.ok) setPortRange(r.data);
      }).catch(() => {});
    }
  }, [open]);

  const f = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const isXray = type.startsWith('xray-');
  const isProxy = type.startsWith('proxy-');
  const needsTarget = !isXray && !isProxy && type !== 'proxy-sni';
  const needsAuth = type.startsWith('tunnel-') || type === 'proxy-socks5' || type === 'proxy-http' || type === 'proxy-relay';
  const extraFields = XRAY_FIELDS[type] || [];

  const handleSubmit = async () => {
    const name = form.name || form.remark;
    if (!name) return toast.error('请填写名称');
    if (!form.listenPort) return toast.error('请填写监听端口');
    const port = parseInt(form.listenPort);
    if (portRange?.enabled && (port < portRange.min || port > portRange.max)) {
      return toast.error(`端口 ${port} 超出 NAT 允许范围 ${portRange.min}-${portRange.max}`);
    }
    setSubmitting(true);
    const selectedNodeId = form.nodeId ? parseInt(form.nodeId) : undefined;
    try {
      if (isXray) {
        const protocol = type.replace('xray-', '');
        const extra: Record<string, any> = {};
        extraFields.forEach(ef => { if (form[ef.key]) extra[ef.key] = form[ef.key]; });
        await api.createInbound({
          remark: form.remark || name,
          protocol,
          port: parseInt(form.listenPort),
          extra,
          nodeId: selectedNodeId,
        });
      } else {
        await api.createForward({
          name,
          type,
          listenPort: parseInt(form.listenPort),
          targetHost: form.targetHost || '',
          targetPort: parseInt(form.targetPort || '0'),
          ...(form.authUser && { auth: { username: form.authUser, password: form.authPass || '' } }),
          ...(form.ssMethod && { ssMethod: form.ssMethod }),
          ...(form.ssPassword && { ssPassword: form.ssPassword }),
          nodeId: selectedNodeId,
        });
      }
      toast.success('创建成功');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || '创建失败');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal title="创建协议" subtitle={step === 0 ? `共 ${GROUPS.reduce((a, g) => a + g.items.length, 0)} 种协议` : '配置参数'}
      open={open} onClose={onClose}>
      {step === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {GROUPS.map(g => (
            <div key={g.key}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{g.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                {g.items.map(item => (
                  <button key={item.v} onClick={() => { setType(item.v); setStep(1); }}
                    style={{ background: 'transparent', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', transition: 'all 150ms', fontFamily: 'inherit', color: 'var(--text)' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.l}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{item.d}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: '8px 12px', background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Badge type={type} />
            <button onClick={() => setStep(0)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>修改类型</button>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="label">{isXray ? '备注名称' : '规则名称'}</label>
              <input className="input" placeholder={isXray ? 'VLESS-Reality' : 'HK-中转-01'}
                value={form[isXray ? 'remark' : 'name'] || ''}
                onChange={e => f(isXray ? 'remark' : 'name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">监听端口{portRange?.enabled ? ` (${portRange.min}-${portRange.max})` : ''}</label>
              <input className="input" type="number"
                placeholder={portRange?.enabled ? String(portRange.min) : '10001'}
                min={portRange?.enabled ? portRange.min : 1}
                max={portRange?.enabled ? portRange.max : 65535}
                value={form.listenPort || ''}
                onChange={e => f('listenPort', e.target.value)} />
              {portRange?.enabled && form.listenPort && (
                parseInt(form.listenPort) < portRange.min || parseInt(form.listenPort) > portRange.max
              ) && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                  端口超出 NAT 允许范围 {portRange.min}-{portRange.max}
                </div>
              )}
            </div>
            {nodeList.length > 1 && (
              <div className="form-group">
                <label className="label">部署节点</label>
                <select className="input" value={form.nodeId || ''} onChange={e => f('nodeId', e.target.value)}>
                  <option value="">本机</option>
                  {nodeList.filter(n => {
                    // GOST 类型: 只显示 GOST 节点; Xray 类型: 只显示 XUI 节点
                    if (isXray) return n.xuiInstalled;
                    return n.gostInstalled;
                  }).map(n => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.host}) {n.status === 'online' ? '🟢' : '🔴'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {needsTarget && (
            <div className="form-grid">
              <div className="form-group">
                <label className="label">目标地址</label>
                <input className="input" placeholder="45.12.88.3" value={form.targetHost || ''} onChange={e => f('targetHost', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">目标端口</label>
                <input className="input" type="number" placeholder="443" value={form.targetPort || ''} onChange={e => f('targetPort', e.target.value)} />
              </div>
            </div>
          )}

          {needsAuth && (
            <div className="form-grid">
              <div className="form-group">
                <label className="label">认证用户 (可选)</label>
                <input className="input" placeholder="user" value={form.authUser || ''} onChange={e => f('authUser', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">认证密码</label>
                <input className="input" type="password" value={form.authPass || ''} onChange={e => f('authPass', e.target.value)} />
              </div>
            </div>
          )}

          {type === 'proxy-ss' && (
            <div className="form-grid">
              <div className="form-group">
                <label className="label">加密方式</label>
                <select className="input" value={form.ssMethod || 'aes-256-gcm'} onChange={e => f('ssMethod', e.target.value)}>
                  <option value="aes-256-gcm">aes-256-gcm</option>
                  <option value="aes-128-gcm">aes-128-gcm</option>
                  <option value="chacha20-ietf-poly1305">chacha20-poly1305</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">SS 密码</label>
                <input className="input" type="password" value={form.ssPassword || ''} onChange={e => f('ssPassword', e.target.value)} />
              </div>
            </div>
          )}

          {/* Xray extra fields */}
          {extraFields.length > 0 && (
            <div className="form-grid">
              {extraFields.map(ef => (
                <div className="form-group" key={ef.key}>
                  <label className="label">{ef.label}</label>
                  {ef.type === 'select' ? (
                    <select className="input" value={form[ef.key] || ef.default || ''}
                      onChange={e => f(ef.key, e.target.value)}>
                      {ef.options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input className="input" placeholder={ef.placeholder} type={ef.type === 'password' ? 'password' : 'text'}
                      value={form[ef.key] || ef.default || ''} onChange={e => f(ef.key, e.target.value)} />
                  )}
                </div>
              ))}
            </div>
          )}

          {isXray && (
            <div style={{ padding: 12, background: 'rgba(6,182,212,0.08)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent)', lineHeight: 1.7 }}>
              <strong>自动生成:</strong> 所有密钥和参数均自动生成，无需手动填写。
              {type === 'xray-vless' && <><br/>UUID + X25519 密钥对 + ShortID (Reality 模式)</>}
              {type === 'xray-vmess' && <><br/>UUID + WS 路径 / gRPC ServiceName</>}
              {type === 'xray-trojan' && <><br/>24 位随机密码</>}
              {type === 'xray-shadowsocks' && <><br/>SS-2022 定长 Base64 密钥 (按加密方式自动匹配长度)</>}
              {type === 'xray-hysteria2' && <><br/>24 位随机密码 + 混淆密码 (如选择)</>}
              {type === 'xray-tuic' && <><br/>UUID + 16 位密码</>}
              {type === 'xray-wireguard' && <><br/>WireGuard 密钥对 (curve25519)</>}
              {(type === 'xray-socks' || type === 'xray-http') && <><br/>认证凭据 (如填写用户名则自动生成密码)</>}
              <br/><span style={{ color: 'var(--text-dim)' }}>创建后可在 3X-UI 面板查看和编辑详细参数</span>
            </div>
          )}

          {!isXray && type === 'proxy-ss' && !form.ssPassword && (
            <div style={{ padding: 10, background: 'rgba(6,182,212,0.08)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent)' }}>
              SS 密码留空将自动生成随机密码
            </div>
          )}

          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}
            style={{ width: '100%', padding: '12px 0', justifyContent: 'center', fontSize: 14 }}>
            {submitting ? '创建中...' : '创建并部署'}
          </button>
        </div>
      )}
    </Modal>
  );
}

// ===== Main Page =====
export function ForwardsPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [tab, setTab] = useState<'all' | 'gost' | 'xui'>('all');
  const [search, setSearch] = useState('');
  const [diagTarget, setDiagTarget] = useState<any>(null);
  const [diagResult, setDiagResult] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [gR, xR] = await Promise.allSettled([api.listForwards(), api.listInbounds()]);
      const gost = gR.status === 'fulfilled' && gR.value.ok ? gR.value.data.map((r: any) => ({ ...r, _src: 'gost' })) : [];
      const xui = xR.status === 'fulfilled' && xR.value.ok ? xR.value.data.map((r: any) => ({
        id: r.id, name: r.remark, type: `xray-${r.protocol}`, listenAddr: `:${r.port}`, targetAddr: '',
        status: r.enable ? 'active' : 'stopped', trafficUp: r.up || 0, trafficDown: r.down || 0,
        clientCount: r.clientCount, _src: 'xui',
      })) : [];
      setRules([...gost, ...xui]);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      deleteTarget._src === 'gost' ? await api.deleteForward(deleteTarget.id) : await api.deleteInbound(deleteTarget.id);
      toast.success('已删除'); load();
    } catch (err: any) { toast.error(err.message); }
    setDeleteTarget(null);
  };

  const handleToggle = async (rule: any) => {
    if (rule._src !== 'gost') return;
    try {
      const res = await api.toggleForward(rule.id);
      if (res.ok) { toast.success(res.data.status === 'active' ? '已启动' : '已停止'); load(); }
    } catch (err: any) { toast.error(err.message); }
  };

  const filtered = rules
    .filter(r => tab === 'all' || (tab === 'gost' ? r._src === 'gost' : r._src === 'xui'))
    .filter(r => !search || r.name?.toLowerCase().includes(search.toLowerCase()) || r.type?.includes(search));

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">转发管理</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 创建协议</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[{ k: 'all', l: `全部 (${rules.length})` }, { k: 'gost', l: `GOST (${rules.filter(r => r._src === 'gost').length})` }, { k: 'xui', l: `Xray (${rules.filter(r => r._src === 'xui').length})` }].map(t => (
            <button key={t.k} className={`tab-btn ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k as any)}>{t.l}</button>
          ))}
        </div>
        <input className="input" style={{ width: 200 }} placeholder="搜索名称或类型..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? <div className="card"><Empty text={search ? '无匹配结果' : '暂无规则，点击创建'} /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>名称</th><th>类型</th><th>监听</th><th>目标</th><th>上行</th><th>下行</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={`${r._src}-${r.id}`}>
                    <td style={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                    <td><Badge type={r.type} /></td>
                    <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{r.listenAddr || r.listen_addr}</code></td>
                    <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.targetAddr || r.target_addr || '—'}</code></td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{formatBytes(r.trafficUp || r.traffic_up || 0)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{formatBytes(r.trafficDown || r.traffic_down || 0)}</td>
                    <td><StatusDot status={r.status} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {r._src === 'gost' && <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(r)}>{r.status === 'active' ? '停止' : '启动'}</button>}
                        <button className="btn btn-ghost btn-sm" onClick={async () => {
                          setDiagTarget(r);
                          setDiagResult(null);
                          setDiagLoading(true);
                          try {
                            const res = await api.diagnoseForward(r.id);
                            if (res.ok) setDiagResult(res.data);
                          } catch {}
                          setDiagLoading(false);
                        }}>诊断</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(r)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <Confirm open={!!deleteTarget} msg={`确认删除「${deleteTarget?.name}」？`} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      {/* 诊断弹窗 */}
      <Modal title="规则诊断" subtitle={diagTarget?.name} open={!!diagTarget} onClose={() => setDiagTarget(null)}>
        {diagLoading ? <Loading /> : diagResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
              background: diagResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: diagResult.ok ? 'var(--green)' : 'var(--red)',
            }}>
              {diagResult.ok ? '✓ 全部通过' : '✗ 存在故障'} — {diagResult.summary}
            </div>
            {diagResult.tests?.map((t: any, i: number) => (
              <div key={i} style={{
                padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderLeft: `3px solid ${t.status === 'pass' ? 'var(--green)' : t.status === 'fail' ? 'var(--red)' : t.status === 'warn' ? 'var(--yellow)' : 'var(--text-dim)'}`,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.msg}</div>
                </div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                  {t.ms !== undefined && `${t.ms}ms`}
                </div>
              </div>
            ))}
          </div>
        ) : <Empty text="点击诊断按钮开始" />}
      </Modal>
    </div>
  );
}
