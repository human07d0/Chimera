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

