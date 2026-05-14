# 监控与调试

## 存储抽象

`MonitorStorage` 统一接口：

- `append(event)` — 写入事件
- `query(params)` — 查询事件列表
- `stats(params)` — 聚合统计
- `trend(params)` — 趋势数据
- `tokenTrend(params)` — token 趋势数据
- `prune(retentionDays)` — 清理过期数据
- `close()` — 关闭连接

### 存储实现

| 实现 | 特性 | 适用场景 |
|------|------|----------|
| `memory` | 进程内存，重启丢失 | 开发、临时实例 |
| `sqlite` | `sql.js` 纯 JS 实现，WAL 模式 | 生产持久化 |

`getStorage()` 启动阶段优先初始化 sqlite，失败时自动降级 memory 并记录错误日志。

### SQLite 设计

- 自动创建数据库目录（默认 `./data/monitor.db`，由 `MONITOR_SQLITE_PATH` 配置）
- `requests` 表存 request-level 核心字段
- 索引：`requests(ts_start)`、`requests(status_code, ts_start)`、`requests(model_requested, ts_start)`

## 事件模型

Request-level 事件，默认不持久化 payload：

| 字段 | 说明 |
|------|------|
| `request_id` | 唯一请求 ID |
| `ts_start` / `ts_end` / `latency_ms` | 时间和延迟 |
| `path` / `method` / `status_code` | 请求信息 |
| `model_requested` / `model_upstream` / `provider_name` | 模型和提供商 |
| `stream` / `chunks` / `bytes_out` / `first_token_ms` | 流式指标 |
| `input_tokens` / `output_tokens` / `cached_prompt_tokens` / `cost` | 用量和费用 |
| `error_type` | 错误类型 |

### 定价

- 模型配置中的 `pricing` 字段提供单模型平价定价（`{ input, cached_input?, output }` 每 1M token）
- 缺失时使用 handler 的分层定价回退，按 `upstream` 查找（见 `src/monitor/pricing.ts`）
- 分层定价按 prompt + completion 总 token 数选择适用层级

## 数据流

```text
请求 → monitorMiddleware（采集元信息）
     → storageWorker.append(event)
     → 异步队列：
         达到 MONITOR_FLUSH_BATCH_SIZE → 立即 flush
         每 MONITOR_FLUSH_INTERVAL_MS → 定时 flush
         写入失败 → 最多重试 3 次
     → MonitorStorage（memory / sqlite）
```

退出时由主进程调用 `stopCleanupTask()` 与 `await storageWorker.shutdown()`，完成队列 flush 后 `close()`。

### 配置常量

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `MONITOR_FLUSH_BATCH_SIZE` | `100` | 达到此数量立即 flush |
| `MONITOR_FLUSH_INTERVAL_MS` | `200` | 定时 flush 间隔（毫秒） |
| `MONITOR_QUEUE_MAX_SIZE` | `10000` | 队列最大容量 |

队列满时新记录被丢弃并记录警告。恢复后记录 info 日志。

## Debug 模块

可选调试模块（`DEBUG_ENABLED=true`），记录完整请求/响应体到内存环形缓冲区。

### DebugStore

- 纯内存环形缓冲区，同步读写，无持久化
- `append(event)` — 写入，超限时淘汰最旧记录
- `query(params)` — 内存中过滤和搜索（支持 model 和 keyword 搜索）
- `getById(id)` — 按 request_id 查找
- `prune()` — 清空缓冲区

### DebugEvent

```typescript
interface DebugEvent {
  request_id: string;
  ts_start: number;
  ts_end: number;
  path: string;
  method: string;
  status_code: number;
  model_requested: string;
  model_upstream: string;
  stream: boolean;
  request_body: string;       // 完整请求体（base64 媒体已替换为摘要占位符）
  response_body: string;      // 完整响应体（流式为拼接后的 JSON）
  error_type: string | null;
  error_body: string | null;
  media?: DebugMediaItem[];   // 媒体资源缓存
}
```

### debugMiddleware

- monkey-patch `res.json` 捕获非流式响应体
- monkey-patch `res.write` 收集流式 SSE chunks
- monkey-patch `res.end` 组装并存储调试事件
- 在 monitor middleware 之前挂载
- 在所有 `{endpoint}/v1`、`{endpoint}/anthropic/v1` 上挂载

### 数据流

```text
1. debugMiddleware 拦截 /chat/completions 和 /messages 请求
2. 序列化 req.body 为请求体快照
3. 通过 monkey-patch 收集完整响应体
4. res.end 时组装 DebugEvent 并写入 DebugStore
5. /debug/calls API 返回列表（含 preview）
6. /debug/calls/:id 返回完整 body
7. /debug/media/:requestId/:mediaId 返回媒体资源二进制
```

### 配置常量

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DEBUG_ENABLED` | `false` | 启用 debug 模块 |
| `DEBUG_MAX_RECORDS` | `500` | 环形缓冲区最大记录数 |
| `DEBUG_MAX_BODY_SIZE` | `1048576` | JSON body 最大大小（字节） |
| `DEBUG_MAX_MEDIA_BYTES` | `10485760` | 每个资源最大媒体缓存（字节） |
