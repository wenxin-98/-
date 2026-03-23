# 安全策略

## 报告漏洞

如果发现安全漏洞，请 **不要** 公开提 Issue。

请发送邮件到 security@example.com (替换为你的邮箱) 或通过 GitHub Private Vulnerability Reporting 功能报告。

我们会在 48 小时内确认收到并开始修复。

## 安全建议

- 立即修改默认密码 (`admin / admin123`)
- 生产环境使用 HTTPS (通过面板证书管理或 Cloudflare)
- 配置 IP 白名单限制面板访问
- 定期备份数据库 (面板 → 系统设置 → 备份)
- GOST API 端口 (18080) 不要暴露到公网
- 使用 SSH 密钥而非密码进行远程部署
