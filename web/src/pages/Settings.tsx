// src/pages/Settings.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Loading, Code, Modal, Badge, StatusDot } from '../components/ui';
import { useAuth } from '../services/store';
import toast from 'react-hot-toast';

function ServiceCard({ name, status, onRestart }: {
  name: string; status: string; onRestart: () => void;
}) {
  const isActive = status === 'active' || status === 'online';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 0', borderBottom: '1px solid rgba(30,41,59,0.3)',
    }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
        <StatusDot status={isActive ? 'active' : 'stopped'} />
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onRestart}>重启</button>
    </div>
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<'general' | 'certs' | 'security'>('general');
  const [services, setServices] = useState<any>(null);
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Password form
  const [pwForm, setPwForm] = useState({ old: '', new: '', confirm: '', username: '' });

  // Cert form
  const [certForm, setCertForm] = useState({
    domain: '', email: '', mode: 'self-signed',
    dnsProvider: '', cfKey: '', cfEmail: '',
    aliKey: '', aliSecret: '', dpId: '', dpToken: '',
    useStandalone: false, days: '3650', ip: '',
  });
  const [certLoading, setCertLoading] = useState(false);

  // IP form
  const [ipAction, setIpAction] = useState<'whitelist' | 'blacklist'>('blacklist');
  const [ipInput, setIpInput] = useState('');

  const loadServices = async () => {
    try {
      const res = await fetch('/api/v1/settings/service-status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json());
      if (res.ok) setServices(res.data);
    } catch {}
  };

  const loadCerts = async () => {
    try {
      const res = await fetch('/api/v1/settings/certs', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json());
      if (res.ok) setCerts(res.data || []);
    } catch {}
  };

  useEffect(() => {
    Promise.all([loadServices(), loadCerts()]).then(() => setLoading(false));
  }, []);

  const handleChangePassword = async () => {
    if (!pwForm.old) return toast.error('请填写旧密码');
    if (!pwForm.new && !pwForm.username) return toast.error('请填写新密码或新用户名');
    if (pwForm.new && pwForm.new !== pwForm.confirm) return toast.error('两次密码不一致');
    if (pwForm.new && pwForm.new.length < 6) return toast.error('密码至少 6 位');
    try {
      const res = await fetch('/api/v1/settings/change-admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          oldPassword: pwForm.old,
          newPassword: pwForm.new || undefined,
          newUsername: pwForm.username || undefined,
        }),
      }).then(r => r.json());
      if (res.ok) {
        toast.success('修改成功，请重新登录');
        setTimeout(() => logout(), 1500);
      } else {
        toast.error(res.msg || '修改失败');
      }
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRestartService = async (service: string) => {
    try {
      const res = await fetch('/api/v1/settings/restart-service', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ service }),
      }).then(r => r.json());
      if (res.ok) { toast.success(`${service} 已重启`); loadServices(); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGenerateCert = async () => {
    setCertLoading(true);
    try {
      let endpoint: string;
      let body: any;

      if (certForm.mode === 'self-signed') {
        endpoint = '/api/v1/settings/certs/self-signed';
        body = {
          domain: certForm.domain || 'localhost',
          days: parseInt(certForm.days) || 3650,
          ip: certForm.ip || undefined,
        };
      } else {
        endpoint = '/api/v1/settings/certs/acme';
        if (!certForm.domain) { toast.error('域名必填'); setCertLoading(false); return; }
        if (!certForm.email) { toast.error('邮箱必填'); setCertLoading(false); return; }

        // 构建 DNS 环境变量
        const envVars: Record<string, string> = {};
        if (certForm.dnsProvider === 'cloudflare' || certForm.dnsProvider === 'cf') {
          if (certForm.cfKey) envVars['CF_Key'] = certForm.cfKey;
          if (certForm.cfEmail) envVars['CF_Email'] = certForm.cfEmail;
        } else if (certForm.dnsProvider === 'ali' || certForm.dnsProvider === 'aliyun') {
          if (certForm.aliKey) envVars['Ali_Key'] = certForm.aliKey;
          if (certForm.aliSecret) envVars['Ali_Secret'] = certForm.aliSecret;
        } else if (certForm.dnsProvider === 'dp' || certForm.dnsProvider === 'dnspod') {
          if (certForm.dpId) envVars['DP_Id'] = certForm.dpId;
          if (certForm.dpToken) envVars['DP_Key'] = certForm.dpToken;
        }

        body = {
          domain: certForm.domain,
          email: certForm.email,
          useStandalone: certForm.useStandalone || !certForm.dnsProvider,
          dnsProvider: certForm.dnsProvider || undefined,
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.ok) { toast.success('证书已生成'); loadCerts(); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
    setCertLoading(false);
  };

  const handleBackup = async () => {
    try {
      const res = await fetch('/api/v1/settings/backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json());
      if (res.ok) toast.success(`备份完成: ${res.data.path}`);
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleIPAction = async () => {
    if (!ipInput) return toast.error('请输入 IP');
    try {
      const endpoint = ipAction === 'blacklist'
        ? '/api/v1/settings/ip-blacklist'
        : '/api/v1/settings/ip-whitelist';
      const body = ipAction === 'blacklist'
        ? { action: 'add', ip: ipInput }
        : { ips: ipInput.split(',').map(s => s.trim()).filter(Boolean) };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.ok) { toast.success(res.msg); setIpInput(''); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <Loading />;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">系统设置</h2>
        <button className="btn btn-ghost btn-sm" onClick={handleBackup}>备份数据库</button>
      </div>

      <div className="tabs">
        {[
          { k: 'general', l: '常规' },
          { k: 'certs', l: '证书管理' },
          { k: 'security', l: '安全设置' },
        ].map(t => (
          <button key={t.k} className={`tab-btn ${tab === t.k ? 'active' : ''}`}
            onClick={() => setTab(t.k as any)}>{t.l}</button>
        ))}
      </div>

      {/* ===== 常规 ===== */}
      {tab === 'general' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 服务状态 */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>服务管理</div>
            {services ? (
              <>
                <ServiceCard name="GOST v3" status={services.gost}
                  onRestart={() => handleRestartService('gost')} />
                <ServiceCard name="3X-UI (Xray)" status={services.xui}
                  onRestart={() => handleRestartService('x-ui')} />
                <ServiceCard name="Nginx" status={services.nginx}
                  onRestart={() => handleRestartService('nginx')} />
                <ServiceCard name="面板" status={services.panel}
                  onRestart={() => handleRestartService('unified-panel')} />
              </>
            ) : <div style={{ color: 'var(--text-dim)' }}>加载中...</div>}
          </div>

          {/* 修改密码 */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>修改账号</div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
              当前用户: {user?.username}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="label">新用户名 (不改留空)</label>
                <input className="input" type="text" placeholder={user?.username}
                  value={pwForm.username}
                  onChange={e => setPwForm({ ...pwForm, username: e.target.value })} />
              </div>
              <div>
                <label className="label">旧密码 (必填验证身份)</label>
                <input className="input" type="password" value={pwForm.old}
                  onChange={e => setPwForm({ ...pwForm, old: e.target.value })} />
              </div>
              <div>
                <label className="label">新密码 (不改留空)</label>
                <input className="input" type="password" value={pwForm.new}
                  onChange={e => setPwForm({ ...pwForm, new: e.target.value })} />
              </div>
              <div>
                <label className="label">确认密码</label>
                <input className="input" type="password" value={pwForm.confirm}
                  onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} />
              </div>
              <button className="btn btn-primary" onClick={handleChangePassword}>保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 证书管理 ===== */}
      {tab === 'certs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 已有证书 */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>已有证书</div>
            {certs.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>暂无证书</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>域名</th>
                    <th>颁发者</th>
                    <th>过期时间</th>
                    <th>自动续签</th>
                    <th>路径</th>
                  </tr>
                </thead>
                <tbody>
                  {certs.map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{c.domain}</td>
                      <td><Badge type={c.issuer.includes('ACME') ? 'active' : 'stopped'} label={c.issuer} /></td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.expiry}</td>
                      <td>{c.autoRenew ? '✓' : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                        {c.certPath}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 生成证书 */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>生成新证书</div>

            {/* Mode selector */}
            <div className="form-grid">
              <div className="form-group">
                <label className="label">模式</label>
                <select className="input" value={certForm.mode}
                  onChange={e => setCertForm({ ...certForm, mode: e.target.value })}>
                  <option value="self-signed">自签证书 (立即生成, 无需域名)</option>
                  <option value="acme">ACME / Let's Encrypt (正式证书)</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">域名 {certForm.mode === 'self-signed' ? '(可选)' : '(必填)'}</label>
                <input className="input" placeholder={certForm.mode === 'self-signed' ? 'localhost' : 'example.com'}
                  value={certForm.domain} onChange={e => setCertForm({ ...certForm, domain: e.target.value })} />
              </div>
            </div>

            {/* Self-signed extra options */}
            {certForm.mode === 'self-signed' && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-group">
                  <label className="label">有效天数</label>
                  <input className="input" type="number" value={certForm.days}
                    onChange={e => setCertForm({ ...certForm, days: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="label">IP SAN (可选, 加入证书)</label>
                  <input className="input" placeholder="如服务器公网 IP" value={certForm.ip}
                    onChange={e => setCertForm({ ...certForm, ip: e.target.value })} />
                </div>
              </div>
            )}

            {/* ACME options */}
            {certForm.mode === 'acme' && (
              <>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <div className="form-group">
                    <label className="label">邮箱 (必填)</label>
                    <input className="input" placeholder="admin@example.com" value={certForm.email}
                      onChange={e => setCertForm({ ...certForm, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="label">验证方式</label>
                    <select className="input" value={certForm.dnsProvider || (certForm.useStandalone ? '__standalone' : '')}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === '__standalone') {
                          setCertForm({ ...certForm, dnsProvider: '', useStandalone: true });
                        } else {
                          setCertForm({ ...certForm, dnsProvider: v, useStandalone: false });
                        }
                      }}>
                      <option value="__standalone">HTTP 验证 (需 80 端口空闲)</option>
                      <option value="cf">Cloudflare DNS</option>
                      <option value="ali">阿里云 DNS (aliyun)</option>
                      <option value="dp">腾讯云 DNSPod</option>
                      <option value="huaweicloud">华为云 DNS</option>
                      <option value="namesilo">NameSilo</option>
                      <option value="godaddy">GoDaddy</option>
                    </select>
                  </div>
                </div>

                {/* DNS provider credentials */}
                {certForm.dnsProvider === 'cf' && (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="form-group">
                      <label className="label">CF Global API Key</label>
                      <input className="input" type="password" placeholder="Cloudflare API Key"
                        value={certForm.cfKey} onChange={e => setCertForm({ ...certForm, cfKey: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="label">CF Email</label>
                      <input className="input" placeholder="your@email.com"
                        value={certForm.cfEmail} onChange={e => setCertForm({ ...certForm, cfEmail: e.target.value })} />
                    </div>
                  </div>
                )}
                {(certForm.dnsProvider === 'ali') && (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="form-group">
                      <label className="label">阿里云 AccessKey ID</label>
                      <input className="input" type="password" placeholder="LTAI..."
                        value={certForm.aliKey} onChange={e => setCertForm({ ...certForm, aliKey: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="label">阿里云 AccessKey Secret</label>
                      <input className="input" type="password"
                        value={certForm.aliSecret} onChange={e => setCertForm({ ...certForm, aliSecret: e.target.value })} />
                    </div>
                  </div>
                )}
                {certForm.dnsProvider === 'dp' && (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="form-group">
                      <label className="label">DNSPod ID</label>
                      <input className="input" placeholder="12345"
                        value={certForm.dpId} onChange={e => setCertForm({ ...certForm, dpId: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="label">DNSPod Token</label>
                      <input className="input" type="password"
                        value={certForm.dpToken} onChange={e => setCertForm({ ...certForm, dpToken: e.target.value })} />
                    </div>
                  </div>
                )}

                {certForm.useStandalone && (
                  <div style={{
                    marginTop: 12, padding: 10, background: 'rgba(234,179,8,0.08)',
                    borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--yellow)', lineHeight: 1.6,
                  }}>
                    HTTP 验证需要 80 端口空闲。如果 Nginx 正在监听 80 端口，会自动临时停止再恢复。
                    建议优先使用 DNS 验证方式。
                  </div>
                )}
                {certForm.dnsProvider && !certForm.useStandalone && (
                  <div style={{
                    marginTop: 12, padding: 10, background: 'var(--accent-dim)',
                    borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent)', lineHeight: 1.6,
                  }}>
                    DNS 验证无需开放端口，支持泛域名 (*.example.com)。填写 DNS 服务商 API 密钥后即可自动验证。
                    证书由 acme.sh 自动管理续签。
                  </div>
                )}
              </>
            )}

            <button className="btn btn-primary" onClick={handleGenerateCert}
              disabled={certLoading} style={{ marginTop: 16 }}>
              {certLoading ? (certForm.mode === 'acme' ? '申请中 (可能需要 1-2 分钟)...' : '生成中...') : '生成证书'}
            </button>
          </div>
        </div>
      )}

      {/* ===== 安全设置 ===== */}
      {tab === 'security' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>IP 访问控制</div>
            <div style={{ marginBottom: 12 }}>
              <select className="input" value={ipAction}
                onChange={e => setIpAction(e.target.value as any)}
                style={{ marginBottom: 8 }}>
                <option value="blacklist">添加到黑名单</option>
                <option value="whitelist">设置白名单</option>
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder={ipAction === 'blacklist' ? '1.2.3.4' : '1.2.3.4, 5.6.7.8'}
                  value={ipInput} onChange={e => setIpInput(e.target.value)} />
                <button className="btn btn-primary" onClick={handleIPAction}>执行</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
              黑名单: 阻止指定 IP 访问面板<br />
              白名单: 仅允许指定 IP 访问 (逗号分隔)<br />
              127.0.0.1 始终放行
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>安全策略</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>API 速率限制</span>
                <Badge type="active" label="120 次/分" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>登录防暴力</span>
                <Badge type="active" label="5 次 / 锁定 15 分钟" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>审计日志</span>
                <Badge type="active" label="已启用" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>JWT 过期</span>
                <Badge type="stopped" label="7 天" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
