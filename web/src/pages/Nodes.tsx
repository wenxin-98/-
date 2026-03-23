// src/pages/Nodes.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Badge, StatusDot, Modal, Confirm, Loading, Empty, Code } from '../components/ui';
import toast from 'react-hot-toast';

function AddNodeModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: '', host: '', role: 'standalone', gostApiPort: '18080' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', host: '', role: 'standalone', gostApiPort: '18080' });
  }, [open]);

  const handleSubmit = async () => {
    if (!form.name || !form.host) return toast.error('请填写名称和地址');
    setSubmitting(true);
    try {
      await api.createNode({
        name: form.name,
        host: form.host,
        role: form.role,
        gostApiPort: parseInt(form.gostApiPort),
      });
      toast.success('节点已添加');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="添加节点" subtitle="注册远程节点" open={open} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '添加中...' : '添加'}
          </button>
        </>
      }>
      <div className="form-grid">
        <div className="form-group">
          <label className="label">节点名称</label>
          <input className="input" placeholder="HK-BGP-01" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">IP 地址</label>
          <input className="input" placeholder="154.12.88.3" value={form.host}
            onChange={e => setForm({ ...form, host: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="label">角色</label>
          <select className="input" value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="entry">入口</option>
            <option value="relay">中继</option>
            <option value="exit">落地</option>
            <option value="standalone">独立</option>
          </select>
        </div>
        <div className="form-group">
          <label className="label">GOST API 端口</label>
          <input className="input" type="number" value={form.gostApiPort}
            onChange={e => setForm({ ...form, gostApiPort: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

function InstallScriptModal({ open, onClose, nodeId }: {
  open: boolean; onClose: () => void; nodeId: number | null;
}) {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && nodeId) {
      setLoading(true);
      api.getNodeInstallScript(nodeId).then(res => {
        setScript(typeof res === 'string' ? res : res.data || '加载失败');
      }).catch(() => setScript('加载失败')).finally(() => setLoading(false));
    }
  }, [open, nodeId]);

  return (
    <Modal title="节点安装脚本" subtitle="在远程节点上运行此命令" open={open} onClose={onClose}>
      {loading ? <Loading /> : (
        <div>
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-dim)' }}>
            SSH 登录目标节点后，执行以下一键安装命令:
          </div>
          <Code>{`curl -sL http://${window.location.hostname}:9527/api/v1/nodes/${nodeId}/install-script | bash`}</Code>
          <div style={{
            marginTop: 16, padding: 12, background: 'rgba(234,179,8,0.08)',
            borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--yellow)',
          }}>
            脚本会自动安装 GOST v3、配置 Agent 心跳、注册到面板。
          </div>
        </div>
      )}
    </Modal>
  );
}

// P6: SSH 远程部署弹窗
function DeployModal({ open, onClose, node, onDeployed }: {
  open: boolean; onClose: () => void; node: any; onDeployed: () => void;
}) {
  const [form, setForm] = useState({ sshUser: 'root', sshPort: '22', sshPassword: '', sshKeyPath: '', installXui: false });
  const [deploying, setDeploying] = useState(false);
  const [log, setLog] = useState('');

  useEffect(() => {
    if (open) { setLog(''); setForm({ sshUser: 'root', sshPort: '22', sshPassword: '', sshKeyPath: '', installXui: false }); }
  }, [open]);

  const handleDeploy = async () => {
    if (!form.sshPassword && !form.sshKeyPath) return toast.error('请填写 SSH 密码或密钥路径');
    setDeploying(true);
    setLog('部署中，请稍候...\n');
    try {
      const res = await api.deployNode(node.id, {
        sshUser: form.sshUser,
        sshPort: parseInt(form.sshPort),
        sshPassword: form.sshPassword || undefined,
        sshKeyPath: form.sshKeyPath || undefined,
        installXui: form.installXui,
      });
      setLog(res.data?.log || (res.ok ? '部署完成' : '部署失败'));
      if (res.ok) { toast.success('部署完成'); onDeployed(); }
      else toast.error('部署失败，查看日志');
    } catch (err: any) {
      setLog(prev => prev + `\n错误: ${err.message}`);
      toast.error(err.message);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Modal title="SSH 远程部署" subtitle={node ? `${node.name} (${node.host})` : ''} open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="label">SSH 用户</label>
            <input className="input" value={form.sshUser} onChange={e => setForm({ ...form, sshUser: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="label">SSH 端口</label>
            <input className="input" type="number" value={form.sshPort} onChange={e => setForm({ ...form, sshPort: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="label">SSH 密码</label>
            <input className="input" type="password" placeholder="二选一" value={form.sshPassword} onChange={e => setForm({ ...form, sshPassword: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="label">SSH 密钥路径</label>
            <input className="input" placeholder="/root/.ssh/id_rsa" value={form.sshKeyPath} onChange={e => setForm({ ...form, sshKeyPath: e.target.value })} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.installXui} onChange={e => setForm({ ...form, installXui: e.target.checked })} />
          同时安装 3X-UI
        </label>
        <button className="btn btn-primary" onClick={handleDeploy} disabled={deploying}
          style={{ width: '100%', justifyContent: 'center' }}>
          {deploying ? '部署中...' : '开始部署'}
        </button>
        {log && (
          <pre style={{
            background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 14,
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)',
            maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{log}</pre>
        )}
      </div>
    </Modal>
  );
}

// P6: 远程配置查看弹窗
function RemoteConfigModal({ open, onClose, node }: {
  open: boolean; onClose: () => void; node: any;
}) {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (open && node) {
      setLoading(true);
      api.getNodeRemoteConfig(node.id)
        .then(res => { if (res.ok) setConfig(res.data); })
        .catch(() => setConfig(null))
        .finally(() => setLoading(false));
    }
  }, [open, node]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncNodeConfig(node.id);
      if (res.ok) toast.success(`已同步 ${res.data.synced} 条规则`);
      else toast.error(`同步失败: ${res.data?.errors?.join(', ')}`);
    } catch (err: any) { toast.error(err.message); }
    setSyncing(false);
  };

  const handleClear = async () => {
    if (!confirm('确认清空远程节点的所有 GOST 配置？')) return;
    try {
      const res = await api.clearNodeConfig(node.id);
      if (res.ok) { toast.success('已清空'); setConfig({ services: [], chains: [] }); }
      else toast.error(res.msg);
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <Modal title="远程节点配置" subtitle={node ? `${node.name} (${node.host})` : ''} open={open} onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger btn-sm" onClick={handleClear}>清空远程配置</button>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? '同步中...' : '同步本地规则 →'}
          </button>
        </>
      }>
      {loading ? <Loading /> : !config ? (
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>
          无法连接到节点 GOST API
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Badge type="active" label={`${config.services?.length || 0} 个服务`} />
            <Badge type="stopped" label={`${config.chains?.length || 0} 个链路`} />
          </div>
          <pre style={{
            background: 'var(--bg)', borderRadius: 'var(--radius)', padding: 14,
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
            maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}>{JSON.stringify(config, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}

export function NodesPage() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [scriptNodeId, setScriptNodeId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deployNode, setDeployNode] = useState<any>(null);
  const [configNode, setConfigNode] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listNodes();
      if (res.ok) setNodes(res.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async () => {
    if (deleteId === null) return;
    try {
      await api.deleteNode(deleteId);
      toast.success('已删除');
      load();
    } catch (err: any) { toast.error(err.message); }
    setDeleteId(null);
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">节点管理</h2>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 添加节点</button>
      </div>

      {loading ? <Loading /> : nodes.length === 0 ? (
        <div className="card"><Empty text="暂无节点" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {nodes.map(node => (
            <div className="card" key={node.id}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{node.name}</div>
                  <code style={{
                    fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
                  }}>{node.host}</code>
                </div>
                <Badge type={node.role} />
              </div>

              {/* Service badges */}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <span style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                  background: node.gost_installed ? 'var(--green-dim)' : 'var(--red-dim)',
                  color: node.gost_installed ? 'var(--green)' : 'var(--red)',
                }}>GOST {node.gost_installed ? '✓' : '✗'}</span>
                <span style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                  background: node.xui_installed ? 'var(--green-dim)' : 'var(--red-dim)',
                  color: node.xui_installed ? 'var(--green)' : 'var(--red)',
                }}>3X-UI {node.xui_installed ? '✓' : '✗'}</span>
              </div>

              {/* System info */}
              {node.systemInfo && (
                <div style={{
                  marginTop: 12, padding: 10, background: 'var(--bg)',
                  borderRadius: 'var(--radius-sm)', fontSize: 12,
                  fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
                  display: 'flex', gap: 16, flexWrap: 'wrap',
                }}>
                  {node.systemInfo.latencyMs !== undefined && (
                    <span style={{ color: node.systemInfo.latencyMs < 100 ? 'var(--green)' : node.systemInfo.latencyMs < 300 ? 'var(--yellow)' : 'var(--red)' }}>
                      延迟: {node.systemInfo.latencyMs}ms
                    </span>
                  )}
                  {node.systemInfo.gostServices !== undefined && <span>GOST: {node.systemInfo.gostServices} 服务</span>}
                  {node.systemInfo.cpu && <span>CPU: {node.systemInfo.cpu}%</span>}
                  {node.systemInfo.mem && <span>MEM: {node.systemInfo.mem}</span>}
                  {node.systemInfo.disk && <span>DISK: {node.systemInfo.disk}</span>}
                </div>
              )}

              {/* Footer */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(30,41,59,0.3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot status={node.status} />
                  {node.last_heartbeat && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {node.last_heartbeat}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setDeployNode(node)}>SSH 部署</button>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setConfigNode(node)}>远程配置</button>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setScriptNodeId(node.id)}>安装命令</button>
                  <button className="btn btn-danger btn-sm"
                    onClick={() => setDeleteId(node.id)}>删除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddNodeModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={load} />
      <InstallScriptModal open={scriptNodeId !== null}
        onClose={() => setScriptNodeId(null)} nodeId={scriptNodeId} />
      <DeployModal open={!!deployNode} onClose={() => setDeployNode(null)}
        node={deployNode} onDeployed={load} />
      <RemoteConfigModal open={!!configNode} onClose={() => setConfigNode(null)}
        node={configNode} />
      <Confirm open={deleteId !== null} msg="确认删除此节点？"
        onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
    </div>
  );
}
