# MiMo Proxy 开发指南

> 架构与模块说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)，编码规范与约定见 [AGENTS.md](./AGENTS.md)。

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入 MIMO_API_KEY
pnpm run dev           # http://localhost:3000
```

## 常用命令

| 命令 | 用途 |
|------|------|
| `pnpm run dev` | 开发服务器（nodemon + ts-node） |
| `pnpm run typecheck` | 仅类型检查 |
| `pnpm test` | 运行全部测试 |
| `pnpm run test:watch` | 测试监视模式 |
| `pnpm run build` | 生产构建（tsc + vite） |
| `pnpm run bun:build` | Bun 单文件构建 → `dist-bun/` |

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `MIMO_API_KEY` | 是 | MiMo API 密钥 |
| `PROXY_API_KEY` | 否 | 代理鉴权密钥 |
| `LOG_LEVEL` | 否 | `debug` / `info` / `warn` / `error`，默认 `info` |
| `MONITOR_STORAGE` | 否 | `memory` 或 `sqlite`，默认 `memory` |
| `MONITOR_SQLITE_PATH` | 否 | SQLite 文件路径，默认 `./data/monitor.db` |
| `OPS_PASSWORD` | 否 | 运维界面密码 |
| `DEBUG_ENABLED` | 否 | 启用调试模式，默认 `false` |
| `DEBUG_MAX_RECORDS` | 否 | 最大调试记录数，默认 `500` |
| `DEBUG_MAX_BODY_SIZE` | 否 | JSON body 字符串最大字节，默认 `1048576` |
| `DEBUG_MAX_MEDIA_BYTES` | 否 | 单个媒体缓存最大字节，默认 `10485760` |

## 多模态数据注意事项

MiMo Proxy 作为透传代理，多模态数据（图片、音频等）在主要数据通路上原样透传。开发和测试时需注意以下事项。

### Body Size 限制

`express.json({ limit: "10mb" })` 限制了请求体大小。base64 编码的图片约为原图的 1.33 倍，因此：

| 原图大小 | base64 大小 | 是否可传输 |
|:---------|:-----------|:----------|
| < 5 MB | < ~6.7 MB | 安全 |
| 5-7 MB | ~6.7-9.3 MB | 接近限制 |
| > 7.5 MB | > 10 MB | 被拒绝 |

如需支持更大图片，可修改 `src/server.ts` 中的 `express.json({ limit })` 值，但需同步评估上游 API 的限制。

### 多模态请求的测试要点

1. **OpenAI 格式**：验证 `messages[].content` 中包含 `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }` 的请求能正确透传
2. **Anthropic 格式**：验证 `messages[].content` 中包含 `{ type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }` 的请求能正确透传
3. **Token-Plan 透传**：验证多模态请求通过 `/token-plan/v1/chat/completions` 和 `/token-plan/anthropic/v1/messages` 路径时数据完整
4. **Debug 记录**：验证 `DEBUG_ENABLED=true` 时，多模态请求的 debug 记录中请求体被正确捕获（注意截断行为）
5. **Monitor 统计**：验证多模态请求的 token 用量和延迟统计与纯文本请求一致

### 已知限制

- **Debug 流式组装**：`assembleStreamResponse()` 支持 `text`、`thinking`、`tool_use`、`image` 四种 content block 类型。
- **无 multipart 支持**：不支持 `multipart/form-data` 格式的请求，图片必须嵌入 JSON body。
- **无图片 URL 代理**：上游返回的图片 URL 不会被代理，客户端需能直接访问。

### 未来增强方向

- 增加多模态内容的基础校验（图片格式、URL 合法性）
- Monitor 增加多模态请求标记（`has_multimodal` 字段）
- 可选：图片 URL 代理/重写能力

## 构建与部署

```bash
pnpm run build        # → dist/
pnpm run bun:build    # → dist-bun/index.js（单文件可执行）
```

跨平台安装脚本：`scripts/install-windows.bat`、`scripts/install-linux.sh`，Android 参见 `ANDROID_INSTALL.md`。

## 故障排除

**依赖损坏**：`rm -rf node_modules pnpm-lock.yaml && pnpm install`

**SQLite 异常**：临时切换 `MONITOR_STORAGE=memory`

**端口占用**：`netstat -ano | findstr :3000`（Windows）/ `lsof -i :3000`（Linux）

**调试**：`LOG_LEVEL=debug pnpm start` 或 `node --inspect dist/index.js`

