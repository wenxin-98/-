// src/pages/Xui.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Loading, Empty, formatBytes, Modal, Confirm } from '../components/ui';
import toast from 'react-hot-toast';

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('已复制')).catch(() => toast.error('复制失败'));
}

// ===== Client Management Panel =====
function ClientPanel({ inbound, onUpdate }: { inbound: any; onUpdate: () => void }) {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', totalGB: '0', limitIp: '0', expiryDays: '0' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const proto = inbound.protocol;
  const hasUUID = proto === 'vless' || proto === 'vmess' || proto === 'tuic';
  const hasPassword = proto === 'trojan' || proto === 'hysteria2' || proto === 'tuic';

  const loadClients = useCallback(async () => {
    setLoading(true);
    try { const res = await api.getClients(inbound.id); if (res.ok) setClients(res.data || []); } catch {}
    setLoading(false);
  }, [inbound.id]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const handleAdd = async () => {
    try {
      const res = await api.addClient(inbound.id, {
        email: addForm.email || `user-${Date.now()}@panel`,
        totalGB: parseFloat(addForm.totalGB) || 0,
        limitIp: parseInt(addForm.limitIp) || 0,
        expiryTime: parseInt(addForm.expiryDays) > 0 ? Date.now() + parseInt(addForm.expiryDays) * 86400000 : 0,
      });
      if (res.ok) { toast.success('客户端已添加'); setShowAdd(false); loadClients(); onUpdate(); }
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.removeClient(inbound.id, deleteTarget.id || deleteTarget.password);
      toast.success('已删除'); setDeleteTarget(null); loadClients(); onUpdate();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggle = async (c: any) => {
    try {
      await api.updateClient(inbound.id, c.id || c.password, { enable: !c.enable });
      toast.success(c.enable ? '已禁用' : '已启用'); loadClients();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleReset = async (email: string) => {
    try { await api.resetClientTraffic(inbound.id, email); toast.success('流量已重置'); loadClients(); }
    catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <div style={{ padding: 16 }}><Loading /></div>;

  return (
    <div style={{ padding: '12px 16px', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>客户端 ({clients.length})</span>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(!showAdd)}>+ 添加</button>
      </div>

      {showAdd && (
        <div style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid var(--border)' }}>
          <div className="form-grid">
            <div className="form-group"><label className="label">Email</label>
              <input className="input" placeholder="自动生成" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} /></div>
            <div className="form-group"><label className="label">流量 (GB, 0=无限)</label>
              <input className="input" type="number" value={addForm.totalGB} onChange={e => setAddForm({...addForm, totalGB: e.target.value})} /></div>
            <div className="form-group"><label className="label">IP 限制 (0=无限)</label>
              <input className="input" type="number" value={addForm.limitIp} onChange={e => setAddForm({...addForm, limitIp: e.target.value})} /></div>
            <div className="form-group"><label className="label">有效天数 (0=永久)</label>
              <input className="input" type="number" value={addForm.expiryDays} onChange={e => setAddForm({...addForm, expiryDays: e.target.value})} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>确认</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>取消</button>
          </div>
        </div>
      )}

      {clients.length === 0 ? <Empty text="暂无客户端" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clients.map((c, i) => (
            <div key={c.id || c.password || i} style={{
              padding: '10px 14px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${c.enable !== false ? 'var(--border)' : 'rgba(239,68,68,0.3)'}`, opacity: c.enable !== false ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot status={c.enable !== false ? 'active' : 'stopped'} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{c.email}</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(c)}>{c.enable !== false ? '禁用' : '启用'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleReset(c.email)}>重置</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(c)}>删除</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                {hasUUID && c.id && <span style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)' }} onClick={() => copyText(c.id)} title="复制 UUID">UUID: {c.id.slice(0,8)}...</span>}
                {hasPassword && c.password && <span style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)' }} onClick={() => copyText(c.password)} title="复制密码">密码: {c.password.slice(0,8)}...</span>}
                {c.flow && <span>Flow: {c.flow}</span>}
                <span>↑{formatBytes(c.up||0)} ↓{formatBytes(c.down||0)}</span>
                {c.limitIp > 0 && <span>IP限: {c.limitIp}</span>}
                {c.totalGB > 0 && <span>配额: {(c.totalGB/1073741824).toFixed(1)}GB</span>}
                {c.expiryTime > 0 && <span>到期: {new Date(c.expiryTime).toLocaleDateString('zh-CN')}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Confirm open={!!deleteTarget} msg={`确认删除客户端「${deleteTarget?.email}」？`} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}

// ===== Edit Modal =====
function EditModal({ inbound, open, onClose, onSaved }: { inbound: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ remark: '', port: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open && inbound) setForm({ remark: inbound.remark||'', port: String(inbound.port||'') }); }, [open, inbound]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateInbound(inbound.id, { remark: form.remark||undefined, port: form.port ? parseInt(form.port) : undefined });
      toast.success('已更新'); onSaved(); onClose();
    } catch (err: any) { toast.error(err.message); }
    setSaving(false);
  };

  return (
    <Modal title="编辑入站" subtitle={`#${inbound?.id} ${inbound?.protocol}`} open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group"><label className="label">备注名称</label>
          <input className="input" value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} /></div>
        <div className="form-group"><label className="label">端口</label>
          <input className="input" type="number" value={form.port} onChange={e => setForm({...form, port: e.target.value})} /></div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>修改端口后需重启 Xray 生效。更多参数请在原版面板编辑。</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ===== Main =====
export function XuiPage() {
  const [tab, setTab] = useState<'api'|'sub'|'panel'>('api');
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number|null>(null);
  const [expandedId, setExpandedId] = useState<number|null>(null);
  const [editInbound, setEditInbound] = useState<any>(null);
  const [subLinks, setSubLinks] = useState<any[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subAddr, setSubAddr] = useState('');
  const [qrData, setQrData] = useState<any>(null);
  const token = localStorage.getItem('token') || '';

  const load = async () => {
    setLoading(true);
    try {
      const [ib, st] = await Promise.allSettled([api.listInbounds(), api.getXuiStatus()]);
      if (ib.status==='fulfilled' && ib.value.ok) setInbounds(ib.value.data);
      if (st.status==='fulfilled' && st.value.ok) setStatus(st.value.data);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const loadSubLinks = async (addr?: string) => {
    setSubLoading(true);
    try { const r = await fetch(`/api/v1/sub/links${addr?`?addr=${addr}`:''}`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()); if (r.ok) setSubLinks(r.data||[]); } catch {}
    setSubLoading(false);
  };

  const handleDelete = async () => {
    if (deleteId===null) return;
    try { await api.deleteInbound(deleteId); toast.success('已删除'); load(); } catch (e:any) { toast.error(e.message); }
    setDeleteId(null);
  };
  const handleToggle = async (ib: any) => {
    try { await api.toggleInbound(ib.id, !ib.enable); toast.success(ib.enable?'已禁用':'已启用'); load(); } catch (e:any) { toast.error(e.message); }
  };
  const handleReset = async (id: number) => {
    try { await api.resetInboundTraffic(id); toast.success('流量已重置'); load(); } catch (e:any) { toast.error(e.message); }
  };

  const subBase = `${location.origin}/api/v1/sub`;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">3X-UI 管理</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => api.restartXray().then(() => toast.success('Xray 已重启'))}>重启 Xray</button>
          <button className="btn btn-ghost btn-sm" onClick={load}>刷新</button>
        </div>
      </div>

      {status && (
        <div className="card" style={{ marginBottom:16, padding:'12px 20px' }}>
          <div style={{ display:'flex', gap:24, alignItems:'center', flexWrap:'wrap' }}>
            <StatusDot status={status.connected?'active':'stopped'} />
            <span style={{ fontSize:13, color:'var(--text-dim)' }}>入站: <strong style={{ color:'var(--accent)' }}>{inbounds.length}</strong></span>
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab-btn ${tab==='api'?'active':''}`} onClick={() => setTab('api')}>入站管理</button>
        <button className={`tab-btn ${tab==='sub'?'active':''}`} onClick={() => {setTab('sub'); if(!subLinks.length) loadSubLinks();}}>订阅链接</button>
        <button className={`tab-btn ${tab==='panel'?'active':''}`} onClick={() => setTab('panel')}>原版面板</button>
      </div>

      {tab==='api' && (
        loading ? <Loading /> : inbounds.length===0 ? <div className="card"><Empty text="暂无入站规则" /></div> : (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {inbounds.map(ib => (
              <div className="card" key={ib.id} style={{ padding:0, overflow:'hidden' }}>
                <div style={{ padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom: expandedId===ib.id ? '1px solid var(--border)' : 'none', opacity: ib.enable ? 1 : 0.6 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, cursor:'pointer' }} onClick={() => setExpandedId(expandedId===ib.id ? null : ib.id)}>
                    <span style={{ fontSize:11, color:'var(--text-dim)', transform: expandedId===ib.id ? 'rotate(90deg)' : '', transition:'transform 150ms' }}>▶</span>
                    <StatusDot status={ib.enable ? 'active' : 'stopped'} />
                    <span style={{ fontWeight:500 }}>{ib.remark}</span>
                    <Badge type={`xray-${ib.protocol}`} />
                    <code style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--accent)' }}>:{ib.port}</code>
                    <span style={{ fontSize:12, color:'var(--text-dim)' }}>{ib.clientCount||0} 客户端</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-dim)' }}>↑{formatBytes(ib.up||0)} ↓{formatBytes(ib.down||0)}</span>
                    <div style={{ display:'flex', gap:4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(ib)}>{ib.enable ? '禁用' : '启用'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditInbound(ib)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleReset(ib.id)}>重置</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(ib.id)}>删除</button>
                    </div>
                  </div>
                </div>
                {expandedId===ib.id && <ClientPanel inbound={ib} onUpdate={load} />}
              </div>
            ))}
          </div>
        )
      )}

      {tab==='sub' && (
        <div>
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:200 }}>
                <label className="label">服务器地址 (留空自动检测)</label>
                <input className="input" placeholder="your.domain.com" value={subAddr} onChange={e => setSubAddr(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={() => loadSubLinks(subAddr||undefined)}>{subLoading ? '加载中...' : '生成链接'}</button>
            </div>
          </div>
          <div className="card" style={{ marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>通用订阅</div>
            {[
              { label: 'Base64 (V2rayN/Shadowrocket)', url: `${subBase}/base64?token=${token}${subAddr?`&addr=${subAddr}`:''}` },
              { label: 'Clash (Clash/ClashX/Stash)', url: `${subBase}/clash?token=${token}${subAddr?`&addr=${subAddr}`:''}` },
            ].map(s => (
              <div key={s.label} style={{ padding:'10px 12px', background:'var(--bg)', borderRadius:'var(--radius-sm)', marginBottom:8 }}>
                <div style={{ fontSize:12, color:'var(--text-dim)', marginBottom:4 }}>{s.label}</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <code style={{ flex:1, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--accent)', wordBreak:'break-all' }}>{s.url}</code>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyText(s.url)}>复制</button>
                </div>
              </div>
            ))}
          </div>
          {subLoading ? <Loading /> : subLinks.length===0 ? <div className="card"><Empty text="暂无链接" /></div> : (
            <div className="card">
              <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>单条链接 ({subLinks.length})</div>
              {subLinks.map(l => (
                <div key={l.id} style={{ padding:'12px', background:'var(--bg)', borderRadius:'var(--radius)', marginBottom:8, border:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}><Badge type={`xray-${l.protocol}`} /><span style={{ fontWeight:500 }}>{l.remark}</span></div>
                    <button className="btn btn-primary btn-sm" onClick={() => copyText(l.link)}>复制</button>
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      try {
                        const res = await api.getQRCode(l.id, subAddr || undefined);
                        if (res.ok) setQrData(res.data);
                      } catch {}
                    }}>二维码</button>
                  </div>
                  <code style={{ display:'block', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-dim)', wordBreak:'break-all', maxHeight:48, overflow:'hidden' }}>{l.link}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==='panel' && (
        <div className="card" style={{ padding:0, overflow:'hidden', height:'calc(100vh - 240px)' }}>
          <iframe src="/xui/" title="3X-UI" style={{ width:'100%', height:'100%', border:'none' }} />
        </div>
      )}

      <EditModal inbound={editInbound} open={!!editInbound} onClose={() => setEditInbound(null)} onSaved={load} />
      <Confirm open={deleteId!==null} msg="确认删除此入站？所有客户端配置将失效。" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />

      {/* QR Code Modal */}
      <Modal title="二维码" subtitle={qrData?.remark} open={!!qrData} onClose={() => setQrData(null)}>
        {qrData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <img src={qrData.qr} alt="QR Code" style={{ width: 260, height: 260, borderRadius: 8, background: 'white', padding: 8 }} />
            <Badge type={`xray-${qrData.protocol}`} />
            <code style={{ fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all', maxWidth: 320, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
              {qrData.link?.slice(0, 80)}...
            </code>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => copyText(qrData.link)}>复制链接</button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const a = document.createElement('a');
                a.href = qrData.qr;
                a.download = `${qrData.remark || 'qrcode'}.png`;
                a.click();
              }}>下载图片</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
