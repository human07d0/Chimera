# Mimo Proxy 架构

OpenAI-compatible facade for Xiaomi MiMo：协议转换、SSE 透传、虚拟模型预设、内置监控（支持内存态/SQLite 持久化）、可选调试模式（完整 payload 内存记录）、token-plan 透传代理（挂载于主应用 `/token-plan` 路径下）。

## 技术栈

- **Runtime**: Node.js 24 LTS / Bun 1.x
- **Language**: TypeScript 5
- **HTTP**: Express 5 + CORS
- **Config**: dotenv
- **Storage**: memory / SQLite（`sql.js`）
- **Dev/Build**: ts-node、nodemon、tsc、pnpm 10、Bun

## 架构图

```mermaid
flowchart TD
    IDX["index.ts<br/>bootstrap + config"] --> SRV["server.ts<br/>middleware + routing"]

    SRV --> HEALTH["/health"]
    SRV --> MON["/monitor (PWA)"]
    SRV --> DBG["/debug (PWA)"]
    SRV --> OPS["/ops (PWA)"]
    SRV --> API["/v1 (auth)"]
    SRV --> TP["/token-plan (auth)"]

    API --> MODELS["/v1/models<br/>virtual models"]
    API --> CHAT["/v1/chat/completions<br/>streaming proxy"]

    CHAT --> REQ["OpenAI -> MiMo transform"]
    CHAT --> STRM["SSE passthrough"]
    CHAT --> RESP["MiMo -> OpenAI transform"]

    TP --> TP_CHAT["/token-plan/v1/chat/completions<br/>passthrough"]
    TP --> TP_MSG["/token-plan/anthropic/v1/messages<br/>passthrough"]

    API -. telemetry .-> MM["monitor middleware"]
    TP -. telemetry .-> MM
    MM --> STORE["monitor storage adapter"]
    STORE --> MEM[("memory")]
    STORE --> SQL[("sqlite")]

    API -. debug .-> DM["debug middleware"]
    TP -. debug .-> DM
    DM --> DSTORE["DebugStore (ring buffer)"]
    DSTORE --> DMEM[("memory only")]
```

## 模块

```text
src/
├── index.ts
├── server.ts
├── config.ts
├── shutdownManager.ts
├── routes/                # /v1
├── proxy/                 # transform + streaming
├── token-plan/
│   └── server.ts          # createTokenPlanRouter() — 透传路由器
├── monitor/
│   ├── middleware.ts
│   ├── routes.ts
│   └── storage/           # interface + memory + sqlite + async writer
├── debug/
│   ├── index.ts
│   ├── types.ts
│   ├── store.ts           # DebugStore (ring buffer)
│   ├── middleware.ts
│   ├── routes.ts
│   └── frontend/index.html
├── models/                # presets
├── ops/                   # 运维界面
└── utils/logger.ts
```

## Token-Plan 透传代理

Token-plan 是小米的计费方案，使用不同的上游地址。通过 `createTokenPlanRouter()` 返回 `express.Router`，在主应用中以 `/token-plan` 前缀挂载，复用主应用的 CORS、JSON 解析、请求日志等基础中间件。

### 路由

| 路径 | 方法 | 说明 |
|------|------|------|
| `/token-plan/v1/chat/completions` | POST | OpenAI 格式透传 |
| `/token-plan/anthropic/v1/messages` | POST | Anthropic 格式透传 |

### 中间件链

1. 主应用 CORS（含 `anthropic-version`、`anthropic-beta` 头）
2. 主应用 `express.json()`
3. 主应用请求日志
4. Token-plan 鉴权中间件（`TOKEN_PLAN_PROXY_API_KEY`）
5. Debug 中间件（`DEBUG_ENABLED=true` 时）
6. 路由处理 -> 上游透传

### 设计优势

- 单端口、单进程，无需管理独立 HTTP server
- Debug 中间件自动覆盖 token-plan 请求，无需重复配置
- 优雅关闭只需关闭主 HTTP server

## 存储抽象与字段模型

`MonitorStorage` 统一接口：

- `append(event)`
- `query(params)`
- `stats(params)`
- `prune(retentionDays)`
- `close()`

### Request-level 事件模型（默认不持久化 payload）

- `request_id`
- `ts_start` / `ts_end` / `latency_ms`
- `path` / `method` / `status_code`
- `model_requested` / `model_upstream`
- `stream` / `chunks` / `bytes_out` / `first_token_ms`
- `input_tokens` / `output_tokens` / `cached_prompt_tokens` / `cost`
- `error_type`

## Monitor 数据流

1. `monitorMiddleware` 仅采集元信息并调用 `storageWorker.append(event)`。
2. `storageWorker` 维护异步队列：
   - 达到 `MONITOR_FLUSH_BATCH_SIZE` 立即 flush
   - 每 `MONITOR_FLUSH_INTERVAL_MS` 定时 flush
   - 写入失败最多重试 3 次，失败项按 FIFO 语义回到队尾（避免顺序反转）
3. `MonitorStorage` 实现：
   - `memory`：进程内存（重启丢失）
   - `sqlite`：`sql.js` 纯 JavaScript 实现（WAL / NORMAL / busy_timeout=5000）
4. `getStorage()` 启动阶段优先初始化 sqlite，失败时自动降级 `memory` 并记录错误日志。
5. `/monitor/stats`、`/monitor/calls` 统一走 `storage.stats/query`。
6. 退出时由主进程调用 `stopCleanupTask()` 与 `await storageWorker.shutdown()`，完成队列 flush 后 `close()`。

## SQLite 设计要点

- 自动创建数据库目录（默认 `./data/monitor.db`）
- `requests` 表存 request-level 核心字段
- 插入策略：`ON CONFLICT(request_id) DO NOTHING`（重复请求幂等）
- 索引：
  - `requests(ts_start)`
  - `requests(status_code, ts_start)`
  - `requests(model_requested, ts_start)`

## Debug 模块

可选的调试模块（`DEBUG_ENABLED=true`），记录完整的请求/响应体到内存环形缓冲区。同时覆盖主应用 API 路由和 token-plan 透传路由。

### DebugStore

- 纯内存环形缓冲区，同步读写，无持久化，进程重启即清空
- `append(event)` -- 写入，超限时淘汰最旧记录
- `query(params)` -- 内存中过滤和搜索
- `getById(id)` -- 按 request_id 查找
- `prune()` -- 清空缓冲区

### debugMiddleware

- monkey-patch `res.json` 捕获非流式响应体
- monkey-patch `res.write` 收集流式 SSE chunks
- monkey-patch `res.end` 组装并存储调试事件
- 在 monitor middleware 之前挂载，确保捕获原始响应
- 在主应用 `/v1`、`/anthropic/v1` 和 token-plan `/v1`、`/anthropic/v1` 上均挂载

### 数据流

1. `debugMiddleware` 拦截 `/chat/completions` 和 `/messages` 请求
2. 序列化 `req.body` 为请求体快照
3. 通过 monkey-patch 收集完整响应体（非流式 via `res.json`，流式 via `res.write`）
4. `res.end` 时组装 `DebugEvent` 并写入 `DebugStore`
5. `/debug/calls` API 返回列表（含 preview），`/debug/calls/:id` 返回完整 body

## 设计约束

- **Streaming-first**: no full-buffer in chat path.
- **Model preset**: `mimo-{preset}-{modelId}` -> `upstreamModel + features`.
- **Non-intrusive telemetry**: read-only middleware + async/non-blocking write.
- **Configurable state backend**: `memory` (ephemeral) / `sqlite` (persistent).
- **Privacy-by-default**: no prompt/response raw payload persistence (monitor).
- **Debug opt-in**: full payload recording only when `DEBUG_ENABLED=true`, memory-only.
- **Path safety**: frontend/redirect all relative paths (`./...`).
- **Single-port architecture**: token-plan 作为 router 挂载于主应用，消除独立端口。