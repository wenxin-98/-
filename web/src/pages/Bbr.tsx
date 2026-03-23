// src/pages/Bbr.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Loading, Empty, Code, Modal, StatCard, formatBytes } from '../components/ui';
import toast from 'react-hot-toast';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const qualityColors: Record<string, string> = {
  excellent: 'var(--green)', good: '#22d3ee',
  fair: 'var(--yellow)', poor: 'var(--orange)', bad: 'var(--red)',
};
const qualityLabels: Record<string, string> = {
  excellent: '极佳', good: '良好', fair: '一般', poor: '较差', bad: '很差',
};

function QualityBadge({ quality }: { quality: string }) {
  const color = qualityColors[quality] || 'var(--text-dim)';
  return <span style={{
    padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    color, background: `${color}18`, border: `1px solid ${color}33`,
  }}>{qualityLabels[quality] || quality}</span>;
}

function RTTChart({ data }: { data: any[] }) {
  if (!data?.length) return null;
  const chartData = data.slice(-30).map((d: any, i: number) => ({
    idx: i, rtt: d.rttAvg, loss: d.packetLoss, jitter: d.jitter,
  }));
  return (
    <div style={{ width: '100%', height: 160 }}>
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRtt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,41,59,0.5)" />
          <XAxis dataKey="idx" tick={false} axisLine={{ stroke: '#1e293b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={40} unit="ms" />
          <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [
              name === 'rtt' ? `${v.toFixed(1)}ms` : name === 'loss' ? `${v.toFixed(2)}%` : `${v.toFixed(1)}ms`,
              name === 'rtt' ? 'RTT' : name === 'loss' ? '丢包' : '抖动'
            ]} />
          <Area type="monotone" dataKey="rtt" stroke="#06b6d4" strokeWidth={2} fill="url(#gRtt)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function fetcher(url: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  }).then(r => r.json());
}

export function BbrPage() {
  const [tab, setTab] = useState<'overview' | 'system' | 'profiles'>('overview');
  const [probes, setProbes] = useState<any[]>([]);
  const [tunerStatus, setTunerStatus] = useState<any>(null);
  const [systemBbr, setSystemBbr] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recommending, setRecommending] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [p, t, s] = await Promise.allSettled([
        fetcher('/api/v1/bbr/probe'),
        fetcher('/api/v1/bbr/tuner'),
        fetcher('/api/v1/bbr/system'),
      ]);
      if (p.status === 'fulfilled' && p.value.ok) setProbes(p.value.data || []);
      if (t.status === 'fulfilled' && t.value.ok) setTunerStatus(t.value.data);
      if (s.status === 'fulfilled' && s.value.ok) setSystemBbr(s.value.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const handleEnableBbr = async (profile: string) => {
    try {
      const res = await fetcher(`/api/v1/bbr/system/enable`).then(() =>
        fetch('/api/v1/bbr/system/enable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify({ profile }),
        }).then(r => r.json())
      );
      if (res.ok) { toast.success(`BBR ${profile} 已启用`); load(); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggleTuner = async (action: 'start' | 'stop') => {
    try {
      const res = await fetch(`/api/v1/bbr/tuner/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: '{}',
      }).then(r => r.json());
      if (res.ok) { toast.success(res.msg); load(); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRecommend = async (host: string) => {
    setRecommending(host);
    try {
      const res = await fetch(`/api/v1/bbr/recommend/${host}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: '{}',
      }).then(r => r.json());
      if (res.ok) setRecommendation(res.data);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleProbeNow = async (host: string) => {
    try {
      const res = await fetch(`/api/v1/bbr/probe/${host}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json());
      if (res.ok) { toast.success(`${host}: RTT=${res.data.rttAvg}ms 丢包=${res.data.packetLoss}%`); load(); }
    } catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">BBR 动态调参</h2>
        <button className="btn btn-ghost btn-sm" onClick={load}>刷新</button>
      </div>

      <div className="tabs">
        {[
          { k: 'overview', l: '网络总览' },
          { k: 'system', l: '系统 BBR' },
          { k: 'profiles', l: '调参引擎' },
        ].map(t => (
          <button key={t.k} className={`tab-btn ${tab === t.k ? 'active' : ''}`}
            onClick={() => setTab(t.k as any)}>{t.l}</button>
        ))}
      </div>

      {/* ===== 网络总览 ===== */}
      {tab === 'overview' && (
        <div>
          {/* 统计卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, marginBottom: 20 }}>
            <StatCard label="探测节点" value={probes.length} color="var(--accent)" />
            <StatCard label="平均 RTT"
              value={probes.length ? `${(probes.reduce((a, p) => a + p.rttAvg, 0) / probes.length).toFixed(0)}ms` : '-'}
              color="var(--green)" />
            <StatCard label="平均丢包"
              value={probes.length ? `${(probes.reduce((a, p) => a + p.packetLoss, 0) / probes.length).toFixed(1)}%` : '-'}
              color="var(--yellow)" />
            <StatCard label="自动调参"
              value={tunerStatus?.enabled ? '运行中' : '未启动'}
              color={tunerStatus?.enabled ? 'var(--green)' : 'var(--text-dim)'} />
          </div>

          {/* 节点探测列表 */}
          {probes.length === 0 ? (
            <div className="card"><Empty text="暂无探测数据，启动自动调参或手动探测" /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {probes.map(probe => (
                <div className="card" key={probe.target}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{probe.target}</code>
                      <QualityBadge quality={probe.quality} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleProbeNow(probe.target)}>立即探测</button>
                      <button className="btn btn-primary btn-sm" onClick={() => handleRecommend(probe.target)}>智能推荐</button>
                    </div>
                  </div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: 12, marginBottom: 8,
                  }}>
                    {[
                      { l: 'RTT', v: `${probe.rttAvg?.toFixed(1)}ms`, c: 'var(--accent)' },
                      { l: '丢包', v: `${probe.packetLoss?.toFixed(2)}%`, c: probe.packetLoss > 2 ? 'var(--red)' : 'var(--green)' },
                      { l: '抖动', v: `${probe.jitter?.toFixed(1)}ms`, c: probe.jitter > 50 ? 'var(--yellow)' : 'var(--green)' },
                      { l: '带宽', v: `${probe.bandwidth?.toFixed(0) || '?'} Mbps`, c: 'var(--purple)' },
                    ].map(m => (
                      <div key={m.l} style={{ padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{m.l}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: m.c }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 系统 BBR ===== */}
      {tab === 'system' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>内核 BBR 状态</div>
            {systemBbr ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>BBR 可用</span>
                  <StatusDot status={systemBbr.available ? 'active' : 'stopped'} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>BBR 已启用</span>
                  <StatusDot status={systemBbr.enabled ? 'active' : 'stopped'} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>拥塞控制</span>
                  <Badge type={systemBbr.congestionControl === 'bbr' ? 'active' : 'stopped'}
                    label={systemBbr.congestionControl} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>队列调度</span>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{systemBbr.qdisc}</code>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  可用算法: {systemBbr.kernelModules?.join(', ')}
                </div>
              </div>
            ) : <div style={{ color: 'var(--text-dim)' }}>加载中...</div>}
          </div>

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>一键启用 BBR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { k: 'conservative', l: '保守', d: '小缓冲区，适合低内存 VPS' },
                { k: 'balanced', l: '均衡 (推荐)', d: '适合大多数场景' },
                { k: 'aggressive', l: '激进', d: '大缓冲区 + TFO + 最大窗口' },
              ].map(p => (
                <button key={p.k} onClick={() => handleEnableBbr(p.k)} style={{
                  padding: '12px 16px', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', color: 'var(--text)', transition: 'border-color 150ms',
                }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{p.l}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.d}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              启用后会自动设置 sysctl 参数并持久化到 /etc/sysctl.conf。
              需要 Linux 4.9+ 内核支持。
            </div>
          </div>

          {/* 当前参数 */}
          {systemBbr?.params && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>当前内核网络参数</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
                {Object.entries(systemBbr.params as Record<string, string>).map(([k, v]) => (
                  <div key={k} style={{
                    display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                    background: 'var(--bg)', borderRadius: 'var(--radius-sm)', fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{k}</span>
                    <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 调参引擎 ===== */}
      {tab === 'profiles' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>自动调参引擎</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  根据实时网络质量自动切换 KCP/QUIC 参数
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {tunerStatus?.enabled ? (
                  <button className="btn btn-danger btn-sm" onClick={() => handleToggleTuner('stop')}>停止</button>
                ) : (
                  <button className="btn btn-primary" onClick={() => handleToggleTuner('start')}>启动自动调参</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusDot status={tunerStatus?.enabled ? 'active' : 'stopped'} />
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                评估间隔: {tunerStatus?.tuneInterval ? `${tunerStatus.tuneInterval / 1000}s` : '-'}
              </span>
            </div>
          </div>

          {/* 调参历史 */}
          {tunerStatus?.recentTunes?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>调参记录</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>时间</th><th>目标</th><th>操作</th><th>变更</th><th>原因</th></tr></thead>
                  <tbody>
                    {tunerStatus.recentTunes.slice(-15).reverse().map((t: any, i: number) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                          {new Date(t.timestamp).toLocaleTimeString('zh-CN')}
                        </td>
                        <td><code style={{ fontSize: 12 }}>{t.target}</code></td>
                        <td><Badge type="active" label={t.action} /></td>
                        <td style={{ fontSize: 12 }}>{t.from} → <strong style={{ color: 'var(--accent)' }}>{t.to}</strong></td>
                        <td style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* KCP Profile 说明 */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>KCP 参数 Profile</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {[
                { k: 'ultra_low_latency', l: '极低延迟', d: '窗口 2048, 10ms 刷新, 关闭拥塞控制', c: 'var(--green)' },
                { k: 'low_latency', l: '低延迟', d: '窗口 1024, 20ms 刷新', c: '#22d3ee' },
                { k: 'balanced', l: '均衡', d: '窗口 512, 30ms 刷新, 默认拥塞控制', c: 'var(--accent)' },
                { k: 'high_loss_resist', l: '抗丢包', d: '5 校验分片, 窗口 256, 关闭拥塞控制', c: 'var(--yellow)' },
                { k: 'bandwidth_priority', l: '带宽优先', d: '窗口 4096, 2 校验分片, 最小冗余', c: 'var(--purple)' },
              ].map(p => (
                <div key={p.k} style={{
                  padding: '14px 16px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                  border: `1px solid ${p.c}22`,
                }}>
                  <div style={{ fontWeight: 600, color: p.c, marginBottom: 4 }}>{p.l}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{p.d}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>{p.k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 推荐结果弹窗 */}
      <Modal title="智能调参推荐" subtitle={recommending || ''} open={!!recommendation}
        onClose={() => { setRecommendation(null); setRecommending(null); }}>
        {recommendation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 网络概况 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8,
            }}>
              {[
                { l: 'RTT', v: `${recommendation.probe.rttAvg?.toFixed(1)}ms`, c: 'var(--accent)' },
                { l: '丢包', v: `${recommendation.probe.packetLoss?.toFixed(2)}%`, c: recommendation.probe.packetLoss > 2 ? 'var(--red)' : 'var(--green)' },
                { l: '抖动', v: `${recommendation.probe.jitter?.toFixed(1)}ms`, c: 'var(--yellow)' },
                { l: '质量', v: qualityLabels[recommendation.probe.quality], c: qualityColors[recommendation.probe.quality] },
              ].map(m => (
                <div key={m.l} style={{ textAlign: 'center', padding: '10px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{m.l}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: m.c }}>{m.v}</div>
                </div>
              ))}
            </div>

            {/* 推荐参数 */}
            <div style={{ padding: 14, background: 'var(--accent-dim)', borderRadius: 'var(--radius)', border: '1px solid rgba(6,182,212,0.2)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>推荐配置</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>系统 BBR: <strong>{recommendation.recommendations.systemBbr}</strong></div>
                <div>KCP Profile: <strong>{recommendation.recommendations.kcpProfile}</strong></div>
                <div>Hysteria2 带宽: <strong>↑{recommendation.recommendations.hysteria2.upMbps} / ↓{recommendation.recommendations.hysteria2.downMbps} Mbps</strong></div>
                <div>TUIC 拥塞控制: <strong>{recommendation.recommendations.tuicCongestion}</strong></div>
              </div>
            </div>

            {/* 解释 */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {recommendation.recommendations.explanation}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
