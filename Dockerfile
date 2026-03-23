## ============================================
##  统一转发管理面板 — Docker 镜像
##  多阶段构建: 编译 → 精简运行时
## ============================================

# ===== Stage 1: Build =====
FROM node:20-alpine3.19 AS builder

WORKDIR /build
COPY package.json tsconfig.json tsup.config.ts ./
COPY web/package.json web/tsconfig.json web/vite.config.ts ./web/

# 安装全部依赖 (含 devDependencies)
RUN npm install && cd web && npm install && cd ..

# 拷入源码
COPY src/ ./src/
COPY web/src/ ./web/src/
COPY web/index.html ./web/

# 编译后端
RUN npx tsup src/index.ts --format esm --target node20 --clean

# 编译前端
RUN cd web && npx vite build

# ===== Stage 2: Runtime =====
FROM node:20-alpine3.19

LABEL maintainer="unified-panel"
LABEL description="GOST + 3X-UI Unified Management Panel"

# 系统依赖
RUN apk add --no-cache curl wget openssl sqlite bash iputils

WORKDIR /app

# 只拷运行时所需
COPY --from=builder /build/dist/ ./dist/
COPY --from=builder /build/dist-web/ ./dist-web/
COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules/ ./node_modules/
COPY scripts/ ./scripts/
COPY .env.example ./.env.example
COPY ecosystem.config.cjs ./

# 数据目录
RUN mkdir -p /app/data /app/logs

# 如果没有 .env 则从模板生成
RUN cp -n .env.example .env 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=9527
ENV DB_PATH=/app/data/panel.db

EXPOSE 9527

VOLUME ["/app/data", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:9527/api/health || exit 1

CMD ["node", "dist/index.js"]
