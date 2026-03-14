# MiMo Proxy

小米 MiMo 提供 OpenAI API 兼容API，但有三个使用时需要额外参数开启的能力：

| 能力            | 需要传递的参数                               |
| --------------- | -------------------------------------------- |
| 深度思考        | `"thinking": {"type": "enabled"}`            |
| 联网搜索        | `tools` 中加入 `type: "web_search"` 对象     |
| JSON 结构化输出 | `"response_format": {"type": "json_object"}` |

大多数 OpenAI 兼容客户端（Cherry Studio、Open WebUI、Cursor 等）无法发送这些额外参数。

本代理将这三个开关的 **2³ = 8 种排列组合**映射为 8 个"虚拟模型 ID"。客户端只需在 `model` 字段中选择对应的虚拟模型名，代理自动注入所需参数并透传其余所有参数（`stream`、`temperature`、`tools` 函数调用等）。

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
- npm

### 安装

```bash
cd mimo-proxy
npm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填写：

```dotenv
MIMO_API_KEY=your_mimo_api_key_here
```

其余配置项均有合理默认值，按需修改。

### 启动

```bash
npm run build
npm start
```

服务默认监听 `http://0.0.0.0:3000`。

### Docker

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

> **注意**：如果使用的是 search 系列模型（内置 web_search 工具），自定义的 function 工具会与 web_search 工具合并，两者同时生效。

## 在客户端中配置

以常见客户端为例：

### Cherry Studio / Open WebUI / 类似客户端

1. 新建一个 OpenAI 兼容的 Provider
2. Base URL 填写：`http://localhost:3000/v1`
3. API Key 填写：你的 `PROXY_API_KEY`（若未设置则任意填写）
4. 模型列表会自动从 `/v1/models` 接口获取，或手动填入上面 8 个模型 ID

### Python（openai SDK）

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your_proxy_api_key",  # 若未配置 PROXY_API_KEY，随便填
)

# 使用深度思考 + 联网搜索
response = client.chat.completions.create(
    model="mimo-v2-flash-thinking-search",
    messages=[{"role": "user", "content": "最近有什么 AI 进展？"}],
)
print(response.choices[0].message.content)
# 推理过程在 response.choices[0].message.reasoning_content
```

## 配置参考

| 环境变量                  | 必填  | 默认值                       | 说明                                    |
| ------------------------- | :---: | ---------------------------- | --------------------------------------- |
| `MIMO_API_KEY`            |   ✅   | —                            | 小米 MiMo API Key                       |
| `PROXY_API_KEY`           |   ❌   | 空                           | 代理服务鉴权 Key，留空则不启用          |
| `PORT`                    |   ❌   | `3000`                       | 服务监听端口                            |
| `HOST`                    |   ❌   | `0.0.0.0`                    | 服务监听地址                            |
| `MIMO_BASE_URL`           |   ❌   | `https://api.xiaomimimo.com` | 上游 API 地址                           |
| `MIMO_MODEL`              |   ❌   | `mimo-v2-flash`              | 真实模型 ID                             |
| `UPSTREAM_TIMEOUT_MS`     |   ❌   | `120000`                     | 上游请求超时（毫秒）                    |
| `WEB_SEARCH_MAX_KEYWORD`  |   ❌   | `3`                          | 联网搜索最大关键词数                    |
| `WEB_SEARCH_FORCE_SEARCH` |   ❌   | `true`                       | 是否强制搜索                            |
| `WEB_SEARCH_LIMIT`        |   ❌   | `3`                          | 联网搜索返回网页数                      |
| `WEB_SEARCH_COUNTRY`      |   ❌   | `China`                      | 搜索地理位置-国家                       |
| `WEB_SEARCH_REGION`       |   ❌   | `Beijing`                    | 搜索地理位置-省份                       |
| `WEB_SEARCH_CITY`         |   ❌   | `Beijing`                    | 搜索地理位置-城市                       |
| `LOG_LEVEL`               |   ❌   | `info`                       | 日志级别：`error`/`warn`/`info`/`debug` |

## 接口列表

| 方法   | 路径                   | 说明                 |
| ------ | ---------------------- | -------------------- |
| `GET`  | `/health`              | 健康检查             |
| `GET`  | `/v1/models`           | 获取所有虚拟模型列表 |
| `GET`  | `/v1/models/:id`       | 获取单个虚拟模型信息 |
| `POST` | `/v1/chat/completions` | 对话补全（支持流式） |
