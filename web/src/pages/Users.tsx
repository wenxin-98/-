// src/pages/Users.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Modal, Confirm, Loading, Empty, formatBytes, Code } from '../components/ui';
import toast from 'react-hot-toast';

function CreateUserModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({
    username: '', password: '', role: 'user',
    trafficQuota: '0', maxRules: '0', expiresAt: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm({ username: '', password: '', role: 'user', trafficQuota: '0', maxRules: '0', expiresAt: '' });
  }, [open]);

  const handleSubmit = async () => {
    if (!form.username || !form.password) return toast.error('用户名和密码必填');
    if (form.password.length < 6) return toast.error('密码至少 6 位');
    setSubmitting(true);
    try {
      await api.createUser({
        username: form.username,
        password: form.password,
        role: form.role,
        trafficQuota: parseInt(form.trafficQuota) * 1073741824 || 0, // GB → bytes
        maxRules: parseInt(form.maxRules) || 0,
        expiresAt: form.expiresAt || undefined,
      });
      toast.success('用户已创建');
      onCreated(); onClose();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal title="创建用户" open={open} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '创建中...' : '创建'}
        </button>
      </>
    }>
      <div className="form-grid">
        <div className="form-group">
          <label className="label">用户名</label>
          <input className="input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">密码</label>
          <input className="input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          {form.password && (
            <div style={{ marginTop: 4, fontSize: 11, color:
              form.password.length >= 12 && /[A-Z]/.test(form.password) && /[0-9]/.test(form.password) ? 'var(--green)' :
              form.password.length >= 8 ? 'var(--yellow)' : 'var(--red)'
            }}>
              {form.password.length < 6 ? '太短 (至少 6 位)' :
               form.password.length < 8 ? '弱' :
               form.password.length < 12 || !/[A-Z]/.test(form.password) ? '中等' : '强'}
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="label">角色</label>
          <select className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="viewer">只读</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">流量配额 (GB, 0=无限)</label>
          <input className="input" type="number" value={form.trafficQuota} onChange={e => setForm({ ...form, trafficQuota: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">最大规则数 (0=无限)</label>
          <input className="input" type="number" value={form.maxRules} onChange={e => setForm({ ...form, maxRules: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">到期时间 (可选)</label>
          <input className="input" type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const [userList, setUserList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listUsers();
      if (res.ok) setUserList(res.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async () => {
    if (deleteId === null) return;
    try { await api.deleteUser(deleteId); toast.success('已删除'); load(); }
    catch (err: any) { toast.error(err.message); }
    setDeleteId(null);
  };

  const handleToggle = async (user: any) => {
    try {
      await api.updateUser(user.id, { enabled: !user.enabled });
      toast.success(user.enabled ? '已禁用' : '已启用');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleResetTraffic = async (id: number) => {
    try { await api.resetUserTraffic(id); toast.success('流量已重置'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  const handleRefreshToken = async (id: number) => {
    try {
      const res = await api.refreshUserToken(id);
      if (res.ok) toast.success(`新 Token: ${res.data.subToken}`);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">用户管理</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 创建用户</button>
      </div>

      {loading ? <Loading /> : userList.length === 0 ? (
        <div className="card"><Empty text="暂无用户" /></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr>
                <th>用户名</th><th>角色</th><th>规则数</th><th>流量</th><th>配额</th><th>到期</th><th>状态</th><th>操作</th>
              </tr></thead>
              <tbody>
                {userList.map(u => {
                  const quotaGB = u.trafficQuota ? (u.trafficQuota / 1073741824).toFixed(0) : '∞';
                  const usedPct = u.trafficQuota ? Math.min(100, (u.trafficUsed || 0) / u.trafficQuota * 100) : 0;
                  const expired = u.expiresAt && new Date(u.expiresAt) < new Date();

                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.username}</td>
                      <td><Badge type={u.role === 'admin' ? 'active' : u.role === 'viewer' ? 'stopped' : 'entry'}
                        label={u.role === 'admin' ? '管理员' : u.role === 'viewer' ? '只读' : '用户'} /></td>
                      <td>{u.ruleCount || 0}{u.maxRules ? ` / ${u.maxRules}` : ''}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                            {formatBytes(u.trafficUsed || 0)}
                          </span>
                          {u.trafficQuota > 0 && (
                            <div style={{ width: 60, height: 3, background: 'var(--bg)', borderRadius: 2 }}>
                              <div style={{
                                width: `${usedPct}%`, height: '100%', borderRadius: 2,
                                background: usedPct > 80 ? 'var(--red)' : 'var(--accent)',
                              }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{quotaGB} GB</td>
                      <td style={{ fontSize: 12, color: expired ? 'var(--red)' : 'var(--text-dim)' }}>
                        {u.expiresAt ? new Date(u.expiresAt).toLocaleDateString('zh-CN') : '永久'}
                        {expired && ' (已过期)'}
                      </td>
                      <td><StatusDot status={u.enabled ? 'active' : 'stopped'} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(u)}>
                            {u.enabled ? '禁用' : '启用'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleResetTraffic(u.id)}>重置流量</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleRefreshToken(u.id)}>刷新Token</button>
                          {u.role !== 'admin' && (
                            <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}>删除</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
      <Confirm open={deleteId !== null} msg="确认删除此用户？其关联规则不会被删除。"
        onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
