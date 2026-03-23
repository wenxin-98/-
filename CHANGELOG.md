# Changelog

## v1.9.0 (2026-03-23)

### 性能优化
- HTTP Keep-Alive 连接池 (GOST/XUI API 延迟 -30~50ms)
- 静态资源缓存头 (immutable, 7d)
- GOST 隧道 keepalive + sniffing + mux 优化
- KCP/QUIC 低延迟默认参数
- Xray TCP Fast Open + sockopt
- CORS 生产环境同域限制
- JWT 24h + GOST API 127.0.0.1 + TLS 1.2+ + 日志脱敏
- 进程优雅关闭

## v1.8.0 — 流量监控 + 延迟测试
## v1.7.0 — 诊断系统 + 加密修复
## v1.6.0 — IPv6 / 禁ping / NAT 兼容
## v1.5.0 — 单客户端订阅 + 负载均衡 + IP检测
## v1.4.0 — 多节点双引擎 + 全局打磨
## v1.3.0 — HTTPUpgrade + QR + TLS指纹 + GOST高级组件
## v1.2.0 — 客户端管理 + 入站编辑/启停
## v1.1.0 — 多用户 + Telegram + 密钥 + 导入导出
## v1.0.0 — GOST 17种 + Xray 9种 + BBR + 节点部署 + 证书
