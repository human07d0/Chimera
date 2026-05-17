# Chimera

一个 LLM 代理服务，把 OpenAI 和 Anthropic 格式的请求转发给不同上游。

## 特性

- **YAML 驱动配置** — 提供商和模型通过 YAML 文件声明，无硬编码
- **SSE 流式透传** — 逐 chunk 转发，无全量缓冲
- **内置监控** — 请求记录、token 用量追踪、memory/SQLite 存储
- **调试模式** — 完整请求/响应录制，便于排查问题
- **运维界面** — 内置 Web UI 查看监控数据和调试信息

## 快速开始

```bash
# 安装
npm install -g chimeraproxy

# 配置
cp .env.example .env
# 编辑 .env 填入 API Key

# 启动
chimera
```

服务默认运行在 `http://localhost:3000`。

## 文档

- [安装手册](INSTALL.md) — npm / zip / 源码安装及后台运行
- [架构概览](ARCHITECTURE.md)
