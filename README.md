# MiMo Proxy

小米 MiMo 提供 OpenAI API 兼容 API，但有三个使用时需要额外参数开启的能力：

| 能力            | 需要传递的参数                               |
| --------------- | -------------------------------------------- |
| 深度思考        | `"thinking": {"type": "enabled"}`            |
| 联网搜索        | `tools` 中加入 `type: "web_search"` 对象     |
| JSON 结构化输出 | `"response_format": {"type": "json_object"}` |

大多数 OpenAI 兼容客户端（Cherry Studio、Open WebUI、Cursor 等）无法发送这些额外参数。

本代理将这三个开关的 **2³ = 8 种排列组合**映射为“虚拟模型 ID”。
针对每个启用的真实模型都会生成 8 个虚拟模型，因此在默认配置下（5 个模型全开）一共会暴露 **40 个虚拟模型**。
客户端只需在 `model` 字段中选择对应的虚拟模型名，代理自动注入所需参数并透传其余所有参数（`stream`、`temperature`、`tools` 函数调用等）。  
软件设计考虑的使用场景为局域网个人使用。

## 支持的虚拟模型

代理支持以下真实模型（接口格式一致）：

- `mimo-v2-flash`
- `mimo-v2-pro`
- `mimo-v2-omni`
- `mimo-v2.5`
- `mimo-v2.5-pro`

默认会对以上模型全部开启虚拟映射；你也可以通过 `.env` 的 `MIMO_ENABLED_MODELS` 控制启用哪些真实模型。

每个真实模型都会生成以下 8 种能力组合的虚拟模型（以 `mimo-v2-flash` 为例）：

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

对应地，`mimo-v2-pro` / `mimo-v2-omni` 也会生成同样后缀规则的 8 个虚拟模型。

## 快速开始

### 前置要求

- Node.js >= 24 LTS
- pnpm 10.x（推荐）

### 安装

```bash
cd mimo-proxy
pnpm install
```

### 构建 Ops 运维界面前端（可选）

运维界面前端使用 Vite 构建，构建产物由 Express 在同一进程托管（单体部署），无需独立前端服务器。

```bash
# 完整构建（含前端）
pnpm run build
```

如仅需修改前端源码后重新构建：

```bash
pnpm run build:ops
```

前端源码位于 `src/ops/frontend/`，构建产物输出到 `dist/ops/`。



### Termux 安装（Android）

```bash
pkg update && pkg upgrade
pkg install nodejs-lts

cd mimo-proxy
pnpm install
pnpm run build
```

如需使用 sqlite 持久化，建议显式设置：

```dotenv
MONITOR_STORAGE=sqlite
MONITOR_SQLITE_PATH=./data/monitor.db
```

若需快速恢复服务：临时切换 `MONITOR_STORAGE=memory`。


### 配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填写一个上游 API Key：

```dotenv
# 使用主代理（带虚拟模型映射）
MIMO_API_KEY=your_mimo_api_key_here

# 或使用 token-plan 透传代理
TOKEN_PLAN_ENABLED=true
TOKEN_PLAN_MIMO_API_KEY=your_token_plan_api_key_here
```

如需为代理本身加一层鉴权，可以设置：

```dotenv
PROXY_API_KEY=your_optional_proxy_key
```

其余配置项都有合理默认值，按需调整即可。

### 启动

```bash
pnpm run build
pnpm start
# 或开发环境：
# pnpm run dev
```

服务默认监听：`http://0.0.0.0:3000`。

### 跨平台打包与部署

项目提供了安装脚本和手册：

- **Windows**：运行 `scripts/install-windows.bat`
- **Linux**：运行 `scripts/install-linux.sh`（需要先赋予执行权限）
- **Android (Termux)**：参考 `ANDROID_INSTALL.md` 手册

Bun 构建命令：
```bash
pnpm run bun:build
```

构建产物在 `dist-bun/` 目录，为单文件可执行文件。


> **注意**：如果使用的是带 search 的模型（内置 `web_search` 工具），你自定义的 function 工具会与 `web_search` 工具合并，两者同时生效。

## 在客户端中使用

### Anthropic API 客户端（Claude Desktop / Cursor 等）

本代理支持 Anthropic Messages API，可通过 `/anthropic/v1/messages` 接口访问：

| 配置项   | 值                                   |
| -------- | ------------------------------------ |
| Base URL | `http://localhost:3000/anthropic/v1` |
| API Key  | 你的 `PROXY_API_KEY`                 |

支持的模型与 OpenAI 接口相同。

#### cURL 示例

```bash
# 非流式
curl -X POST http://localhost:3000/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_proxy_key" \
  -d '{
    "model": "mimo-v2-flash-thinking",
    "messages": [{"role": "user", "content": "1+1=?"}],
    "max_tokens": 100
  }'

# 流式
curl -N -X POST http://localhost:3000/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_proxy_key" \
  -d '{
    "model": "mimo-v2-flash-thinking",
    "messages": [{"role": "user", "content": "讲个笑话"}],
    "max_tokens": 200,
    "stream": true
  }'
```

#### Python 示例（使用 anthropic SDK）

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:3000/anthropic/v1",
    api_key="your_proxy_key"  # 若未配置 PROXY_API_KEY，随便填
)

# 使用：深度思考
try:
    message = client.messages.create(
        model="mimo-v2-flash-thinking",
        max_tokens=200,
        messages=[{"role": "user", "content": "解释量子纠缠"}]
    )
    print(message.content[0].text)
except Exception as e:
    print(f"Error: {e}")
```

#### Anthropic 模型列表

```bash
curl http://localhost:3000/anthropic/v1/models \
  -H "x-api-key: your_proxy_key"
```

返回示例：

```json
{
  "models": [
    {
      "name": "mimo-v2-flash-thinking",
      "input_token_limit": 200000,
      "thinking": { "type": "enabled" }
    }
  ]
}
```

### OpenAI 兼容客户端（Cherry Studio / Open WebUI / Cursor 等）

1. 新建一个 OpenAI 兼容的 Provider / 连接
2. Base URL 填写：`http://localhost:3000/v1`
3. API Key：
   - 如果你设置了 `PROXY_API_KEY`，这里填写同样的值
   - 如果未设置 `PROXY_API_KEY`，可随便填一个字符串（不会校验）
4. 模型列表：
   - 优先通过 `/v1/models` 自动获取（会返回当前启用模型生成的全部虚拟模型）
   - 或手动填入符合规则的模型名（如 `mimo-v2-pro-thinking-search`）

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

## 调试模式（Debug）

调试模式记录完整的请求/响应体（包括 prompt 和 completion 原文），仅存内存，进程重启即清空。与 monitor 模块互补：monitor 记录元数据并可落盘，debug 记录完整 payload 仅存内存。

### 启用调试模式

```dotenv
DEBUG_ENABLED=true
# 内存环形缓冲区最大记录数（默认 500）
DEBUG_MAX_RECORDS=500
# 单条记录最大 body 大小，超过截断（默认 1MB）
DEBUG_MAX_BODY_SIZE=1048576
```

重启服务后生效。

### 打开调试页面

```text
http://localhost:3000/debug
```

页面提供调用列表、模型过滤、关键词搜索、详情查看（含 JSON 语法高亮），每 5 秒自动刷新。

### 调试 API

| 方法   | 路径                  | 说明                                       |
| ------ | --------------------- | ------------------------------------------ |
| `GET`  | `/debug/calls`        | 查询调试记录列表（支持 `search`/`model`/`limit`/`offset` 参数） |
| `GET`  | `/debug/calls/:id`    | 获取单条记录详情（含完整 request/response body） |
| `POST` | `/debug/prune`        | 清空内存缓冲区                             |

### 注意事项

- 完整请求/响应体仅存内存，不写入数据库，进程重启即清空
- 默认关闭（`DEBUG_ENABLED=false`），不影响性能
- 单条 body 超过 `DEBUG_MAX_BODY_SIZE` 时自动截断

## 监控与费用统计（memory / sqlite）

代理内置监控页面，默认采集 `/v1/chat/completions` 与 `/anthropic/v1/messages` 的**请求级元信息**（不落盘 prompt/response 原文）：

- `request_id`
- `ts_start` / `ts_end` / `latency_ms`
- `path` / `method` / `status_code`
- `model_requested` / `model_upstream`
- `stream` / `chunks` / `bytes_out` / `first_token_ms`
- `input_tokens` / `output_tokens` / `cached_prompt_tokens` / `cost`
- `error_type`

### 打开监控页面

服务启动后访问：

```text
http://localhost:3000/
```

或：`/monitor`。

### 存储模式

- `MONITOR_STORAGE=memory`（默认）
  - 进程内存保存，重启丢失
  - 适合本地开发和轻量场景
- `MONITOR_STORAGE=sqlite`
  - 数据写入 `MONITOR_SQLITE_PATH`（默认 `./data/monitor.db`）
  - 支持重启后保留历史记录
  - 使用 WAL 模式与异步队列，尽量降低对主链路影响

### 回滚方式

若 sqlite 模式出现问题，可立即回滚到内存模式：

```dotenv
MONITOR_STORAGE=memory
```

重启服务后生效，不影响 `/v1/chat/completions` 主流程。

## Ops 运维界面

运维界面提供运行时配置管理和服务控制功能，与主服务同一进程托管（单体部署），无需独立服务器。

### 启用运维界面

在 `.env` 中设置运维密码：

```dotenv
OPS_PASSWORD=your_ops_password_here
```

重启服务后生效，访问地址：`http://localhost:3000/ops`。

### API 示例

```bash
# 获取服务状态
curl -H "Authorization: Bearer your_ops_password" http://localhost:3000/ops/status

# 获取当前配置
curl -H "Authorization: Bearer your_ops_password" http://localhost:3000/ops/config

# 获取可修改的配置项白名单
curl -H "Authorization: Bearer your_ops_password" http://localhost:3000/ops/config/schema

# 更新配置（如修改日志级别）
curl -X POST \
  -H "Authorization: Bearer your_ops_password" \
  -H "Content-Type: application/json" \
  -d '{"logLevel": "debug"}' \
  http://localhost:3000/ops/config

# 优雅停机
curl -X POST -H "Authorization: Bearer your_ops_password" http://localhost:3000/ops/shutdown

# 重启服务
curl -X POST -H "Authorization: Bearer your_ops_password" http://localhost:3000/ops/restart
```

### 支持的运行时配置项

| 配置项                   | 类型    | 说明                                          |
| ------------------------ | ------- | --------------------------------------------- |
| `logLevel`               | string  | 日志级别：`error` / `warn` / `info` / `debug` |
| `webSearchMaxKeyword`    | number  | 联网搜索最大关键词数量                        |
| `webSearchForceSearch`   | boolean | 是否强制开启联网搜索                          |
| `webSearchLimit`         | number  | 每次搜索返回的网页数量                        |
| `webSearchCountry`       | string  | 搜索地理位置 - 国家                           |
| `webSearchRegion`        | string  | 搜索地理位置 - 省份                           |
| `webSearchCity`          | string  | 搜索地理位置 - 城市                           |
| `monitorFlushIntervalMs` | number  | 监控刷新间隔（毫秒）                          |
| `monitorRetentionDays`   | number  | 监控数据保留天数                              |

### 重启说明

- 重启时会启动 watcher 进程监控主进程
- 收到重启请求后，watcher 会启动新的主进程，然后当前进程退出
- 若 watcher 未正常启动，重启会使用 fork 方式执行 `pnpm start`
- 运行时配置修改后会同步写入 `.env`，重启后生效

### 安全说明

- Ops 界面使用独立的 `OPS_PASSWORD`，与 `PROXY_API_KEY` 分离
- 建议使用强密码，避免泄露
- 未配置 `OPS_PASSWORD` 时，运维界面完全禁用

## 已验证环境

| 项目    | 版本                         |
| ------- | ---------------------------- |
| Node.js | 24 LTS                       |
| pnpm    | 10.32.x                      |
| Express | 5.2.x                        |
| sql.js  | 1.10.x                       |
| dotenv  | 17.x                         |
| 平台    | Windows /  Android（Termux） |
| Bun     | 1.x                          |

## Token-Plan 透传代理

token-plan 是小米推出的计费方案，使用不同的上游地址。本代理将 token-plan 作为 Router 挂载于主应用的 `/token-plan` 路径下，复用同一端口（默认 3000），无需管理独立 HTTP 服务器。请求原样透传到 token-plan 上游，不做虚拟模型映射。

### 启用 token-plan

```dotenv
TOKEN_PLAN_ENABLED=true
TOKEN_PLAN_MIMO_API_KEY=your_token_plan_api_key_here
TOKEN_PLAN_PROXY_API_KEY=your_token_plan_proxy_key
```

### 使用方式

客户端直接使用真实模型名（如 `mimo-v2-flash`、`mimo-v2.5-pro`），无需虚拟模型映射。

| 配置项   | 值                                           |
| -------- | -------------------------------------------- |
| Base URL | `http://localhost:3000/token-plan/v1`        |
| API Key  | 你的 `TOKEN_PLAN_PROXY_API_KEY`              |

#### cURL 示例

```bash
# OpenAI 格式
curl -X POST http://localhost:3000/token-plan/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token_plan_proxy_key" \
  -d '{
    "model": "mimo-v2-flash",
    "messages": [{"role": "user", "content": "1+1=?"}],
    "stream": true
  }'

# Anthropic 格式
curl -X POST http://localhost:3000/token-plan/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_token_plan_proxy_key" \
  -d '{
    "model": "mimo-v2-flash",
    "messages": [{"role": "user", "content": "1+1=?"}],
    "max_tokens": 100
  }'
```

### API Key 回退逻辑

- `TOKEN_PLAN_MIMO_API_KEY`：token-plan 上游鉴权 Key，留空时回退到 `MIMO_API_KEY`
- `TOKEN_PLAN_PROXY_API_KEY`：客户端访问 token-plan 代理时的鉴权 Key，留空则不启用鉴权

## 配置参考

| 环境变量                         | 必填  | 默认值                                    | 说明                                                                                   |
| -------------------------------- | :---: | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `MIMO_API_KEY`                   |   ❌   | 空                                        | 小米 MiMo API Key（主代理使用，仅使用 token-plan 时可留空）                            |
| `PROXY_API_KEY`                  |   ❌   | 空                                        | 访问代理时的鉴权 Key，留空则不启用鉴权                                                 |
| `PORT`                           |   ❌   | `3000`                                    | 服务监听端口                                                                           |
| `HOST`                           |   ❌   | `0.0.0.0`                                 | 服务监听地址                                                                           |
| `MIMO_BASE_URL`                  |   ❌   | `https://api.xiaomimimo.com`              | 上游 API 地址（OpenAI 格式）                                                           |
| `ANTHROPIC_BASE_URL`             |   ❌   | `https://api.xiaomimimo.com/anthropic/v1` | Anthropic 上游 API 地址（Messages 格式）                                               |
| `MIMO_ENABLED_MODELS`            |   ❌   | `mimo-v2-flash,mimo-v2-pro,mimo-v2-omni,mimo-v2.5,mimo-v2.5-pro` | 启用的真实模型列表（逗号分隔，可选：`mimo-v2-flash` / `mimo-v2-pro` / `mimo-v2-omni` / `mimo-v2.5` / `mimo-v2.5-pro`） |
| `UPSTREAM_TIMEOUT_MS`            |   ❌   | `120000`                                  | 上游请求超时（毫秒）                                                                   |
| `TOKEN_PLAN_ENABLED`             |   ❌   | `false`                                   | 是否启用 token-plan 透传代理（挂载于主应用 /token-plan 路径下）                        |
| `TOKEN_PLAN_PROXY_API_KEY`       |   ❌   | 空                                        | 客户端访问 token-plan 代理时的鉴权 Key，留空则不启用鉴权                               |
| `TOKEN_PLAN_MIMO_API_KEY`        |   ❌   | 空                                        | token-plan 上游 API Key，留空时回退到 `MIMO_API_KEY`                                   |
| `TOKEN_PLAN_BASE_URL`            |   ❌   | `https://token-plan-cn.xiaomimimo.com/v1` | token-plan 上游 OpenAI 格式 Base URL                                                   |
| `TOKEN_PLAN_ANTHROPIC_BASE_URL`  |   ❌   | `https://token-plan-cn.xiaomimimo.com/anthropic` | token-plan 上游 Anthropic 格式 Base URL                                          |
| `WEB_SEARCH_MAX_KEYWORD`         |   ❌   | `3`                                       | 联网搜索最大关键词数量                                                                 |
| `WEB_SEARCH_FORCE_SEARCH`        |   ❌   | `true`                                    | 是否强制开启搜索能力                                                                   |
| `WEB_SEARCH_LIMIT`               |   ❌   | `3`                                       | 每次搜索返回网页数量                                                                   |
| `WEB_SEARCH_COUNTRY`             |   ❌   | `China`                                   | 搜索地理位置 - 国家                                                                    |
| `WEB_SEARCH_REGION`              |   ❌   | `Beijing`                                 | 搜索地理位置 - 省份                                                                    |
| `WEB_SEARCH_CITY`                |   ❌   | `Beijing`                                 | 搜索地理位置 - 城市                                                                    |
| `MONITOR_STORAGE`                |   ❌   | `memory`                                  | Monitor 存储后端：`memory` / `sqlite`                                                  |
| `MONITOR_SQLITE_PATH`            |   ❌   | `./data/monitor.db`                       | SQLite 文件路径（仅 `MONITOR_STORAGE=sqlite` 生效）                                    |
| `MONITOR_RETENTION_DAYS`         |   ❌   | `30`                                      | 监控数据保留天数（定时清理）                                                           |
| `MONITOR_FLUSH_INTERVAL_MS`      |   ❌   | `200`                                     | 异步写入队列定时 flush 间隔（毫秒）                                                    |
| `MONITOR_FLUSH_BATCH_SIZE`       |   ❌   | `100`                                     | 异步写入队列单次批量大小                                                               |
| `MONITOR_QUEUE_MAX_SIZE`         |   ❌   | `10000`                                   | 异步队列最大长度，超限后丢弃并记录计数                                                 |
| `DEBUG_ENABLED`                  |   ❌   | `false`                                   | 是否启用调试模式（记录完整请求/响应体到内存）                                          |
| `DEBUG_MAX_RECORDS`              |   ❌   | `500`                                     | 调试内存环形缓冲区最大记录数                                                           |
| `DEBUG_MAX_BODY_SIZE`            |   ❌   | `1048576`                                 | 单条调试记录最大 body 大小（字节），超过截断                                            |
| `LOG_LEVEL`                      |   ❌   | `info`                                    | 日志级别：`error` / `warn` / `info` / `debug`                                          |
| `OPS_PASSWORD`                   |   ❌   | 空                                        | Ops 运维界面密码，留空则不启用（单体部署，无需独立前端服务器）                         |

## 接口列表

### 主代理（端口 3000）

| 方法   | 路径                     | 说明                                   |
| ------ | ------------------------ | -------------------------------------- |
| `GET`  | `/health`                | 健康检查                               |
| `GET`  | `/v1/models`             | 获取所有虚拟模型列表                   |
| `GET`  | `/v1/models/:id`         | 获取单个虚拟模型信息                   |
| `POST` | `/v1/chat/completions`   | 对话补全（支持流式 SSE）               |
| `POST` | `/anthropic/v1/messages` | Anthropic Messages API（支持流式 SSE） |
| `GET`  | `/monitor`               | 监控页面（最近 3 天调用）              |
| `GET`  | `/monitor/stats`         | 监控统计数据（JSON）                   |
| `GET`  | `/monitor/calls`         | 监控明细数据（JSON）                   |
| `POST` | `/monitor/prune`         | 手动清理历史数据（默认仅 dev 或鉴权）  |
| `GET`  | `/debug`                 | 调试页面（需 `DEBUG_ENABLED=true`）    |
| `GET`  | `/debug/calls`           | 调试记录列表（需 `DEBUG_ENABLED=true`）|
| `GET`  | `/debug/calls/:id`       | 调试记录详情（需 `DEBUG_ENABLED=true`）|
| `POST` | `/debug/prune`           | 清空调试缓冲区（需 `DEBUG_ENABLED=true`）|
| `GET`  | `/ops/info`              | Ops 界面基本信息（是否启用）           |
| `GET`  | `/ops/status`            | 服务运行状态（需 Ops 鉴权）            |
| `GET`  | `/ops/config`            | 获取当前配置（需 Ops 鉴权）            |
| `GET`  | `/ops/config/schema`     | 获取可修改配置项白名单（需 Ops 鉴权）  |
| `POST` | `/ops/config`            | 更新运行时配置（需 Ops 鉴权）          |
| `POST` | `/ops/shutdown`          | 优雅停机（需 Ops 鉴权）                |
| `POST` | `/ops/restart`           | 重启服务（需 Ops 鉴权）                |

### Token-Plan 代理（需 `TOKEN_PLAN_ENABLED=true`，挂载于主应用）

| 方法   | 路径                                          | 说明                                   |
| ------ | --------------------------------------------- | -------------------------------------- |
| `POST` | `/token-plan/v1/chat/completions`             | 对话补全（透传，支持流式 SSE）         |
| `POST` | `/token-plan/anthropic/v1/messages`           | Anthropic Messages API（透传，支持流式 SSE） |
