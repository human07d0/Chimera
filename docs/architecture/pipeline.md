# 请求处理流水线

## 处理顺序

```text
1. 客户端请求到达: { model: "mimo-v2.5-pro-thinking", temperature: 0.8 }
2. Model lookup → { handler, providerConfig, modelConfig }
   — 按 endpoint 前缀作用域查找（如 /v1、/token-plan/v1）
   — 未找到 → HTTP 404 + 协议兼容错误体
3. 浅克隆客户端 body ({ ...req.body })
   — 保留原始数据用于 debug/monitor 记录
4. 替换 body.model = modelConfig.upstream   — 所有 handler
5. 对原始客户端 body 中缺失的 key 应用 modelConfig.default
   — 仅顶层 key 匹配
   — default key 使用转换后字段名
   — 可包含提供商特定 key（thinking、response_format、tools）
6. handler.transformRequest(body, modelConfig, originalClientBody)
   — 内置 handler：仅结构适配（字段重命名，如 max_tokens → max_completion_tokens）。检查 originalClientBody 区分客户端提供的值和 default 注入的值后再重命名。
   — 自定义 handler：返回 body 不变（纯透传）。
   — Handler 不注入任何字段值。所有提供商特定默认值来自 YAML 配置。
7. 通过 fetchWithTimeout(body, { timeout: providerConfig.timeout }) 发送到上游
```

## `res.locals` 契约

路由 handler 设置，中间件读取：

| 字段 | 设置方 | 读取方 | 说明 |
|------|--------|--------|------|
| `requestId` | 路由 handler | Debug/monitor 中间件 | 唯一请求 ID |
| `upstreamModel` | 路由 handler | Monitor 中间件 | 发送给上游的真实模型 ID（用于定价查找） |
| `virtualModelId` | 路由 handler | Debug 中间件 | 客户端可见模型 ID（用于调试记录） |
| `providerName` | 路由 handler | Monitor 中间件 | 提供商名称（用于路由来源标识） |

## URL 构造

- `getOpenAIUrl(baseUrl)` → `{baseUrl}/v1/chat/completions` 或 `null`（不支持）
- `getAnthropicUrl(baseUrl)` → `{baseUrl}/v1/messages` 或 `null`（不支持）
- `endpoint` 前缀由 Express router 处理，不由 handler 处理
- Anthropic 路由：`anthropic_url ?? base_url` 传给 `getAnthropicUrl()`
- `anthropic_url` 可包含路径前缀（如 `https://api.xiaomimimo.com/anthropic`）。Handler 仅追加后缀

## 路由过滤

| 路由 | 匹配条件 |
|------|----------|
| `{endpoint}/v1/chat/completions` | `type` 支持 OpenAI 的提供商 |
| `{endpoint}/anthropic/v1/messages` | `type` 支持 Anthropic 的提供商 |
| `{endpoint}/v1/models` | 该端点所有提供商的模型 |
| `{endpoint}/v1/models/:modelId` | 该端点任意提供商的单个模型 |

## 鉴权

主 `authMiddleware` 覆盖所有 `{endpoint}/v1/*` 和 `{endpoint}/anthropic/v1/*` 路由。所有提供商共享 `PROXY_API_KEY` 进行客户端鉴权。使用 `extractApiKey`（`src/utils/auth.ts`）统一处理 `Authorization: Bearer`、`api-key`、`x-api-key` 三种 header 格式。

## Header 转发

对于 Anthropic 路由（`type: anthropic`），以下 header 转发到上游：

- `anthropic-version`
- `anthropic-beta`

这些 header 是 Anthropic 兼容 API 所需的。Handler 从客户端请求中读取这些 header 并包含在上游请求 header 中。

## 多模态透传

采用 **passthrough-first** 策略：不解析或修改 `messages` 中的多模态 content parts。

### 请求侧

| 环节 | 处理方式 | 多模态影响 |
|:-----|:---------|:----------|
| `express.json()` | 解析 JSON body，limit 10MB | base64 图片受 10MB 限制 |
| `transformRequest()` | 仅覆盖 model/thinking/tools 等字段 | `messages` 中的 content parts 完整保留 |
| 自定义提供商透传 | 原样转发 | 所有多模态数据完整保留 |

### 响应侧

| 环节 | 处理方式 | 多模态影响 |
|:-----|:---------|:----------|
| SSE 流式传输 | 逐 chunk 转发，只替换 `model` 字段 | 多模态输出安全透传 |
| 非流式响应 | `res.json()` 直接返回 | 多模态响应完整透传 |

### 已知约束

1. `express.json({ limit: "10mb" })` — 超大图片被拒绝
2. 不支持 `multipart/form-data` 上传
3. 上游返回的图片 URL 不被代理或重写
4. 代理层不校验多模态内容格式

## 代码示例

### OpenAI 路由 — 完整流水线

```typescript
const resolved = modelRegistry.lookup(req.body.model, endpointPrefix);
if (!resolved) {
  return res.status(404).json({ error: { message: "Model not found", type: "invalid_request_error" } });
}

const url = resolved.handler.getOpenAIUrl(resolved.providerConfig.base_url);
const authHeaders = {
  [resolved.providerConfig.auth_header]: resolved.providerConfig.auth_prefix + resolved.providerConfig.api_key,
};

const originalClientBody = { ...req.body };        // Step 3: clone
req.body.model = resolved.modelConfig.upstream;     // Step 4: swap model

// Step 5: apply defaults for keys absent from originalClientBody
const body = applyDefaults(req.body, resolved.modelConfig.default, originalClientBody);

// Step 6: structural adaptation (field renaming only, no value injection)
const transformed = resolved.handler.transformRequest(body, resolved.modelConfig, originalClientBody);

res.locals.providerName = resolved.providerConfig.name;

// Step 7: send to upstream
```

### Anthropic 路由 — 不同点仅在 URL

```typescript
const anthropicBase = resolved.providerConfig.anthropic_url ?? resolved.providerConfig.base_url;
const url = resolved.handler.getAnthropicUrl(anthropicBase);
// Anthropic-specific headers are forwarded by the handler
```
