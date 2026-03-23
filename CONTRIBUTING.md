# 贡献指南

感谢你对本项目的关注！欢迎提交 Issue 和 Pull Request。

## 开发环境

```bash
# 克隆仓库
git clone https://github.com/YOUR_USER/unified-panel.git
cd unified-panel

# 安装依赖
npm install
cd web && npm install && cd ..

# 启动开发模式
npm run dev          # 后端 :9527 (热重载)
npm run dev:web      # 前端 :3000 (Vite HMR, API 代理到 9527)
```

需要 GOST v3 和 3X-UI 在本地运行才能测试全部功能。如果没有，面板会降级运行（显示离线状态）。

## 项目结构

```
src/              后端 (Express + TypeScript)
├── routes/       API 路由
├── services/     业务逻辑 (GOST/XUI/BBR/证书/部署)
├── middleware/    认证 + 安全中间件
├── db/           SQLite + Drizzle ORM
└── utils/        工具函数

web/src/          前端 (React + Vite)
├── pages/        页面组件 (懒加载)
├── components/   通用 UI 组件
├── hooks/        React Hooks
├── services/     API 客户端 + 状态管理
└── styles/       全局样式

scripts/          安装/管理脚本
```

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: 新功能
fix: 修复 bug
docs: 文档
refactor: 重构
style: 代码风格
perf: 性能优化
test: 测试
chore: 构建/工具
```

示例:
```
feat: 添加 Hysteria2 协议支持
fix: 修复 KCP 隧道端口解析 bug
docs: 补充 Docker 部署说明
```

## Pull Request 流程

1. Fork 仓库
2. 创建分支: `git checkout -b feat/my-feature`
3. 确保 TypeScript 编译通过: `npx tsc --noEmit && cd web && npx tsc --noEmit`
4. 确保构建通过: `npm run build:all`
5. 提交 + Push + 创建 PR

## Issue 模板

提 Bug 请附带:
- 操作系统 + 内核版本
- Node.js 版本
- GOST / 3X-UI 版本
- 复现步骤
- 错误日志 (`pm2 logs unified-panel --lines 50`)

## 协议

MIT License
