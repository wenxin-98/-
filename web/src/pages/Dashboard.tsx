// src/pages/Dashboard.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { StatCard, StatusDot, Badge, Loading, formatBytes } from '../components/ui';
import { useWebSocket } from '../hooks/useWebSocket';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>
          {p.name === 'up' ? '上行' : '下行'}: {formatBytes(p.value)}
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [traffic, setTraffic] = useState<any[]>([]);
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(true);
  const { connected, subscribe } = useWebSocket();

  const load = useCallback(async () => {
    try {
      const [overRes, tRes] = await Promise.allSettled([
        api.getOverview(),
        api.getTrafficSummary(range),
      ]);
      if (overRes.status === 'fulfilled' && overRes.value.ok) setData(overRes.value.data);
      if (tRes.status === 'fulfilled' && tRes.value.ok) {
        setTraffic((tRes.value.data || []).map((d: any) => ({
          hour: d.hour?.slice(11, 16) || d.hour,
          up: d.totalUp || 0, down: d.totalDown || 0,
        })));
      }
    } catch {}
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => subscribe('nodes:status', () => load()), [subscribe, load]);

  if (loading) return <Loading />;
  if (!data) return <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 48 }}>加载失败</div>;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">系统总览</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: connected ? 'var(--green)' : 'var(--text-muted)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? 'var(--green)' : 'var(--text-muted)', boxShadow: connected ? '0 0 6px var(--green)' : 'none' }} />
            {connected ? '实时' : '离线'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={load}>刷新</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard label="在线节点" value={data.nodes?.online || 0} sub={`共 ${data.nodes?.total || 0}`} color="var(--green)" />
        <StatCard label="转发规则" value={data.rules?.total || 0} sub={`${data.rules?.active || 0} 运行`} color="var(--accent)" />
        <StatCard label="总上行" value={formatBytes(data.rules?.totalUp || 0)} color="var(--yellow)" />
        <StatCard label="总下行" value={formatBytes(data.rules?.totalDown || 0)} color="var(--purple)" />
      </div>

      {/* Traffic chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>流量趋势</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['1h', '6h', '24h', '7d', '30d'].map(r => (
              <button key={r} onClick={() => setRange(r)} className={`tab-btn ${range === r ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 11 }}>{r}</button>
            ))}
          </div>
        </div>
        {traffic.length > 0 ? (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <AreaChart data={traffic} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gDn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.5)" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatBytes(v)} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="up" name="up" stroke="#06b6d4" strokeWidth={2} fill="url(#gUp)" />
                <Area type="monotone" dataKey="down" name="down" stroke="#a855f7" strokeWidth={2} fill="url(#gDn)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-dim)', fontSize: 13 }}>暂无流量数据</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          <span style={{ color: '#06b6d4' }}>● 上行</span>
          <span style={{ color: '#a855f7' }}>● 下行</span>
        </div>
      </div>

      {/* 2-col: Services + System */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>服务状态</div>
          {[
            { n: 'GOST v3', ok: data.gostConnected, d: '端口转发 / 加密隧道' },
            { n: '3X-UI', ok: data.xuiConnected, d: '协议代理' },
            { n: 'WebSocket', ok: connected, d: '实时推送' },
          ].map(s => (
            <div key={s.n} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(30,41,59,0.3)' }}>
              <div><div style={{ fontWeight: 500 }}>{s.n}</div><div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.d}</div></div>
              <StatusDot status={s.ok ? 'active' : 'stopped'} />
            </div>
          ))}
        </div>
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>系统信息</div>
          {data.system ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { l: 'CPU', v: `${data.system.cpuUsage}%`, c: 'var(--accent)', pct: data.system.cpuUsage },
                { l: '内存', v: data.system.memory, c: 'var(--purple)', pct: null },
                { l: '磁盘', v: data.system.disk, c: 'var(--yellow)', pct: null },
                { l: '运行', v: data.system.uptime, c: 'var(--green)', pct: null },
              ].map(i => (
                <div key={i.l}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{i.l}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: i.c, fontWeight: 600 }}>{i.v}</span>
                  </div>
                  {i.pct !== null && (
                    <div style={{ width: '100%', height: 4, background: 'var(--bg)', borderRadius: 2 }}>
                      <div style={{ width: `${Math.min(i.pct, 100)}%`, height: '100%', background: i.pct > 80 ? 'var(--red)' : i.c, borderRadius: 2, transition: 'width 500ms' }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <div style={{ color: 'var(--text-dim)' }}>获取中...</div>}
        </div>
      </div>

      {/* Recent logs */}
      <div className="card">
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>最近操作</div>
        {data.recentLogs?.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>操作</th><th>目标</th><th>时间</th></tr></thead>
              <tbody>
                {data.recentLogs.slice(0, 8).map((log: any) => (
                  <tr key={log.id}>
                    <td><Badge type={log.action.includes('create') ? 'active' : log.action.includes('delete') ? 'error' : 'stopped'} label={log.action} /></td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.target || '-'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>{log.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>暂无记录</div>}
      </div>
    </div>
  );
}
