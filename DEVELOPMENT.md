# MiMo Proxy 开发操作规程

本文档描述 MiMo Proxy 项目的开发流程、规范和最佳实践。

## 目录

- [开发环境设置](#开发环境设置)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [测试](#测试)
- [构建与部署](#构建与部署)
- [故障排除](#故障排除)

## 开发环境设置

### 前置要求

- Node.js >= 24 LTS
- pnpm 10.x（推荐）
- Git
- 代码编辑器（推荐 VS Code）

### 安装步骤

1. **克隆项目**

```bash
git clone https://github.com/Yevpatoria/mimo-proxy.git
cd mimo-proxy
```

2. **安装依赖**

```bash
pnpm install
```

3. **配置环境变量**

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入必要的配置：

```dotenv
MIMO_API_KEY=your_api_key_here
LOG_LEVEL=debug
MONITOR_STORAGE=memory
```

4. **启动开发服务器**

```bash
pnpm run dev
```

服务将运行在 `http://localhost:3000`

## 项目结构

```
mimo-proxy/
├── src/                          # 源代码
│   ├── index.ts                  # 入口文件
│   ├── server.ts                 # Express 服务器配置
│   ├── config.ts                 # 配置管理
│   ├── shutdownManager.ts        # 优雅停机管理
│   ├── routes/                   # API 路由
│   │   ├── chat.ts              # /v1/chat/completions
│   │   ├── anthropic.ts         # /anthropic/v1/messages
│   │   └── models.ts            # /v1/models
│   ├── proxy/                    # 代理核心
│   │   ├── transformer.ts       # 请求/响应转换
│   │   └── streaming.ts         # 流式处理
│   ├── monitor/                  # 监控模块
│   │   ├── index.ts             # 监控初始化
│   │   ├── middleware.ts        # 监控中间件
│   │   ├── routes.ts            # 监控路由
│   │   └── storage/             # 存储实现
│   │       ├── index.ts         # 接口定义
│   │       ├── memory.ts        # 内存存储
│   │       ├── sqlite.ts        # SQLite 存储
│   │       ├── factory.ts       # 存储工厂
│   │       └── worker.ts        # 异步写入器
│   ├── ops/                      # 运维界面
│   │   ├── index.ts             # Ops 路由
│   │   ├── middleware.ts        # Ops 中间件
│   │   ├── routes.ts            # Ops API
│   │   ├── configManager.ts     # 配置管理
│   │   ├── watcher.ts           # 进程监控
│   │   ├── watcher-child.js     # Watcher 子进程
│   │   └── frontend/            # Ops 前端
│   │       ├── index.html
│   │       ├── main.ts
│   │       ├── router.ts
│   │       ├── store.ts
│   │       ├── api.ts
│   │       ├── styles.css
│   │       ├── components/      # UI 组件
│   │       └── views/           # 页面视图
│   ├── models/                   # 模型预设
│   │   └── presets.ts
│   └── utils/                    # 工具函数
│       └── logger.ts            # 日志工具
├── scripts/                      # 脚本
│   ├── install-windows.bat      # Windows 安装脚本
│   └── install-linux.sh         # Linux 安装脚本
├── public/                       # 静态资源
├── dist/                         # 构建输出
├── dist-bun/                     # Bun 构建输出
├── data/                         # 数据目录
├── package.json                  # 项目配置
├── tsconfig.json                 # TypeScript 配置
├── vite.config.ts                # Vite 配置
├── vitest.config.ts              # 测试配置
├── .env.example                  # 环境变量示例
├── README.md                     # 项目说明
├── ARCHITECTURE.md               # 架构文档
├── ANDROID_INSTALL.md            # Android 安装手册
└── DEVELOPMENT.md                # 本文档
```

## 开发流程

### 1. 创建功能分支

```bash
git checkout -b feature/your-feature-name
```

### 2. 开发

- 编写代码
- 添加测试
- 更新文档

### 3. 代码检查

```bash
# 类型检查
pnpm run typecheck

# 代码格式化（如果配置了）
pnpm run format

# 代码检查（如果配置了）
pnpm run lint
```

### 4. 测试

```bash
# 运行所有测试
pnpm test

# 运行测试（监视模式）
pnpm run test:watch

# 运行特定测试
pnpm test -- --grep "test name"
```

### 5. 构建

```bash
# 标准构建
pnpm run build

# Bun 构建
pnpm run bun:build
```

### 6. 提交代码

```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

### 7. 创建 Pull Request

在 GitHub 上创建 Pull Request，等待代码审查。

## 代码规范

### TypeScript 规范

1. **使用严格模式**

```typescript
// tsconfig.json 中已启用
"strict": true
```

2. **类型定义**

```typescript
// 好的示例
interface User {
  id: string;
  name: string;
  email: string;
}

function getUser(id: string): User | null {
  // ...
}

// 避免使用 any
// 不好的示例
function processData(data: any): any {
  // ...
}
```

3. **异步处理**

```typescript
// 使用 async/await
async function fetchData(): Promise<Data> {
  const response = await fetch(url);
  return response.json();
}

// 错误处理
async function safeOperation(): Promise<Result> {
  try {
    const result = await riskyOperation();
    return { success: true, data: result };
  } catch (error) {
    logger.error('Operation failed', { error });
    return { success: false, error: error.message };
  }
}
```

### 命名规范

1. **文件命名**
   - 使用 kebab-case：`my-component.ts`
   - 测试文件：`my-component.test.ts`
   - 类型定义：`my-types.ts`

2. **变量和函数命名**
   - 使用 camelCase：`userName`, `getUserById`
   - 常量使用 UPPER_SNAKE_CASE：`MAX_RETRY_COUNT`

3. **类和接口命名**
   - 使用 PascalCase：`UserService`, `MonitorStorage`

### 注释规范

```typescript
/**
 * 获取用户信息
 * @param userId - 用户 ID
 * @returns 用户对象或 null
 */
function getUser(userId: string): User | null {
  // 实现...
}

// 行内注释
const timeout = 5000; // 5 秒超时
```

### 错误处理

```typescript
// 使用自定义错误类
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 抛出有意义的错误
function validateApiKey(key: string): void {
  if (!key) {
    throw new AppError(
      'API key is required',
      'MISSING_API_KEY',
      400
    );
  }
}
```

### 日志规范

```typescript
import { logger } from './utils/logger';

// 使用结构化日志
logger.info('User logged in', {
  userId: user.id,
  ip: req.ip,
});

// 错误日志
logger.error('Failed to process request', {
  error: error.message,
  stack: error.stack,
  requestId: req.id,
});
```

## 测试

### 测试结构

```
src/
├── monitor/
│   └── storage/
│       ├── sqlite.ts
│       └── sqlite.test.ts  # 测试文件
```

### 编写测试

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from './sqlite';

describe('SqliteStorage', () => {
  let storage: SqliteStorage;

  beforeEach(async () => {
    await SqliteStorage.initSqlModule();
    storage = new SqliteStorage(':memory:');
    storage.init();
  });

  it('should append and query events', () => {
    const event = {
      request_id: 'test-1',
      ts_start: Date.now(),
      ts_end: Date.now(),
      latency_ms: 100,
      path: '/v1/chat/completions',
      method: 'POST',
      status_code: 200,
      model_requested: 'mimo-v2-flash',
      model_upstream: 'mimo-v2-flash',
      stream: false,
      chunks: 0,
      bytes_out: 1024,
      first_token_ms: null,
      input_tokens: 10,
      output_tokens: 20,
      cached_prompt_tokens: 0,
      cost: 0.001,
      error_type: null,
    };

    storage.append(event);
    const results = storage.query({ days: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].request_id).toBe('test-1');
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定文件的测试
pnpm test src/monitor/storage/sqlite.test.ts

# 生成覆盖率报告
pnpm test --coverage
```

## 构建与部署

### 标准构建

```bash
pnpm run build
```

构建产物在 `dist/` 目录。

### Bun 构建

```bash
pnpm run bun:build
```

构建产物在 `dist-bun/` 目录，为单文件可执行文件。

### 环境变量配置

生产环境推荐配置：

```dotenv
# 必需
MIMO_API_KEY=your_production_key

# 推荐
PROXY_API_KEY=your_proxy_key
LOG_LEVEL=info
MONITOR_STORAGE=sqlite
MONITOR_SQLITE_PATH=./data/monitor.db
OPS_PASSWORD=strong_password_here
```

## 故障排除

### 常见问题

1. **TypeScript 编译错误**

```bash
pnpm run typecheck
```

查看详细错误信息。

2. **依赖问题**

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

3. **SQLite 问题**

如有问题：

```bash
# 切换到内存模式
echo "MONITOR_STORAGE=memory" >> .env
```

### 跨平台打包

项目提供了安装脚本和手册：

- **Windows**：运行 `scripts/install-windows.bat`
- **Linux**：运行 `scripts/install-linux.sh`（需要先赋予执行权限）
- **Android (Termux)**：参考 `ANDROID_INSTALL.md` 手册

Bun 构建命令：
```bash
pnpm run bun:build
```

构建产物在 `dist-bun/` 目录，为单文件可执行文件。

4. **端口占用**

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>
```

### 调试技巧

1. **启用调试日志**

```bash
LOG_LEVEL=debug pnpm start
```

2. **使用 Node.js 调试器**

```bash
node --inspect dist/index.js
```

然后在 Chrome 中访问 `chrome://inspect`

3. **使用 VS Code 调试**

在 `.vscode/launch.json` 中配置：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "program": "${workspaceFolder}/src/index.ts",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "runtimeArgs": ["-r", "ts-node/register"]
    }
  ]
}
```

## 性能优化

1. **使用 Bun 构建**

Bun 构建的单文件版本启动更快，内存占用更小。

2. **监控数据优化**

```dotenv
# 减少保留天数
MONITOR_RETENTION_DAYS=7

# 使用内存模式
MONITOR_STORAGE=memory
```

3. **日志优化**

生产环境使用 `warn` 或 `error` 级别：

```dotenv
LOG_LEVEL=warn
```

## 安全考虑

1. **API Key 管理**
   - 不要提交 `.env` 文件
   - 使用强密码
   - 定期轮换密钥

2. **网络安全**
   - 生产环境使用 HTTPS
   - 配置防火墙规则
   - 仅暴露必要端口

3. **数据安全**
   - 监控数据不包含敏感信息
   - 定期备份数据
   - 加密敏感配置

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

### Commit 规范

使用 Conventional Commits：

```
feat: add new feature
fix: fix bug
docs: update documentation
style: format code
refactor: refactor code
test: add tests
chore: update dependencies
```

