# Chimera Provider Type

## 概述

新增 `chimera` 提供商类型，用于连接另一个 chimera 实例。自动发现上游实例的端点拓扑和模型列表，无需手动维护模型配置。一个 YAML 文件在启动时展开为多个 `ProviderConfig`。

## 动机

当多个 chimera 实例链式部署时（如 dev -> stable -> 生产提供商），手动同步每个实例的模型列表和端点配置容易出错且维护成本高。`chimera` 类型通过启动时自动发现消除此问题。

## 设计

### 新增 API: `GET /v1/endpoints`

暴露当前实例的端点前缀列表，供下游 chimera 实例启动时发现拓扑。

**响应格式：**

```json
{
  "object": "list",
  "endpoints": [
    { "prefix": "/", "path": "/v1" },
    { "prefix": "/team-a", "path": "/team-a/v1" }
  ]
}
```

**实现：** 复用 `modelRegistry.getEndpoints()`。所有实例均提供此端点（非 chimera 专属），与 `/v1/models` 一致，无需鉴权。每个端点前缀下挂载，不挂载于 playground routes。

```typescript
// src/routes/endpoints.ts
endpointsRouter.get("/endpoints", (_req, res) => {
  const endpoints = modelRegistry.getEndpoints();
  res.json({
    object: "list",
    endpoints: endpoints.map(prefix => ({
      prefix,
      path: prefix ? `/${prefix}/v1` : "/v1",
    })),
  });
});
```

### ChimeraHandler

```typescript
// src/providers/builtin/chimera.ts
export const chimeraHandler: ProviderHandler = {
  type: "chimera",

  getOpenAIUrl(baseUrl: string): string | null {
    return `${baseUrl}/v1/chat/completions`;
  },

  getAnthropicUrl(baseUrl: string): string | null {
    return `${baseUrl}/anthropic/v1/messages`;
  },

  getDefaultBaseUrl(): string | null {
    return null;
  },

  getDefaultAnthropicUrl(): string | null {
    return null;
  },

  transformRequest(): void {
    // No-op: upstream chimera handles its own transforms
  },
};
```

注册于 `builtinHandlers`（非 `CUSTOM_TYPES`）。同时支持 OpenAI 和 Anthropic 端点。

`anthropic_url` 在 `ProviderConfig` 中为 `null`。运行时由 `anthropic_url ?? base_url` fallback 到 `base_url`。由于 `base_url` 在展开时已包含端点前缀（如 `http://upstream:3000/research`），`getAnthropicUrl()` 产出 `http://upstream:3000/research/anthropic/v1/messages`，与上游路由结构匹配。

### YAML 配置

```yaml
# config/provider/gw.yaml
version: 1
type: chimera
base_url: http://upstream:3000
api_key: ${UPSTREAM_KEY}
endpoint: gw
auth_prefix: "Bearer "
```

| 字段 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `version` | 是 | — | 必须为 `1` |
| `type` | 是 | — | 必须为 `chimera` |
| `base_url` | 是 | — | 上游 chimera 地址 |
| `api_key` | 是 | — | 上游鉴权 key |
| `endpoint` | 否 | `""` | 本地根前缀，所有发现的端点挂载于此 |
| `timeout` | 否 | `120000` | 运行时请求超时（毫秒），非发现超时 |
| `auth_header` | 否 | `Authorization` | 鉴权 header 名 |
| `auth_prefix` | 否 | `""` | key 前缀 |

不得包含 `models`、`anthropic_url`、`capabilities`、`web_search` 字段（strict mode 拒绝）。模型通过发现自动获取。

### Zod Schema

使用 discriminated union 按 `type` 区分 chimera 和标准类型：

```typescript
const baseFields = {
  version: z.literal(1),
  api_key: z.string(),
  base_url: z.string().optional(),
  auth_prefix: z.string().default(""),
  timeout: z.number().default(120000),
  endpoint: z.string().default(""),
  capabilities: z.record(z.unknown()).default({}),
  web_search: z.record(z.unknown()).nullable().default(null),
};

const standardSchema = z.object({
  ...baseFields,
  type: z.enum(["mimo", "deepseek", "aliyun", "kimi", "openai", "anthropic"]),
  models: z.array(modelSchema).min(1),
  auth_header: z.string(),                              // 必需，无默认值（不变）
  anthropic_url: z.string().nullable().optional(),
}).strict();

const chimeraSchema = z.object({
  ...baseFields,
  type: z.literal("chimera"),
  base_url: z.string(),                                 // 覆盖：chimera 必需
  auth_header: z.string().default("Authorization"),     // 覆盖：仅 chimera 有默认值
}).strict();

export const providerSchema = z.discriminatedUnion("type", [standardSchema, chimeraSchema]);
```

`VALID_TYPES` 常量删除，schema 中直接使用 enum/literal。`CUSTOM_TYPES` 不变（chimera 不属于 custom）。

### 启动发现流程

```text
async loadProviders() 遇到 chimera YAML
  |
  v
normalizeEndpoint(raw.endpoint)         // 规范化本地前缀
normalizeBaseUrl(raw.base_url)          // 补全 https://
  |
  v
fetchEndpoints(baseUrl, apiKey)         // 30s 超时
  |
  +-- 200 OK -> 解析端点列表: ["", "research"]
  +-- 404     -> fallback: [""]
  +-- error   -> log warn, 跳过整个 provider
  |
  v
对每个发现的上游前缀:
  fetchModels(baseUrl, prefix, apiKey)  // 30s 超时
  |
  +-- 200 OK -> 映射为 ModelConfig[]
  +-- error  -> log warn, 跳过该端点（部分注册）
  |
  v
computeLocalPrefix(configEndpoint, upstreamPrefix):
  ("", "")           -> ""
  ("", "research")   -> "research"
  ("gw", "")         -> "gw"
  ("gw", "research") -> "gw/research"
  |
  v
构造 ProviderConfig:
  name: yamlName (或 yamlName/upstreamPrefix)
  base_url: joinUrl(baseUrl, prefix)   // 包含端点前缀
  anthropic_url: null                   // 运行时 fallback
  endpoint: localPrefix
  |
  v
加入 modelIdMap（重复检测）
加入 providers 数组
```

### 发现函数

```typescript
const DISCOVERY_TIMEOUT = 30_000;

async function fetchEndpoints(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${baseUrl}/v1/endpoints`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DISCOVERY_TIMEOUT,
  );
  if (res.status === 404) return [""];  // 非 chimera 上游
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.endpoints as Array<{ prefix: string }>).map(e => e.prefix);
}

async function fetchModels(baseUrl: string, prefix: string, apiKey: string): Promise<ModelConfig[]> {
  const prefixPath = prefix ? `/${prefix}` : "";
  const res = await fetchWithTimeout(
    `${baseUrl}${prefixPath}/v1/models`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    DISCOVERY_TIMEOUT,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const loadTime = Math.floor(Date.now() / 1000);
  return (data.data as any[]).map(m => ({
    id: m.id,
    upstream: m.id,
    context_length: m.context_length ?? 0,
    max_output_tokens: m.max_output_tokens ?? 0,
    description: m.description ?? m.id,
    created: m.created ?? loadTime,
    capabilities: m.capabilities ?? {},
    modalities: m.architecture ? {
      input: m.architecture.input_modalities ?? ["text"],
      output: m.architecture.output_modalities ?? ["text"],
    } : undefined,
    pricing: m.pricing,
  }));
}
```

### Loader 主循环分支

```typescript
export async function loadProviders(...): Promise<ProviderConfig[]> {
  for (const file of files) {
    const raw = parsed.data;

    // chimera: 异步发现，跳过标准路径
    if (raw.type === "chimera") {
      const configEndpoint = normalizeEndpoint(raw.endpoint);
      let baseUrl = raw.base_url;  // schema 保证非空
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        baseUrl = "https://" + baseUrl;
      }

      const discovered = await discoverChimeraProviders(raw, name, baseUrl, configEndpoint);

      // 加入 modelIdMap 用于重复检测
      for (const provider of discovered) {
        if (!modelIdMap.has(provider.endpoint)) {
          modelIdMap.set(provider.endpoint, new Map());
        }
        const endpointModels = modelIdMap.get(provider.endpoint)!;
        for (const model of provider.models) {
          if (!endpointModels.has(model.id)) {
            endpointModels.set(model.id, []);
          }
          endpointModels.get(model.id)!.push(file);
        }
      }

      providers.push(...discovered);
      continue;
    }

    // 标准路径（不变）
    if (raw.models.length === 0) { continue; }
    // ... 模型迭代、冲突追踪、ProviderConfig 构造 ...
  }

  // 重复 model ID 检测（覆盖 chimera 展开的 provider）
  // custom type base_url 校验（chimera 不属于 custom，跳过）
  // 空 models 过滤
}
```

### 展开示例

```yaml
# config/provider/gw.yaml
version: 1
type: chimera
base_url: http://10.0.0.1:3000
api_key: ${UPSTREAM_KEY}
endpoint: gw
```

上游 `/v1/endpoints` 返回 `["", "research"]`。

| 展开配置 | `name` | `endpoint` | `base_url` | 模型来源 |
|----------|--------|-----------|------------|----------|
| 1 | `gw` | `gw` | `http://10.0.0.1:3000` | `/v1/models` |
| 2 | `gw/research` | `gw/research` | `http://10.0.0.1:3000/research` | `/research/v1/models` |

挂载路由：

```text
GET  /gw/v1/endpoints
GET  /gw/v1/models
POST /gw/v1/chat/completions
POST /gw/anthropic/v1/messages
GET  /gw/research/v1/endpoints
GET  /gw/research/v1/models
POST /gw/research/v1/chat/completions
POST /gw/research/anthropic/v1/messages
```

### Async 边界

`loadProviders` 改为 async。`registry.init()` 改为 async。`createApp()` 已是 async，直接 `await modelRegistry.init()`。

影响范围：
- `server.ts:23` — `await modelRegistry.init()`
- `loader.test.ts` — 54 个测试迁移：
  - 36 个 `const providers = loadProviders(dir)` -> `await loadProviders(dir)`
  - 15 个 `expect(() => loadProviders(dir)).toThrow()` -> `await expect(loadProviders(dir)).rejects.toThrow()`
  - 3 个 `try { loadProviders(dir) } catch` -> `try { await loadProviders(dir) } catch`

## 错误处理

| 场景 | 行为 |
|------|------|
| 上游不可达（30s 超时） | log error，跳过整个 provider |
| `/v1/endpoints` 返回 404 | fallback 到 `[""]`（仅默认端点） |
| 某端点 `/v1/models` 失败 | 跳过该端点，其余正常注册（部分注册） |
| `base_url` 缺失 | zod 校验错误 |
| `api_key` 缺失 | zod 校验错误 |
| 循环依赖 A->B->A | 30s 超时后跳过，用户自行负责 |
| 非 chimera 上游 | 404 fallback 到 `""`，从 `/v1/models` 发现模型 |
| `context_length`/`max_output_tokens` 缺失 | 默认 0 |

## 设计约束

- **chimera-to-chimera 假设：** `transformRequest` 无操作，假设上游 chimera 实例自行处理 transform。若 chimera 直连非 chimera 提供商（如 DeepSeek API），请求体可能缺少必要的字段转换。
- **静态模型列表：** 发现结果在启动时确定，运行时不自动刷新。上游模型变更需重启。
- **`ENABLED_PROVIDERS` 按文件过滤：** 对 chimera YAML 整体生效（全部包含或全部排除），不支持子端点过滤。
- **发现超时硬编码 30 秒：** 不使用 YAML 中的 `timeout` 字段（那是运行时 API 请求超时）。

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/providers/builtin/chimera.ts` | 新增：ChimeraHandler |
| `src/providers/builtin/index.ts` | 添加 `["chimera", chimeraHandler]` |
| `src/providers/loader.ts` | 删除 `VALID_TYPES`；discriminated union schema；`loadProviders` 异步；chimera 分支 + 发现函数 |
| `src/providers/registry.ts` | `init()` 异步；`await loadProviders()` |
| `src/server.ts` | `await modelRegistry.init()`；挂载 `endpointsRouter` |
| `src/routes/endpoints.ts` | 新增：`GET /v1/endpoints` |
| `src/providers/__tests__/loader.test.ts` | 测试迁移（async/await + rejects.toThrow） |
