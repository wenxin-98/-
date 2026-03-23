// src/pages/Tunnels.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Modal, Confirm, Loading, Empty } from '../components/ui';
import toast from 'react-hot-toast';

const TRANSPORTS = ['tls', 'wss', 'kcp', 'quic'] as const;

interface HopForm {
  name: string; addr: string; transport: string;
  authUser: string; authPass: string;
}

const emptyHop: HopForm = { name: '', addr: '', transport: 'tls', authUser: '', authPass: '' };

function CreateChainModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [hops, setHops] = useState<HopForm[]>([{ ...emptyHop }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setHops([{ ...emptyHop }]); }
  }, [open]);

  const updateHop = (i: number, key: keyof HopForm, val: string) => {
    const copy = [...hops];
    copy[i] = { ...copy[i], [key]: val };
    setHops(copy);
  };

  const addHop = () => setHops([...hops, { ...emptyHop, name: `hop-${hops.length + 1}` }]);
  const removeHop = (i: number) => { if (hops.length > 1) setHops(hops.filter((_, j) => j !== i)); };

  const handleSubmit = async () => {
    if (!name) return toast.error('请填写链路名称');
    if (hops.some(h => !h.addr)) return toast.error('请填写所有节点地址');
    setSubmitting(true);
    try {
      await api.createChain({
        name,
        hops: hops.map((h, i) => ({
          name: h.name || `hop-${i}`,
          addr: h.addr,
          transport: h.transport,
          ...(h.authUser && { auth: { username: h.authUser, password: h.authPass } }),
        })),
      });
      toast.success('链路创建成功');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="创建隧道链路" subtitle="配置多跳转发" open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-group">
          <label className="label">链路名称</label>
          <input className="input" placeholder="HK-JP-SG-三跳链" value={name}
            onChange={e => setName(e.target.value)} />
        </div>

        {hops.map((hop, i) => (
          <div key={i} style={{
            padding: 16, background: 'var(--bg)', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                第 {i + 1} 跳
              </span>
              {hops.length > 1 && (
                <button className="btn btn-danger btn-sm" onClick={() => removeHop(i)}>移除</button>
              )}
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">节点名</label>
                <input className="input" placeholder={`节点-${i + 1}`} value={hop.name}
                  onChange={e => updateHop(i, 'name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">地址 (IP:端口)</label>
                <input className="input" placeholder="1.2.3.4:8443" value={hop.addr}
                  onChange={e => updateHop(i, 'addr', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">传输协议</label>
                <select className="input" value={hop.transport}
                  onChange={e => updateHop(i, 'transport', e.target.value)}>
                  {TRANSPORTS.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">认证 (可选)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="用户" value={hop.authUser}
                    onChange={e => updateHop(i, 'authUser', e.target.value)} style={{ flex: 1 }} />
                  <input className="input" placeholder="密码" type="password" value={hop.authPass}
                    onChange={e => updateHop(i, 'authPass', e.target.value)} style={{ flex: 1 }} />
                </div>
              </div>
            </div>
          </div>
        ))}

        <button className="btn btn-ghost" onClick={addHop} style={{ width: '100%', justifyContent: 'center' }}>
          + 添加一跳
        </button>

        {/* Chain visualization */}
        {hops.length > 0 && (
          <div className="chain-visual" style={{ justifyContent: 'center', padding: '8px 0' }}>
            <div className="chain-node" style={{
              color: 'var(--accent)', borderColor: 'rgba(6,182,212,0.3)',
              background: 'var(--accent-dim)',
            }}>客户端</div>
            {hops.map((h, i) => (
              <React.Fragment key={i}>
                <div className="chain-arrow" />
                <div className="chain-node" style={{
                  color: 'var(--purple)', borderColor: 'rgba(168,85,247,0.3)',
                  background: 'var(--purple-dim)',
                }}>
                  {h.name || h.addr || `跳 ${i + 1}`}
                  <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.7 }}>
                    {h.transport.toUpperCase()}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}
          style={{ width: '100%', padding: '12px 0', justifyContent: 'center', fontSize: 14 }}>
          {submitting ? '创建中...' : '创建链路'}
        </button>
      </div>
    </Modal>
  );
}

export function TunnelsPage() {
  const [chains, setChains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listChains();
      if (res.ok) setChains(res.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async () => {
    if (deleteId === null) return;
    try {
      await api.deleteChain(deleteId);
      toast.success('已删除');
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
    setDeleteId(null);
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">隧道链路</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 创建链路</button>
      </div>

      {/* How it works */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>工作原理</div>
        <div className="chain-visual" style={{ marginBottom: 12 }}>
          {['客户端', 'HK入口 (TLS)', 'JP中继 (WSS)', 'SG落地 (GOST)'].map((node, i, arr) => (
            <React.Fragment key={i}>
              <div className="chain-node" style={{
                color: i === 0 ? 'var(--accent)' : i === arr.length - 1 ? 'var(--green)' : 'var(--purple)',
                borderColor: i === 0 ? 'rgba(6,182,212,0.3)' : i === arr.length - 1 ? 'rgba(34,197,94,0.3)' : 'rgba(168,85,247,0.3)',
                background: i === 0 ? 'var(--accent-dim)' : i === arr.length - 1 ? 'var(--green-dim)' : 'var(--purple-dim)',
              }}>{node}</div>
              {i < arr.length - 1 && <div className="chain-arrow" />}
            </React.Fragment>
          ))}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          隧道链路将多个 GOST 节点串联成一条加密通道，流量逐级传递。每一跳支持 TLS、WSS、KCP、QUIC
          协议，可独立配置认证。创建链路后，在转发规则中选择该链路即可使用。
        </p>
      </div>

      {/* Chain list */}
      {loading ? <Loading /> : chains.length === 0 ? (
        <div className="card">
          <Empty text="暂无链路，点击上方按钮创建" />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chains.map(chain => (
            <div className="card" key={chain.id}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                marginBottom: 12,
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{chain.name}</div>
                  <div style={{
                    fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                    marginTop: 4,
                  }}>
                    {chain.gost_chain_name || chain.gostChainName} · {chain.hops?.length || 0} 跳
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusDot status={chain.status} />
                  <button className="btn btn-danger btn-sm"
                    onClick={() => setDeleteId(chain.id)}>删除</button>
                </div>
              </div>

              {/* Hop visualization */}
              <div className="chain-visual">
                {(chain.hops || []).map((hop: any, i: number, arr: any[]) => (
                  <React.Fragment key={i}>
                    <div className="chain-node" style={{
                      color: 'var(--purple)', borderColor: 'rgba(168,85,247,0.3)',
                      background: 'var(--purple-dim)', fontSize: 12,
                    }}>
                      <div>{hop.name}</div>
                      <div style={{ fontSize: 10, opacity: 0.7 }}>
                        {hop.addr} ({hop.transport})
                      </div>
                    </div>
                    {i < arr.length - 1 && <div className="chain-arrow" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateChainModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <Confirm open={deleteId !== null} msg="确认删除此链路？关联的转发规则将失效。"
        onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
