// src/components/Layout.tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../services/store';

const navItems = [
  { key: 'dashboard', icon: '◈', label: '总览' },
  { key: 'forwards',  icon: '⇄', label: '转发管理' },
  { key: 'tunnels',   icon: '◎', label: '隧道链路' },
  { key: 'xui',       icon: '◆', label: '3X-UI' },
  { key: 'nodes',     icon: '▣', label: '节点管理' },
  { key: 'bbr',       icon: '⚡', label: 'BBR 调参' },
  { key: 'users',     icon: '👤', label: '用户管理' },
  { key: 'tools',     icon: '🔧', label: '工具箱' },
  { key: 'settings',  icon: '⚙', label: '系统设置' },
];

export function Layout({ page, setPage, children }: {
  page: string; setPage: (p: string) => void; children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const [time, setTime] = useState(new Date());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <header style={{
        height: 56, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 24px',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--accent), var(--purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, color: '#fff',
          }}>U</div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>Unified Panel</span>
          <span className="badge" style={{
            color: 'var(--text-dim)', background: 'rgba(100,116,139,0.12)',
            fontSize: 11,
          }}>v1.0</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-dim)',
          }}>{time.toLocaleTimeString('zh-CN')}</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{user?.username}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>登出</button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <nav style={{
          width: collapsed ? 56 : 192, minHeight: 0,
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
          padding: '12px 8px', transition: 'width 150ms ease', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
        }}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setPage(item.key)} style={{
              width: '100%', padding: collapsed ? '10px 0' : '10px 14px',
              background: page === item.key ? 'var(--accent-dim)' : 'transparent',
              border: page === item.key ? '1px solid rgba(6,182,212,0.2)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              textAlign: collapsed ? 'center' : 'left', marginBottom: 4,
              display: 'flex', alignItems: 'center', gap: 10,
              justifyContent: collapsed ? 'center' : 'flex-start',
              transition: 'all 150ms ease',
              color: page === item.key ? 'var(--accent)' : 'var(--text-dim)',
              fontFamily: 'inherit',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && (
                <span style={{ fontSize: 13, fontWeight: page === item.key ? 600 : 400 }}>
                  {item.label}
                </span>
              )}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={() => setCollapsed(!collapsed)} style={{
            width: '100%', padding: '8px', background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
            fontFamily: 'inherit',
          }}>{collapsed ? '»' : '«'}</button>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
