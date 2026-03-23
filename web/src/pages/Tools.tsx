// src/pages/Tools.tsx
import React, { useState } from 'react';
import { api } from '../services/api';
import { Loading, Code, Modal, Badge } from '../components/ui';
import toast from 'react-hot-toast';

function KeygenSection() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState('');
  const [realityDest, setRealityDest] = useState('www.google.com:443');
  const [ssMethod, setSsMethod] = useState('2022-blake3-aes-256-gcm');

  const gen = async (type: string, fn: () => Promise<any>) => {
    setLoading(type);
    try {
      const res = await fn();
      if (res.ok) setResult({ type, data: res.data });
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
    setLoading('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {[
          { key: 'reality', label: 'Reality 密钥对', desc: 'X25519 + ShortID', color: 'var(--accent)',
            fn: () => api.genReality({ dest: realityDest }) },
          { key: 'x25519', label: 'X25519 密钥', desc: '独立密钥对', color: 'var(--green)',
            fn: () => api.genX25519() },
          { key: 'wg', label: 'WireGuard 密钥', desc: 'WG 密钥对', color: '#22d3ee',
            fn: () => api.genWireGuard() },
          { key: 'ss2022', label: 'SS-2022 密钥', desc: 'Base64 密钥', color: 'var(--yellow)',
            fn: () => api.genSS2022(ssMethod) },
          { key: 'uuid', label: 'UUID', desc: 'v4 随机', color: 'var(--purple)',
            fn: () => api.genUUID() },
          { key: 'password', label: '随机密码', desc: '16 位', color: 'var(--orange)',
            fn: () => api.genPassword(16) },
        ].map(item => (
          <button key={item.key} onClick={() => gen(item.key, item.fn)} disabled={loading === item.key}
            style={{
              padding: '14px 16px', background: 'var(--bg)', border: `1px solid ${item.color}22`,
              borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit', color: 'var(--text)', transition: 'border-color 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = item.color}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${item.color}22`}>
            <div style={{ fontWeight: 600, color: item.color, marginBottom: 2 }}>
              {loading === item.key ? '生成中...' : item.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item.desc}</div>
          </button>
        ))}
      </div>

      {/* Reality dest input */}
      <div className="form-grid">
        <div className="form-group">
          <label className="label">Reality 目标域名</label>
          <input className="input" value={realityDest} onChange={e => setRealityDest(e.target.value)} placeholder="www.google.com:443" />
        </div>
        <div className="form-group">
          <label className="label">SS-2022 加密方式</label>
          <select className="input" value={ssMethod} onChange={e => setSsMethod(e.target.value)}>
            <option value="2022-blake3-aes-256-gcm">2022-blake3-aes-256-gcm</option>
            <option value="2022-blake3-aes-128-gcm">2022-blake3-aes-128-gcm</option>
            <option value="2022-blake3-chacha20-poly1305">2022-blake3-chacha20-poly1305</option>
          </select>
        </div>
      </div>

      {/* Generated result */}
      {result && (
        <div style={{ padding: 16, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Badge type="active" label={result.type} />
            <button className="btn btn-ghost btn-sm" onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
              toast.success('已复制');
            }}>复制全部</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(result.data).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 100, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{k}:</span>
                <code style={{
                  fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                }} onClick={() => { navigator.clipboard.writeText(String(v)); toast.success(`${k} 已复制`); }}>
                  {Array.isArray(v) ? JSON.stringify(v) : String(v)}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TelegramSection() {
  const [form, setForm] = useState({ botToken: '', adminChatId: '', enabled: true });
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  const loadConfig = async () => {
    try {
      const res = await api.getTelegramConfig();
      if (res.ok && res.data) {
        setForm({ botToken: '', adminChatId: res.data.adminChatId || '', enabled: res.data.enabled });
      }
    } catch {}
    setLoaded(true);
  };

  if (!loaded) { loadConfig(); }

  const handleSave = async () => {
    if (!form.botToken || !form.adminChatId) return toast.error('请填写 Bot Token 和 Chat ID');
    try {
      const res = await api.saveTelegramConfig(form);
      if (res.ok) toast.success('配置已保存');
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleTest = async () => {
    if (!form.botToken || !form.adminChatId) return toast.error('请先填写配置');
    setTesting(true);
    try {
      const res = await api.testTelegram({ botToken: form.botToken, chatId: form.adminChatId });
      if (res.ok) toast.success('测试消息已发送');
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
    setTesting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="label">Bot Token (从 @BotFather 获取)</label>
        <input className="input" value={form.botToken} placeholder="123456:ABC-DEF..."
          onChange={e => setForm({ ...form, botToken: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="label">Admin Chat ID (从 @userinfobot 获取)</label>
        <input className="input" value={form.adminChatId} placeholder="123456789"
          onChange={e => setForm({ ...form, adminChatId: e.target.value })} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
        启用通知
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={handleSave}>保存配置</button>
        <button className="btn btn-ghost" onClick={handleTest} disabled={testing}>
          {testing ? '发送中...' : '测试发送'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
        通知场景: 节点离线/恢复、证书过期、流量配额用尽、登录失败、BBR 调参变更、每日摘要
      </div>
    </div>
  );
}

function DataSection() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (includeLogs: boolean) => {
    setExporting(true);
    try {
      const res = await api.exportData(includeLogs);
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unified-panel-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('导出完成');
    } catch (err: any) { toast.error(err.message); }
    setExporting(false);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await api.importData(data);
        if (res.ok) {
          toast.success(`导入完成: 规则=${res.data.rules} 链路=${res.data.chains} 节点=${res.data.nodes}`);
        } else {
          toast.error(res.msg);
        }
      } catch (err: any) { toast.error(`导入失败: ${err.message}`); }
      setImporting(false);
    };
    input.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => handleExport(false)} disabled={exporting}>
          {exporting ? '导出中...' : '导出配置 (JSON)'}
        </button>
        <button className="btn btn-ghost" onClick={() => handleExport(true)} disabled={exporting}>
          导出 (含日志)
        </button>
        <button className="btn btn-ghost" onClick={handleImport} disabled={importing}>
          {importing ? '导入中...' : '导入配置'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
        导出: 转发规则、隧道链路、节点列表、用户列表、系统配置<br />
        导入: 自动跳过已有的节点，规则导入后默认为停止状态<br />
        密码和密钥不会被导出，保证安全性
      </div>
    </div>
  );
}

export function ToolsPage() {
  const [tab, setTab] = useState<'keygen' | 'telegram' | 'data'>('keygen');

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">工具箱</h2>
      </div>

      <div className="tabs">
        {[
          { k: 'keygen', l: '密钥生成器' },
          { k: 'telegram', l: 'Telegram 通知' },
          { k: 'data', l: '数据导入/导出' },
        ].map(t => (
          <button key={t.k} className={`tab-btn ${tab === t.k ? 'active' : ''}`}
            onClick={() => setTab(t.k as any)}>{t.l}</button>
        ))}
      </div>

      <div className="card">
        {tab === 'keygen' && <KeygenSection />}
        {tab === 'telegram' && <TelegramSection />}
        {tab === 'data' && <DataSection />}
      </div>
    </div>
  );
}
