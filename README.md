# MiMo Proxy

小米 MiMo 提供 OpenAI API 兼容 API，但有三个使用时需要额外参数开启的能力：

| 能力            | 需要传递的参数                               |
| --------------- | -------------------------------------------- |
| 深度思考        | `"thinking": {"type": "enabled"}`            |
| 联网搜索        | `tools` 中加入 `type: "web_search"` 对象     |
| JSON 结构化输出 | `"response_format": {"type": "json_object"}` |

大多数 OpenAI 兼容客户端（Cherry Studio、Open WebUI、Cursor 等）无法发送这些额外参数。

本代理将这三个开关的 **2³ = 8 种排列组合**映射为“虚拟模型 ID”。
针对每个启用的真实模型都会生成 8 个虚拟模型，因此在默认配置下（`flash + pro + omni` 全开）一共会暴露 **24 个虚拟模型**。
客户端只需在 `model` 字段中选择对应的虚拟模型名，代理自动注入所需参数并透传其余所有参数（`stream`、`temperature`、`tools` 函数调用等）。

## 支持的虚拟模型

代理支持以下真实模型（接口格式一致）：

- `mimo-v2-flash`
- `mimo-v2-pro`
- `mimo-v2-omni`

默认会对以上三个模型全部开启虚拟映射；你也可以通过 `.env` 的 `MIMO_ENABLED_MODELS` 控制启用哪些真实模型。

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

> 使用 pnpm 时，本项目已在 `pnpm-workspace.yaml` 显式允许 `sqlite3` 原生构建（`allowBuilds.sqlite3=true`）。


### Termux 安装（Android）

> 适用于 `MONITOR_STORAGE=sqlite` 场景；已迁移到 `sqlite3 + sqlite`，不再依赖 `better-sqlite3`。

```bash
pkg update && pkg upgrade
pkg install nodejs-lts python python-setuptools make clang pkg-config sqlite

cd mimo-proxy
pnpm install
pnpm run build
```

如需使用 sqlite 持久化，建议显式设置：

```dotenv
MONITOR_STORAGE=sqlite
MONITOR_SQLITE_PATH=./data/monitor.db
```

常见问题：
- `sqlite3` 编译失败：先确认已安装 `python python-setuptools make clang pkg-config`，再删除 `node_modules` 后重装。
- 数据目录权限问题：确保当前目录可写，必要时手动创建 `./data`。
- 若需快速恢复服务：临时切换 `MONITOR_STORAGE=memory`。
- 可手动执行 `pnpm run check:native:sqlite3` 检查 sqlite3 原生绑定是否就绪。


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
pnpm run build
pnpm start
# 或开发环境：
# pnpm run dev
```

当 `MONITOR_STORAGE=sqlite` 时，`pnpm start` 会先执行 `check:native:sqlite3` 自检，若缺少 sqlite3 原生绑定会直接报错并给出修复指引。

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

## 监控与费用统计（memory / sqlite）

代理内置监控页面，默认采集 `/v1/chat/completions` 的**请求级元信息**（不落盘 prompt/response 原文）：

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

### Docker 运行注意事项

- 当前监控持久化实现为 `sqlite3 + sqlite`（异步驱动）。
- 使用 sqlite 模式时建议挂载数据目录（例如 `./data:/app/data`），避免容器重建导致监控数据丢失。
- 若容器内原生模块安装失败，可优先检查镜像架构与 Node 版本一致性。

## 已验证环境

以下组合已通过实际测试：

| 项目 | 版本 |
| ---- | ---- |
| Node.js | 24 LTS |
| pnpm | 10.32.x |
| Express | 5.2.x |
| sqlite3 | 6.0.x |
| dotenv | 17.x |
| 平台 | Windows / Termux Android arm64 |
| Python | 3.13 + setuptools |
| 构建工具 | clang / make / pkg-config |

> **注意**：首次安装时 `sqlite3` 原生模块需要本地编译，耗时较长属于正常现象。

## 配置参考

| 环境变量                  | 必填  | 默认值                       | 说明                                          |
| ------------------------- | :---: | ---------------------------- | --------------------------------------------- |
| `MIMO_API_KEY`            |   ✅   | —                            | 小米 MiMo API Key                             |
| `PROXY_API_KEY`           |   ❌   | 空                           | 访问代理时的鉴权 Key，留空则不启用鉴权        |
| `PORT`                    |   ❌   | `3000`                       | 服务监听端口                                  |
| `HOST`                    |   ❌   | `0.0.0.0`                    | 服务监听地址                                  |
| `MIMO_BASE_URL`           |   ❌   | `https://api.xiaomimimo.com` | 上游 API 地址                                 |
| `MIMO_ENABLED_MODELS`     |   ❌   | `mimo-v2-flash,mimo-v2-pro,mimo-v2-omni` | 启用的真实模型列表（逗号分隔，可选：`mimo-v2-flash` / `mimo-v2-pro` / `mimo-v2-omni`） |
| `UPSTREAM_TIMEOUT_MS`     |   ❌   | `120000`                     | 上游请求超时（毫秒）                          |
| `WEB_SEARCH_MAX_KEYWORD`  |   ❌   | `3`                          | 联网搜索最大关键词数量                        |
| `WEB_SEARCH_FORCE_SEARCH` |   ❌   | `true`                       | 是否强制开启搜索能力                          |
| `WEB_SEARCH_LIMIT`        |   ❌   | `3`                          | 每次搜索返回网页数量                          |
| `WEB_SEARCH_COUNTRY`      |   ❌   | `China`                      | 搜索地理位置 - 国家                           |
| `WEB_SEARCH_REGION`       |   ❌   | `Beijing`                    | 搜索地理位置 - 省份                           |
| `WEB_SEARCH_CITY`         |   ❌   | `Beijing`                    | 搜索地理位置 - 城市                           |
| `MONITOR_STORAGE`         |   ❌   | `memory`                    | Monitor 存储后端：`memory` / `sqlite`                 |
| `MONITOR_SQLITE_PATH`     |   ❌   | `./data/monitor.db`         | SQLite 文件路径（仅 `MONITOR_STORAGE=sqlite` 生效）   |
| `MONITOR_RETENTION_DAYS`  |   ❌   | `30`                        | 监控数据保留天数（定时清理）                         |
| `MONITOR_FLUSH_INTERVAL_MS` | ❌   | `200`                       | 异步写入队列定时 flush 间隔（毫秒）                   |
| `MONITOR_FLUSH_BATCH_SIZE` |  ❌   | `100`                       | 异步写入队列单次批量大小                              |
| `MONITOR_QUEUE_MAX_SIZE`  |   ❌   | `10000`                     | 异步队列最大长度，超限后丢弃并记录计数               |
| `LOG_LEVEL`               |   ❌   | `info`                      | 日志级别：`error` / `warn` / `info` / `debug` |

## 接口列表

| 方法   | 路径                   | 说明                       |
| ------ | ---------------------- | -------------------------- |
| `GET`  | `/health`              | 健康检查                   |
| `GET`  | `/v1/models`           | 获取所有虚拟模型列表       |
| `GET`  | `/v1/models/:id`       | 获取单个虚拟模型信息       |
| `POST` | `/v1/chat/completions` | 对话补全（支持流式 SSE）   |
| `GET`  | `/monitor`             | 监控页面（最近 3 天调用）  |
| `GET`  | `/monitor/stats`       | 监控统计数据（JSON）                |
| `GET`  | `/monitor/calls`       | 监控明细数据（JSON）                |
| `POST` | `/monitor/prune`       | 手动清理历史数据（默认仅 dev 或鉴权） |
