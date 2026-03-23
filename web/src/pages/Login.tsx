// src/pages/Login.tsx
import React, { useState } from 'react';
import { useAuth } from '../services/store';
import toast from 'react-hot-toast';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return toast.error('请填写账号密码');
    setLoading(true);
    try {
      await login(username, password);
      toast.success('登录成功');
    } catch (err: any) {
      toast.error(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div style={{
          width: 48, height: 48, borderRadius: 12, margin: '0 auto 20px',
          background: 'linear-gradient(135deg, var(--accent), var(--purple))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 700, color: '#fff',
        }}>U</div>
        <div className="login-title">统一转发管理面板</div>
        <div className="login-sub">GOST + 3X-UI 集成管理</div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label className="label">用户名</label>
            <input className="input" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin" autoFocus />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label className="label">密码</label>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="••••••" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px 0', fontSize: 14, justifyContent: 'center' }}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  );
}
