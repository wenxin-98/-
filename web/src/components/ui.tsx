// src/components/ui.tsx
import React, { useState, useEffect, type ReactNode } from 'react';

// === Badge ===
const colorMap: Record<string, { color: string; bg: string }> = {
  // GOST 端口转发
  'port-forward-tcp':  { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  'port-forward-udp':  { color: 'var(--purple)', bg: 'var(--purple-dim)' },
  'port-range-tcp':    { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  'reverse-tcp':       { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  'reverse-udp':       { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  // GOST 隧道
  'tunnel-tls':        { color: 'var(--green)', bg: 'var(--green-dim)' },
  'tunnel-wss':        { color: 'var(--yellow)', bg: 'var(--yellow-dim)' },
  'tunnel-mwss':       { color: 'var(--yellow)', bg: 'var(--yellow-dim)' },
  'tunnel-mtls':       { color: 'var(--green)', bg: 'var(--green-dim)' },
  'tunnel-kcp':        { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  'tunnel-quic':       { color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  'tunnel-ssh':        { color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  // GOST 代理
  'proxy-socks5':      { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  'proxy-http':        { color: 'var(--purple)', bg: 'var(--purple-dim)' },
  'proxy-ss':          { color: 'var(--yellow)', bg: 'var(--yellow-dim)' },
  'proxy-relay':       { color: 'var(--green)', bg: 'var(--green-dim)' },
  'proxy-sni':         { color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  // Xray 经典
  'xray-vless':        { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  'xray-vmess':        { color: 'var(--purple)', bg: 'var(--purple-dim)' },
  'xray-trojan':       { color: 'var(--green)', bg: 'var(--green-dim)' },
  'xray-shadowsocks':  { color: 'var(--yellow)', bg: 'var(--yellow-dim)' },
  'xray-socks':        { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  'xray-http':         { color: 'var(--purple)', bg: 'var(--purple-dim)' },
  'xray-dokodemo':     { color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  // Xray 新一代
  'xray-hysteria2':    { color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  'xray-tuic':         { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  'xray-wireguard':    { color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  // 状态/角色
  active: { color: 'var(--green)', bg: 'var(--green-dim)' },
  stopped: { color: 'var(--text-muted)', bg: 'rgba(71,85,105,0.12)' },
  error: { color: 'var(--red)', bg: 'var(--red-dim)' },
  online: { color: 'var(--green)', bg: 'var(--green-dim)' },
  offline: { color: 'var(--text-muted)', bg: 'rgba(71,85,105,0.12)' },
  entry: { color: 'var(--accent)', bg: 'var(--accent-dim)' },
  relay: { color: 'var(--purple)', bg: 'var(--purple-dim)' },
  exit: { color: 'var(--green)', bg: 'var(--green-dim)' },
  standalone: { color: 'var(--text-dim)', bg: 'rgba(100,116,139,0.12)' },
};

const typeLabels: Record<string, string> = {
  'port-forward-tcp': 'TCP转发', 'port-forward-udp': 'UDP转发',
  'port-range-tcp': '端口范围', 'reverse-tcp': '反向TCP', 'reverse-udp': '反向UDP',
  'tunnel-tls': 'TLS隧道', 'tunnel-wss': 'WSS隧道',
  'tunnel-mwss': 'mWSS隧道', 'tunnel-mtls': 'mTLS隧道',
  'tunnel-kcp': 'KCP隧道', 'tunnel-quic': 'QUIC隧道', 'tunnel-ssh': 'SSH隧道',
  'proxy-socks5': 'SOCKS5', 'proxy-http': 'HTTP代理',
  'proxy-ss': 'SS代理', 'proxy-relay': 'Relay', 'proxy-sni': 'SNI代理',
  'xray-vless': 'VLESS', 'xray-vmess': 'VMess',
  'xray-trojan': 'Trojan', 'xray-shadowsocks': 'SS',
  'xray-socks': 'SOCKS', 'xray-http': 'HTTP', 'xray-dokodemo': '任意门',
  'xray-hysteria2': 'Hysteria2', 'xray-tuic': 'TUIC', 'xray-wireguard': 'WireGuard',
  active: '运行中', stopped: '已停止', error: '异常',
  online: '在线', offline: '离线',
  entry: '入口', relay: '中继', exit: '落地', standalone: '独立',
};

export function Badge({ type, label }: { type: string; label?: string }) {
  const c = colorMap[type] || { color: 'var(--text-dim)', bg: 'rgba(100,116,139,0.12)' };
  return (
    <span className="badge" style={{ color: c.color, background: c.bg }}>
      {label || typeLabels[type] || type}
    </span>
  );
}

// === StatusDot ===
export function StatusDot({ status }: { status: string }) {
  const cls = status === 'active' || status === 'online' ? 'active'
    : status === 'error' ? 'error' : 'stopped';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className={`status-dot ${cls}`} />
      <span style={{ fontSize: 12, color: cls === 'active' ? 'var(--green)' : 'var(--text-dim)' }}>
        {typeLabels[status] || status}
      </span>
    </span>
  );
}

// === StatCard ===
export function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 180, position: 'relative' }}>
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 80, height: 80,
        borderRadius: '50%', background: `${color}10`,
      }} />
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: 32, fontWeight: 700, color, lineHeight: 1,
        fontFamily: 'var(--font-mono)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// === Modal ===
export function Modal({ title, subtitle, open, onClose, children, footer }: {
  title: string; subtitle?: string; open: boolean;
  onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-dim)',
            fontSize: 20, cursor: 'pointer',
          }}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// === Confirm ===
export function Confirm({ open, msg, onConfirm, onCancel }: {
  open: boolean; msg: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title="确认操作" open={open} onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel}>取消</button>
        <button className="btn btn-danger" onClick={onConfirm}>确认</button>
      </>
    }>
      <p style={{ color: 'var(--text-secondary)' }}>{msg}</p>
    </Modal>
  );
}

// === Loading ===
export function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <div className="spinner" />
    </div>
  );
}

// === Empty ===
export function Empty({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">📭</div>
      <div>{text}</div>
    </div>
  );
}

// === Code block ===
export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{
        background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 16,
        fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--green)',
        overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>{children}</pre>
      <button onClick={copy} style={{
        position: 'absolute', top: 8, right: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', padding: '4px 10px',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        fontSize: 12, cursor: 'pointer',
      }}>{copied ? '已复制' : '复制'}</button>
    </div>
  );
}

// === Bytes formatter ===
export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
