<div align="center">

# Unified Panel

**GOST + 3X-UI 统一转发管理面板**

一站式管理端口转发、加密隧道、代理协议，支持 27+ 种协议、动态 BBR 调参、多节点双引擎部署

[![CI](https://github.com/wenxin-98/-/actions/workflows/ci.yml/badge.svg)](https://github.com/wenxin-98/-/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-blue.svg)](Dockerfile)

[安装](#-快速安装) · [功能](#-功能特性) · [截图](#-界面预览) · [Docker](#-docker-部署) · [文档](#-api-文档) · [贡献](#-贡献)

</div>

---

## ✨ 功能特性

### 🔀 协议支持 (27+ 种)

| 引擎 | 协议 |
|------|------|
| **GOST 端口转发** | TCP / UDP / TCP 端口范围 / 反向 TCP / 反向 UDP |
| **GOST 加密隧道** | TLS / WSS / mWSS / mTLS / KCP / QUIC / SSH |
| **GOST 代理服务** | SOCKS5 / HTTP / Shadowsocks / Relay / SNI |
| **GOST 高级** | 负载均衡 / 限速 / 分流 / 准入控制 / DNS 解析 |
| **Xray 经典协议** | VLESS (Reality) / VMess / Trojan / SS-2022 / SOCKS / HTTP / Dokodemo-door |
| **Xray 新一代** | Hysteria2 / TUIC v5 / WireGuard |
| **传输层** | TCP / WebSocket / gRPC / HTTP/2 / HTTPUpgrade / SplitHTTP |

### ⚡ BBR 动态调参

- **系统内核 BBR**: 一键启用，三档策略 (保守/均衡/激进)
- **网络探测**: 实时 RTT、丢包、抖动、带宽监测
- **KCP 自适应**: 5 档 Profile 根据网络质量自动切换
- **Hysteria2/TUIC**: 带宽参数和拥塞控制器动态选择
- **远程推送**: SSH 批量在所有节点启用 BBR

### 🔗 订阅管理

- **分享链接**: VMess / VLESS / Trojan / SS / Hysteria2 / TUIC / WireGuard
- **通用订阅**: Base64 (V2rayN/Shadowrocket)
- **Clash 订阅**: Clash / ClashX / Stash YAML 格式

### 🖥 多节点

- 节点注册 + 心跳监控 (60s)
- SSH 远程一键部署 Agent
- 配置远程推送 + 同步
- 自动离线检测

### 🔒 安全

- JWT 认证 + 登录防暴力 (5 次/15 分钟锁定)
- API 速率限制 (120 次/分)
- IP 黑/白名单
- TLS 证书管理 (自签 + ACME)
- SSH 参数消毒 + 审计日志

### 📊 监控

- 流量统计 + recharts 图表
- WebSocket 实时推送
- 系统资源 (CPU/内存/磁盘) 监控
- 操作日志

---

## 🚀 快速安装

### 方式一: 一键脚本 (推荐)

```bash
bash <(curl -sL https://raw.githubusercontent.com/wenxin-98/-/main/scripts/install.sh)
```

支持选择安装组件:
1. 全套 (GOST + 3X-UI + 面板 + Nginx + BBR)
2. GOST + 面板
3. 3X-UI + 面板
4. 仅面板

### 方式二: Docker Compose

```bash
git clone https://github.com/wenxin-98/-.git
cd unified-panel
docker compose up -d
```

### 方式三: 手动安装

```bash
git clone https://github.com/wenxin-98/-.git
cd unified-panel

# 安装依赖
npm install
cd web && npm install && cd ..

# 构建
npm run build:all

# 配置
cp .env.example .env
# 编辑 .env

# 启动
node dist/index.js
# 或 PM2:
pm2 start dist/index.js --name unified-panel
```

安装完成后访问 `http://YOUR_IP:9527`，默认账号 `admin / admin123`。

---

## 🐳 Docker 部署

```yaml
# 最简单的方式
docker run -d \
  --name unified-panel \
  -p 9527:9527 \
  -v panel-data:/app/data \
  -e GOST_API=http://YOUR_GOST_IP:18080 \
  -e XUI_API=http://YOUR_XUI_IP:2053 \
  ghcr.io/wenxin-98/-:latest
```

完整栈 (面板 + GOST + 3X-UI + Nginx):

```bash
docker compose up -d
```

详见 [docker-compose.yml](docker-compose.yml)。

---

## 🛠 管理命令

安装脚本会创建 `up` 管理命令:

```bash
up status      # 查看所有服务状态
up start       # 启动
up stop        # 停止
up restart     # 重启
up logs        # 面板日志
up logs-gost   # GOST 日志
up bbr         # 查看 BBR 状态
up bbr enable  # 快速启用 BBR
up update      # 更新面板
up uninstall   # 卸载
```

---

## 📡 API 文档

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 登录 |
| GET | `/api/v1/auth/profile` | 当前用户 |

### GOST 管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/gost/forwards` | 转发列表 |
| POST | `/api/v1/gost/forwards` | 创建转发 (17 种类型) |
| DELETE | `/api/v1/gost/forwards/:id` | 删除 |
| PUT | `/api/v1/gost/forwards/:id/toggle` | 启停 |
| GET | `/api/v1/gost/chains` | 隧道链路列表 |
| POST | `/api/v1/gost/chains` | 创建多跳链路 |

### 3X-UI / Xray
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/xui/inbounds` | 入站列表 |
| POST | `/api/v1/xui/inbounds` | 创建入站 (9 种协议) |

### 订阅
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/sub/links` | 所有分享链接 |
| GET | `/api/v1/sub/base64?token=xxx` | Base64 订阅 |
| GET | `/api/v1/sub/clash?token=xxx` | Clash 订阅 |

### BBR
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/bbr/probe` | 网络探测结果 |
| POST | `/api/v1/bbr/system/enable` | 启用系统 BBR |
| POST | `/api/v1/bbr/tuner/start` | 启动自动调参 |
| POST | `/api/v1/bbr/recommend/:host` | 智能调参推荐 |
| POST | `/api/v1/bbr/remote/:nodeId` | 远程推送 BBR |

### 节点
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/nodes/:id/deploy` | SSH 远程部署 |
| POST | `/api/v1/nodes/:id/sync` | 同步配置 |

完整 API: 66 个端点，详见源码 `src/routes/`。

---

## 🏗 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js 20 + Express + TypeScript |
| 前端 | React 18 + Vite + Recharts + Zustand |
| 数据库 | SQLite + Drizzle ORM |
| 实时 | WebSocket (ws) |
| 转发引擎 | GOST v3 (REST API) |
| 代理引擎 | 3X-UI / Xray-core |
| 部署 | PM2 / Docker / systemd |

---

## 📁 项目结构

```
src/                      后端
├── routes/          (8)  API 路由
├── services/        (8)  GOST / XUI / BBR / 证书 / 部署 / 探测 / WS / 订阅
├── middleware/       (2)  JWT 认证 + 安全中间件
├── db/              (3)  SQLite schema + 初始化
└── utils/           (2)  日志 + Shell

web/src/                  前端
├── pages/           (8)  Dashboard / Forwards / Tunnels / Xui / Nodes / Bbr / Settings / Login
├── components/      (2)  Layout + UI 组件库
├── hooks/           (1)  WebSocket
└── services/        (2)  API 客户端 + 状态管理

scripts/             (1)  一键安装脚本
```

---

## 🤝 贡献

欢迎 PR！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```bash
# 开发
npm run dev          # 后端 :9527
npm run dev:web      # 前端 :3000

# 检查
npx tsc --noEmit && cd web && npx tsc --noEmit

# 构建
npm run build:all
```

---

## ⚠️ 免责声明

本项目仅供个人学习和合法用途。使用者必须遵守所在地区法律法规。作者不对因使用本项目导致的任何后果承担责任。

## 📄 License

[MIT](LICENSE)
