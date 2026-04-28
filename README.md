# MiMo Proxy

小米 MiMo 的 OpenAI/Anthropic 兼容代理，通过虚拟模型 ID 自动注入深度思考、联网搜索、JSON 结构化输出能力。

## 核心价值

小米 MiMo API 需要额外参数才能启用某些能力，但大多数客户端无法发送这些参数。本代理将三个能力开关映射为虚拟模型名后缀，客户端只需选择模型，代理自动注入参数。

| 能力 | 后缀 | 自动注入的参数 |
| :--- | :--- | :--- |
| 深度思考 | `-thinking` | `"thinking": {"type": "enabled"}` |
| 联网搜索 | `-search` | `tools` 中加入 `web_search` |
| JSON 输出 | `-json` | `"response_format": {"type": "json_object"}` |

后缀可任意组合，如 `mimo-v2-flash-thinking-search`。每个真实模型生成 8 个虚拟模型，默认共 40 个。

## 快速开始

```bash
# 安装
git clone <repo> && cd mimo-proxy
pnpm install

# 配置
cp .env.example .env
# 编辑 .env，填写 MIMO_API_KEY

# 构建并启动
pnpm run build
pnpm start
```

服务默认监听 `http://0.0.0.0:3000`。

## 客户端配置

### OpenAI 兼容客户端

| 配置项 | 值 |
| :--- | :--- |
| Base URL | `http://localhost:3000/v1` |
| API Key | `PROXY_API_KEY` 的值（未设置则随意填写） |
| 模型 | 通过 `/v1/models` 获取，或手动输入如 `mimo-v2-pro-thinking-search` |

### Anthropic 兼容客户端

| 配置项 | 值 |
| :--- | :--- |
| Base URL | `http://localhost:3000/anthropic/v1` |
| API Key | `PROXY_API_KEY` 的值 |

### Token-Plan 透传

适用于小米 token-plan 计费方案，不做虚拟模型映射，直接使用真实模型名。

```dotenv
TOKEN_PLAN_ENABLED=true
TOKEN_PLAN_MIMO_API_KEY=your_key
```

| 配置项 | 值 |
| :--- | :--- |
| Base URL | `http://localhost:3000/token-plan/v1` |
| API Key | `TOKEN_PLAN_PROXY_API_KEY` 的值 |

## 功能模块

### 监控

访问 `http://localhost:3000/` 查看请求统计、费用、延迟等。支持 memory（默认）和 sqlite 两种存储后端。

```dotenv
MONITOR_STORAGE=sqlite
MONITOR_SQLITE_PATH=./data/monitor.db
```

### 调试

记录完整请求/响应体，仅存内存，进程重启清空。

```dotenv
DEBUG_ENABLED=true
```

访问 `http://localhost:3000/debug` 查看。

### Ops 运维界面

运行时配置管理、服务控制。设置密码启用：

```dotenv
OPS_PASSWORD=your_password
```

访问 `http://localhost:3000/ops`，支持修改日志级别、搜索参数、监控配置等。

## 配置参考

### 必填配置

| 环境变量 | 说明 |
| :--- | :--- |
| `MIMO_API_KEY` | 小米 MiMo API Key |

### 常用配置

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PROXY_API_KEY` | 空 | 代理鉴权 Key，留空不鉴权 |
| `PORT` | `3000` | 监听端口 |
| `MIMO_ENABLED_MODELS` | 全部 5 个模型 | 启用的模型列表（逗号分隔） |
| `LOG_LEVEL` | `info` | 日志级别 |

### Token-Plan 配置

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `TOKEN_PLAN_ENABLED` | `false` | 启用 token-plan 代理 |
| `TOKEN_PLAN_MIMO_API_KEY` | 回退到 `MIMO_API_KEY` | token-plan 上游 Key |
| `TOKEN_PLAN_PROXY_API_KEY` | 空 | token-plan 客户端鉴权 Key |

### 搜索配置

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `WEB_SEARCH_MAX_KEYWORD` | `3` | 最大关键词数 |
| `WEB_SEARCH_FORCE_SEARCH` | `true` | 强制开启搜索 |
| `WEB_SEARCH_LIMIT` | `3` | 每次返回网页数 |

### 存储与调试配置

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `MONITOR_STORAGE` | `memory` | 存储后端：`memory` / `sqlite` |
| `MONITOR_RETENTION_DAYS` | `30` | 数据保留天数 |
| `DEBUG_ENABLED` | `false` | 启用调试模式 |
| `OPS_PASSWORD` | 空 | Ops 界面密码，留空禁用 |

## 接口列表

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/health` | 健康检查 |
| `GET` | `/v1/models` | 虚拟模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI 对话补全 |
| `POST` | `/anthropic/v1/messages` | Anthropic 对话补全 |
| `GET` | `/monitor` | 监控页面 |
| `GET` | `/debug` | 调试页面 |
| `GET` | `/ops` | 运维界面 |

Token-Plan 接口挂载于 `/token-plan` 路径下，格式相同。

## 环境要求

- Node.js >= 24 LTS
- pnpm 10.x
