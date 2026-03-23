// src/App.tsx
import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from './services/store';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { Loading } from './components/ui';

// 懒加载页面 — Dashboard 含 recharts (~500KB)，首屏不加载
const DashboardPage = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const ForwardsPage  = lazy(() => import('./pages/Forwards').then(m => ({ default: m.ForwardsPage })));
const TunnelsPage   = lazy(() => import('./pages/Tunnels').then(m => ({ default: m.TunnelsPage })));
const XuiPage       = lazy(() => import('./pages/Xui').then(m => ({ default: m.XuiPage })));
const NodesPage     = lazy(() => import('./pages/Nodes').then(m => ({ default: m.NodesPage })));
const SettingsPage  = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const BbrPage       = lazy(() => import('./pages/Bbr').then(m => ({ default: m.BbrPage })));
const UsersPage     = lazy(() => import('./pages/Users').then(m => ({ default: m.UsersPage })));
const ToolsPage     = lazy(() => import('./pages/Tools').then(m => ({ default: m.ToolsPage })));

const pages: Record<string, React.LazyExoticComponent<React.FC>> = {
  dashboard: DashboardPage,
  forwards: ForwardsPage,
  tunnels: TunnelsPage,
  xui: XuiPage,
  nodes: NodesPage,
  bbr: BbrPage,
  users: UsersPage,
  tools: ToolsPage,
  settings: SettingsPage,
};

export default function App() {
  const { token, loading, checkAuth } = useAuth();
  const [page, setPage] = useState('dashboard');

  useEffect(() => { checkAuth(); }, []);

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <Loading />
      </div>
    );
  }

  if (!token) return <LoginPage />;

  const PageComponent = pages[page] || DashboardPage;

  return (
    <Layout page={page} setPage={setPage}>
      <Suspense fallback={<Loading />}>
        <PageComponent />
      </Suspense>
    </Layout>
  );
}
