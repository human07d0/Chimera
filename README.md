# MiMo Proxy

小米 MiMo 提供 OpenAI API 兼容 API，但有三个使用时需要额外参数开启的能力：

| 能力            | 需要传递的参数                               |
| --------------- | -------------------------------------------- |
| 深度思考        | `"thinking": {"type": "enabled"}`            |
| 联网搜索        | `tools` 中加入 `type: "web_search"` 对象     |
| JSON 结构化输出 | `"response_format": {"type": "json_object"}` |

大多数 OpenAI 兼容客户端（Cherry Studio、Open WebUI、Cursor 等）无法发送这些额外参数。

本代理将这三个开关的 **2³ = 8 种排列组合**映射为 8 个“虚拟模型 ID”。客户端只需在 `model` 字段中选择对应的虚拟模型名，代理自动注入所需参数并透传其余所有参数（`stream`、`temperature`、`tools` 函数调用等）。

## 支持的虚拟模型

> 这些模型 ID 是在本代理中暴露给客户端的“虚拟模型名”，最终都会路由到你配置的真实小米模型（默认是 `mimo-v2-flash`），只是自动打开不同能力。

| 模型 ID                              | 思考  | 搜索  | JSON  |
| ------------------------------------ | :---: | :---: | :---: |
| `mimo-v2-flash`                      |   ❌   |   ❌   |   ❌   |
| `mimo-v2-flash-thinking`             |   ✅   |   ❌   |   ❌   |
| `mimo-v2-flash-search`               |   ❌   |   ✅   |   ❌   |
| `mimo-v2-flash-json`                 |   ❌   |   ❌   |   ✅   |
| `mimo-v2-flash-thinking-search`      |   ✅   |   ✅   |   ❌   |
| `mimo-v2-flash-thinking-json`        |   ✅   |   ❌   |   ✅   |
| `mimo-v2-flash-search-json`          |   ❌   |   ✅   |   ✅   |
| `mimo-v2-flash-thinking-search-json` |   ✅   |   ✅   |   ✅   |

## 快速开始

### 前置要求

- Node.js >= 18（推荐 22）
- npm / pnpm / yarn 任一包管理器

### 安装

```bash
cd mimo-proxy
npm install
# 或
# pnpm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填写：

```dotenv
MIMO_API_KEY=your_mimo_api_key_here
```

如需为代理本身加一层鉴权，可以设置：

```dotenv
PROXY_API_KEY=your_optional_proxy_key
```

其余配置项都有合理默认值，按需调整即可。

### 启动

```bash
npm run build
npm start
# 或开发环境：
# npm run dev
```

服务默认监听：`http://0.0.0.0:3000`。

### Docker 运行

```bash
# 填写 MIMO_API_KEY
cp .env.example .env     

# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

> **注意**：如果使用的是带 search 的模型（内置 `web_search` 工具），你自定义的 function 工具会与 `web_search` 工具合并，两者同时生效。

## 在客户端中使用

### OpenAI 兼容客户端（Cherry Studio / Open WebUI / Cursor 等）

1. 新建一个 OpenAI 兼容的 Provider / 连接
2. Base URL 填写：`http://localhost:3000/v1`
3. API Key：
   - 如果你设置了 `PROXY_API_KEY`，这里填写同样的值
   - 如果未设置 `PROXY_API_KEY`，可随便填一个字符串（不会校验）
4. 模型列表：
   - 优先通过 `/v1/models` 自动获取
   - 或手动填入上面列出的 8 个虚拟模型 ID

### Python 示例（openai 官方 SDK）

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your_proxy_api_key",  # 若未配置 PROXY_API_KEY，随便填
)

# 使用：深度思考 + 联网搜索
response = client.chat.completions.create(
    model="mimo-v2-flash-thinking-search",
    messages=[{"role": "user", "content": "最近有什么 AI 进展？"}],
)

print(response.choices[0].message.content)
# 如果使用了 thinking，推理过程在：
# response.choices[0].message.reasoning_content
```

## 监控与费用统计（内存态）

代理内置了一个简单的监控页面，可以查看最近几天内的所有调用情况，包括：

- 时间
- 使用的模型
- 输入 tokens 数（prompt_tokens）
- 缓存命中 tokens 数（prompt_tokens_details.cached_tokens）
- 输出 tokens 数（completion_tokens）
- 每次调用耗时（毫秒）
- 按小米官方计价规则计算出的费用

### 打开监控页面

服务启动后，浏览器访问：

```text
http://localhost:3000/
```

或者直接访问 `/monitor` 也可以。

监控数据仅保存在进程内存中（`src/monitor/storage.ts`），最多保留 10,000 条；进程重启后数据会被清空，不做任何持久化。

> 设计上默认是“单用户”使用，因此没有区分不同用户的概念，也不会显示或统计 userId。

## 配置参考

| 环境变量                  | 必填  | 默认值                       | 说明                                          |
| ------------------------- | :---: | ---------------------------- | --------------------------------------------- |
| `MIMO_API_KEY`            |   ✅   | —                            | 小米 MiMo API Key                             |
| `PROXY_API_KEY`           |   ❌   | 空                           | 访问代理时的鉴权 Key，留空则不启用鉴权        |
| `PORT`                    |   ❌   | `3000`                       | 服务监听端口                                  |
| `HOST`                    |   ❌   | `0.0.0.0`                    | 服务监听地址                                  |
| `MIMO_BASE_URL`           |   ❌   | `https://api.xiaomimimo.com` | 上游 API 地址                                 |
| `MIMO_MODEL`              |   ❌   | `mimo-v2-flash`              | 实际调用的小米模型 ID                         |
| `UPSTREAM_TIMEOUT_MS`     |   ❌   | `120000`                     | 上游请求超时（毫秒）                          |
| `WEB_SEARCH_MAX_KEYWORD`  |   ❌   | `3`                          | 联网搜索最大关键词数量                        |
| `WEB_SEARCH_FORCE_SEARCH` |   ❌   | `true`                       | 是否强制开启搜索能力                          |
| `WEB_SEARCH_LIMIT`        |   ❌   | `3`                          | 每次搜索返回网页数量                          |
| `WEB_SEARCH_COUNTRY`      |   ❌   | `China`                      | 搜索地理位置 - 国家                           |
| `WEB_SEARCH_REGION`       |   ❌   | `Beijing`                    | 搜索地理位置 - 省份                           |
| `WEB_SEARCH_CITY`         |   ❌   | `Beijing`                    | 搜索地理位置 - 城市                           |
| `LOG_LEVEL`               |   ❌   | `info`                       | 日志级别：`error` / `warn` / `info` / `debug` |

## 接口列表

| 方法   | 路径                   | 说明                       |
| ------ | ---------------------- | -------------------------- |
| `GET`  | `/health`              | 健康检查                   |
| `GET`  | `/v1/models`           | 获取所有虚拟模型列表       |
| `GET`  | `/v1/models/:id`       | 获取单个虚拟模型信息       |
| `POST` | `/v1/chat/completions` | 对话补全（支持流式 SSE）   |
| `GET`  | `/monitor`             | 监控页面（最近 3 天调用）  |
| `GET`  | `/monitor/stats`       | 监控统计数据（JSON，内存态）       |
| `GET`  | `/monitor/calls`       | 监控明细数据（JSON，内存态） |
