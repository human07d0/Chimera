# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# 只保留生产依赖
RUN npm ci --omit=dev

# ---- Production Stage ----
FROM node:22-alpine AS runner

WORKDIR /app

# 创建非 root 用户
RUN addgroup -S proxygroup && adduser -S proxyuser -G proxygroup

COPY --from=builder --chown=proxyuser:proxygroup /app/node_modules ./node_modules
COPY --from=builder --chown=proxyuser:proxygroup /app/dist ./dist
COPY --from=builder --chown=proxyuser:proxygroup /app/package.json ./

USER proxyuser

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
