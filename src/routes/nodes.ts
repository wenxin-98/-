// src/routes/nodes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { nodes, opLogs } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ENV } from '../config.js';
import { safeJsonParse } from '../utils/shell.js';

const router = Router();

const createNodeSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1),
  role: z.enum(['entry', 'relay', 'exit', 'standalone']).default('standalone'),
  gostApiPort: z.number().int().default(18080),
  xuiPort: z.number().int().default(2053),
});

/** GET /api/v1/nodes — 列出所有节点 */
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const allNodes = db.select().from(nodes).orderBy(desc(nodes.createdAt)).all();
    
    // 解析 systemInfo JSON
    const enriched = allNodes.map(n => ({
      ...n,
      systemInfo: n.systemInfo ? safeJsonParse(n.systemInfo) : null,
    }));

    res.json({ ok: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/nodes — 添加节点 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createNodeSchema.parse(req.body);
    const agentKey = nanoid(32);

    const inserted = db.insert(nodes).values({
      name: body.name,
      host: body.host,
      role: body.role,
      gostApiPort: body.gostApiPort,
      xuiPort: body.xuiPort,
      agentKey,
      status: 'offline',
    }).returning().get();

    db.insert(opLogs).values({
      action: 'create_node',
      target: `${body.name} (${body.host})`,
      userId: req.user!.userId,
      ip: req.ip,
    }).run();

    res.json({ ok: true, data: inserted });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ ok: false, msg: '参数校验失败', errors: err.errors });
    }
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** DELETE /api/v1/nodes/:id — 删除节点 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const node = db.select().from(nodes).where(eq(nodes.id, id)).get();
    if (!node) {
      return res.status(404).json({ ok: false, msg: '节点不存在' });
    }

    db.delete(nodes).where(eq(nodes.id, id)).run();
    res.json({ ok: true, msg: '已删除' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/nodes/:id/install-script — 获取节点安装脚本 (无需认证, 远程节点 curl 用) */
router.get('/:id/install-script', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const node = db.select().from(nodes).where(eq(nodes.id, id)).get();
    if (!node) {
      return res.status(404).json({ ok: false, msg: '节点不存在' });
    }

    // 动态生成安装脚本
    const script = generateAgentScript({
      panelHost: req.headers.host || `localhost:${ENV.PORT}`,
      agentKey: node.agentKey || '',
      nodeId: String(node.id),
      gostApiPort: node.gostApiPort || 18080,
      installXui: req.query.xui === 'true' || req.query.xui === '1',
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(script);
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/nodes/register — Agent 回调注册 (无需面板登录，用 agentKey 认证) */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, msg: '缺少 agentKey' });
    }

    const agentKey = authHeader.slice(7);
    const { nodeId, host, systemInfo, gostInstalled, xuiInstalled } = req.body;

    const node = db.select().from(nodes).where(eq(nodes.agentKey, agentKey)).get();
    if (!node) {
      return res.status(403).json({ ok: false, msg: 'agentKey 无效' });
    }

    db.update(nodes).set({
      host: host || node.host,
      gostInstalled: gostInstalled !== undefined ? !!gostInstalled : true,
      xuiInstalled: xuiInstalled !== undefined ? !!xuiInstalled : node.xuiInstalled,
      status: 'online',
      lastHeartbeat: new Date().toISOString(),
      systemInfo: systemInfo ? JSON.stringify(systemInfo) : node.systemInfo,
      updatedAt: new Date().toISOString(),
    }).where(eq(nodes.id, node.id)).run();

    res.json({ ok: true, msg: '注册成功' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/nodes/heartbeat — Agent 心跳 */
router.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false });
    }

    const agentKey = authHeader.slice(7);
    const { systemInfo } = req.body;

    const node = db.select().from(nodes).where(eq(nodes.agentKey, agentKey)).get();
    if (!node) {
      return res.status(403).json({ ok: false });
    }

    db.update(nodes).set({
      status: 'online',
      lastHeartbeat: new Date().toISOString(),
      systemInfo: systemInfo ? JSON.stringify(systemInfo) : node.systemInfo,
    }).where(eq(nodes.id, node.id)).run();

    // 返回该节点需要执行的配置 (如果有)
    res.json({ ok: true, config: null });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ============================
// ===== P6: 远程部署 =====
// ============================

/** POST /api/v1/nodes/:id/deploy — SSH 远程部署 Agent */
router.post('/:id/deploy', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const node = db.select().from(nodes).where(eq(nodes.id, id)).get();
    if (!node) return res.status(404).json({ ok: false, msg: '节点不存在' });

    const { sshPassword, sshKeyPath, sshPort, sshUser, installXui } = req.body;

    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    const result = await nodeDeployService.deployViaSSH({
      nodeId: id,
      sshHost: node.host,
      sshPort: sshPort || 22,
      sshUser: sshUser || 'root',
      sshPassword,
      sshKeyPath,
      installGost: true,
      installXui: !!installXui,
    });

    res.json({ ok: result.ok, data: { log: result.log } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/nodes/:id/sync — 同步配置到节点 */
router.post('/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    const result = await nodeDeployService.syncNodeRules(id);
    res.json({ ok: result.ok, data: { synced: result.synced, errors: result.errors } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/nodes/:id/remote-config — 获取远程节点 GOST 配置 */
router.get('/:id/remote-config', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    const config = await nodeDeployService.getRemoteConfig(id);
    res.json({ ok: true, data: config });
  } catch (err: any) {
    res.status(502).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/nodes/:id/clear-config — 清空远程节点配置 */
router.post('/:id/clear-config', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { nodeDeployService } = await import('../services/nodeDeployService.js');
    await nodeDeployService.clearRemoteConfig(id);
    res.json({ ok: true, msg: '远程配置已清空' });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ===== 安装脚本生成 =====

function generateAgentScript(opts: {
  panelHost: string;
  agentKey: string;
  nodeId: string;
  gostApiPort: number;
  installXui?: boolean;
}): string {
  return `#!/bin/bash
# ============================================
# 统一面板 Agent 安装脚本
# 由面板自动生成 — 请勿手动修改参数
# ============================================

set -e

PANEL_HOST="${opts.panelHost}"
AGENT_KEY="${opts.agentKey}"
NODE_ID="${opts.nodeId}"
GOST_API_PORT="${opts.gostApiPort}"
INSTALL_XUI="${opts.installXui ? 'true' : 'false'}"

RED='\\033[0;31m'
GREEN='\\033[0;32m'
NC='\\033[0m'

info()  { echo -e "\${GREEN}[INFO]\${NC} $1"; }
error() { echo -e "\${RED}[ERROR]\${NC} $1"; exit 1; }

[[ $(id -u) -ne 0 ]] && error "请以 root 权限运行"

# 检测架构
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) error "不支持的架构: $ARCH" ;;
esac

# 安装 GOST v3
info "安装 GOST v3..."
GOST_VER="3.0.0"
GOST_URL="https://github.com/go-gost/gost/releases/download/v\${GOST_VER}/gost_\${GOST_VER}_linux_\${ARCH}.tar.gz"

# 尝试直连 GitHub (10 秒超时)
GOST_OK=false
if wget -q --timeout=10 -O /tmp/gost.tar.gz "\${GOST_URL}" 2>/dev/null || \\
   curl -sfL --connect-timeout 10 --max-time 60 "\${GOST_URL}" -o /tmp/gost.tar.gz 2>/dev/null; then
    GOST_OK=true
fi

# 回退: 国内镜像代理
if [ "\${GOST_OK}" != "true" ]; then
    info "GitHub 不可达，尝试镜像..."
    for PROXY in "https://ghp.ci/" "https://gh-proxy.com/" "https://mirror.ghproxy.com/" "https://gh.api.99988866.xyz/"; do
        info "  尝试 \${PROXY}..."
        if wget -q --timeout=15 -O /tmp/gost.tar.gz "\${PROXY}\${GOST_URL}" 2>/dev/null || \\
           curl -sfL --connect-timeout 10 --max-time 120 "\${PROXY}\${GOST_URL}" -o /tmp/gost.tar.gz 2>/dev/null; then
            info "通过镜像下载成功"
            GOST_OK=true
            break
        fi
    done
fi

[ ! -f /tmp/gost.tar.gz ] && error "GOST 下载失败，请手动安装"
tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/ gost 2>/dev/null || \\
  tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/
chmod +x /usr/local/bin/gost
rm -f /tmp/gost.tar.gz
info "GOST 安装完成: $(/usr/local/bin/gost -V 2>&1 | head -1)"

# GOST 配置
mkdir -p /etc/unified-panel-agent
cat > /etc/unified-panel-agent/gost.yaml <<EOF
api:
  addr: ":\${GOST_API_PORT}"
  accesslog: true
services: []
chains: []
EOF

# systemd 服务
cat > /etc/systemd/system/gost.service <<EOF
[Unit]
Description=GOST Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/gost -C /etc/unified-panel-agent/gost.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gost
systemctl start gost
info "GOST 服务已启动"

# 安装 3X-UI (如果面板指定)
if [ "\${INSTALL_XUI}" = "true" ]; then
  info "安装 3X-UI..."
  XUI_SCRIPT="https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh"
  # 尝试镜像
  if ! curl -sf --connect-timeout 5 -o /tmp/3xui.sh "\${XUI_SCRIPT}" 2>/dev/null; then
    for PROXY in "https://ghp.ci/" "https://gh-proxy.com/"; do
      if curl -sf -o /tmp/3xui.sh "\${PROXY}\${XUI_SCRIPT}" 2>/dev/null; then break; fi
    done
  fi
  if [ -f /tmp/3xui.sh ]; then
    echo "y" | bash /tmp/3xui.sh 2>&1 | tail -5
    rm -f /tmp/3xui.sh
    info "3X-UI 安装完成"
  else
    error "3X-UI 安装失败，请手动安装"
  fi
fi

# 心跳 cron
cat > /etc/unified-panel-agent/heartbeat.sh <<'HEOF'
#!/bin/bash
XUI_RUNNING=$(systemctl is-active x-ui >/dev/null 2>&1 && echo true || echo false)
curl -sf -X POST "http://\${PANEL_HOST}/api/v1/nodes/heartbeat" \\
  -H "Authorization: Bearer \${AGENT_KEY}" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"systemInfo\\": {
      \\"cpu\\": \\"$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')\\",
      \\"mem\\": \\"$(free -m | awk 'NR==2{printf \\"%d/%d\\", $3, $2}')\\",
      \\"disk\\": \\"$(df -h / | awk 'NR==2{printf \\"%s/%s\\", $3, $2}')\\",
      \\"gostRunning\\": $(systemctl is-active gost >/dev/null 2>&1 && echo true || echo false),
      \\"xuiRunning\\": \$XUI_RUNNING
    }
  }" > /dev/null 2>&1
HEOF
chmod +x /etc/unified-panel-agent/heartbeat.sh

# 每分钟心跳
(crontab -l 2>/dev/null; echo "* * * * * PANEL_HOST=\${PANEL_HOST} AGENT_KEY=\${AGENT_KEY} /etc/unified-panel-agent/heartbeat.sh") | crontab -

# 向面板注册
info "向面板注册..."
PUBLIC_IP=$(curl -sf --connect-timeout 3 ip.sb || curl -sf --connect-timeout 3 ifconfig.me || curl -sf --connect-timeout 3 icanhazip.com || echo "unknown")
PUBLIC_IPV6=$(curl -6sf --connect-timeout 3 ip.sb 2>/dev/null || echo "")
# IPv6 地址包含冒号，JSON 直接用字符串
curl -sf -X POST "http://\${PANEL_HOST}/api/v1/nodes/register" \\
  -H "Authorization: Bearer \${AGENT_KEY}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"nodeId\\": \\"\${NODE_ID}\\", \\"host\\": \\"\${PUBLIC_IP}\\", \\"ipv6\\": \\"\${PUBLIC_IPV6}\\", \\"gostInstalled\\": true, \\"xuiInstalled\\": \${INSTALL_XUI}}"

info "========================================="
info "Agent 安装完成！"
info "  节点 ID:    \${NODE_ID}"
info "  GOST API:   :\${GOST_API_PORT}"
info "  3X-UI:      \${INSTALL_XUI}"
info "  公网 IPv4:  \${PUBLIC_IP}"
info "  公网 IPv6:  \${PUBLIC_IPV6:-无}"
info "========================================="
`;
}

export default router;
