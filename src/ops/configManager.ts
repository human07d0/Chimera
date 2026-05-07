import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { debugStore } from "../debug/store";

/**
 * 运行时配置管理器
 * 支持修改白名单内的配置项，并持久化到 .env 文件
 */
export class OpsConfigManager {
  private static writeLock = false;

  /**
   * 可运行时修改的配置项白名单
   */
  static readonly WRITABLE_KEYS: ReadonlySet<string> = new Set([
    "LOG_LEVEL",
    "WEB_SEARCH_MAX_KEYWORD",
    "WEB_SEARCH_FORCE_SEARCH",
    "WEB_SEARCH_LIMIT",
    "WEB_SEARCH_COUNTRY",
    "WEB_SEARCH_REGION",
    "WEB_SEARCH_CITY",
    "MONITOR_FLUSH_INTERVAL_MS",
    "MONITOR_RETENTION_DAYS",
    "UPSTREAM_TIMEOUT_MS",
    "MONITOR_FLUSH_BATCH_SIZE",
    "MONITOR_QUEUE_MAX_SIZE",
    "DEBUG_MAX_RECORDS",
    "DEBUG_MAX_BODY_SIZE",
    "DEBUG_MAX_MEDIA_BYTES",
  ]);

  private static readonly KEY_ALIASES: Readonly<Record<string, string>> = {
    logLevel: "LOG_LEVEL",
    webSearchMaxKeyword: "WEB_SEARCH_MAX_KEYWORD",
    webSearchForceSearch: "WEB_SEARCH_FORCE_SEARCH",
    webSearchLimit: "WEB_SEARCH_LIMIT",
    webSearchCountry: "WEB_SEARCH_COUNTRY",
    webSearchRegion: "WEB_SEARCH_REGION",
    webSearchCity: "WEB_SEARCH_CITY",
    monitorFlushIntervalMs: "MONITOR_FLUSH_INTERVAL_MS",
    monitorRetentionDays: "MONITOR_RETENTION_DAYS",
    upstreamTimeoutMs: "UPSTREAM_TIMEOUT_MS",
    monitorFlushBatchSize: "MONITOR_FLUSH_BATCH_SIZE",
    monitorQueueMaxSize: "MONITOR_QUEUE_MAX_SIZE",
    debugMaxRecords: "DEBUG_MAX_RECORDS",
    debugMaxBodySize: "DEBUG_MAX_BODY_SIZE",
    debugMaxMediaBytes: "DEBUG_MAX_MEDIA_BYTES",
  };

  /**
   * 敏感配置项（只读，不写入 .env）
   */
  static readonly SENSITIVE_KEYS: ReadonlySet<string> = new Set([
    "MIMO_API_KEY",
    "PROXY_API_KEY",
    "OPS_PASSWORD",
    "TOKEN_PLAN_PROXY_API_KEY",
    "TOKEN_PLAN_MIMO_API_KEY",
  ]);

  /**
   * 获取当前运行时配置（仅白名单项 + 敏感项的值）
   */
  static getCurrentConfig(): Record<string, unknown> {
    return {
      // 日志级别
      logLevel: config.logLevel,

      // Web Search
      webSearchMaxKeyword: config.webSearch.maxKeyword,
      webSearchForceSearch: config.webSearch.forceSearch,
      webSearchLimit: config.webSearch.limit,
      webSearchCountry: config.webSearch.userLocation.country,
      webSearchRegion: config.webSearch.userLocation.region,
      webSearchCity: config.webSearch.userLocation.city,

      // Monitor
      monitorRetentionDays: config.monitor.retentionDays,
      monitorFlushIntervalMs: config.monitor.flushIntervalMs,
      monitorFlushBatchSize: config.monitor.flushBatchSize,
      monitorQueueMaxSize: config.monitor.queueMaxSize,

      // Upstream
      upstreamTimeoutMs: config.upstream.timeout,

      // Debug
      debugMaxRecords: config.debug.maxRecords,
      debugMaxBodySize: config.debug.maxBodySize,
      debugMaxMediaBytes: config.debug.maxMediaBytes,

      // 敏感字段（仅显示是否已配置，不暴露实际值）
      sensitive: {
        hasMimoApiKey: !!config.mimoApiKey,
        hasProxyApiKey: !!config.proxyApiKey,
        hasOpsPassword: !!config.opsPassword,
        hasTokenPlanProxyApiKey: !!config.tokenPlan.proxyApiKey,
        hasTokenPlanMimoApiKey: !!config.tokenPlan.mimoApiKey,
      },
    };
  }

  /**
   * 更新运行时配置（仅白名单项）
   * @param updates 要更新的配置项
   * @returns 更新后的配置
   */
  static updateConfig(updates: Record<string, unknown>): { success: boolean; error?: string } {
    const validatedUpdates: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      const normalizedKey = this.normalizeUpdateKey(key);

      // 检查是否在白名单中
      if (!normalizedKey || !this.WRITABLE_KEYS.has(normalizedKey)) {
        return {
          success: false,
          error: `Configuration key '${key}' is not allowed to be modified at runtime`,
        };
      }

      // 验证并转换值
      const validated = this.validateAndConvert(normalizedKey, value);
      if (validated.error) {
        return { success: false, error: validated.error };
      }
      validatedUpdates[normalizedKey] = validated.value!;
    }

    // 应用到运行时配置
    this.applyRuntimeUpdate(validatedUpdates);

    // 持久化到 .env
    const persistResult = this.persistToEnv(validatedUpdates);
    if (!persistResult.success) {
      // 回滚内存状态
      this.revertRuntimeUpdate(validatedUpdates);
      return persistResult;
    }

    return { success: true };
  }

  /**
   * 验证并转换配置值
   */
  private static validateAndConvert(
    key: string,
    value: unknown
  ): { value?: string; error?: string } {
    switch (key) {
      case "LOG_LEVEL":
        if (typeof value !== "string" || !["error", "warn", "info", "debug"].includes(value)) {
          return { error: "LOG_LEVEL must be one of: error, warn, info, debug" };
        }
        return { value };

      case "WEB_SEARCH_MAX_KEYWORD":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "WEB_SEARCH_MAX_KEYWORD must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "WEB_SEARCH_FORCE_SEARCH":
        if (typeof value !== "boolean") {
          return { error: "WEB_SEARCH_FORCE_SEARCH must be a boolean" };
        }
        return { value: String(value) };

      case "WEB_SEARCH_LIMIT":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "WEB_SEARCH_LIMIT must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "WEB_SEARCH_COUNTRY":
      case "WEB_SEARCH_REGION":
      case "WEB_SEARCH_CITY":
        if (typeof value !== "string" || value.trim() === "") {
          return { error: `${key} must be a non-empty string` };
        }
        return { value: value.trim() };

      case "MONITOR_FLUSH_INTERVAL_MS":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 50) {
          return { error: "MONITOR_FLUSH_INTERVAL_MS must be a number >= 50" };
        }
        return { value: String(Math.trunc(value)) };

      case "MONITOR_RETENTION_DAYS":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "MONITOR_RETENTION_DAYS must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "UPSTREAM_TIMEOUT_MS":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1000) {
          return { error: "UPSTREAM_TIMEOUT_MS must be a number >= 1000" };
        }
        return { value: String(Math.trunc(value)) };

      case "MONITOR_FLUSH_BATCH_SIZE":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "MONITOR_FLUSH_BATCH_SIZE must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "MONITOR_QUEUE_MAX_SIZE":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "MONITOR_QUEUE_MAX_SIZE must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "DEBUG_MAX_RECORDS":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
          return { error: "DEBUG_MAX_RECORDS must be a positive number" };
        }
        return { value: String(Math.trunc(value)) };

      case "DEBUG_MAX_BODY_SIZE":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1024) {
          return { error: "DEBUG_MAX_BODY_SIZE must be a number >= 1024" };
        }
        return { value: String(Math.trunc(value)) };

      case "DEBUG_MAX_MEDIA_BYTES":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1024) {
          return { error: "DEBUG_MAX_MEDIA_BYTES must be a number >= 1024" };
        }
        return { value: String(Math.trunc(value)) };

      default:
        return { error: `Unknown configuration key: ${key}` };
    }
  }

  private static normalizeUpdateKey(key: string): string | null {
    if (this.WRITABLE_KEYS.has(key)) {
      return key;
    }

    return this.KEY_ALIASES[key] || null;
  }

  /**
   * 应用运行时配置更新
   */
  private static applyRuntimeUpdate(updates: Record<string, string>): void {
    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case "LOG_LEVEL":
          (config as Record<string, unknown>).logLevel = value as typeof config.logLevel;
          break;

        case "WEB_SEARCH_MAX_KEYWORD":
          config.webSearch.maxKeyword = parseInt(value, 10);
          break;

        case "WEB_SEARCH_FORCE_SEARCH":
          config.webSearch.forceSearch = value === "true";
          break;

        case "WEB_SEARCH_LIMIT":
          config.webSearch.limit = parseInt(value, 10);
          break;

        case "WEB_SEARCH_COUNTRY":
          config.webSearch.userLocation.country = value;
          break;

        case "WEB_SEARCH_REGION":
          config.webSearch.userLocation.region = value;
          break;

        case "WEB_SEARCH_CITY":
          config.webSearch.userLocation.city = value;
          break;

        case "MONITOR_FLUSH_INTERVAL_MS":
          config.monitor.flushIntervalMs = parseInt(value, 10);
          break;

        case "MONITOR_RETENTION_DAYS":
          config.monitor.retentionDays = parseInt(value, 10);
          break;

        case "UPSTREAM_TIMEOUT_MS":
          config.upstream.timeout = parseInt(value, 10);
          config.tokenPlan.timeout = parseInt(value, 10);
          break;

        case "MONITOR_FLUSH_BATCH_SIZE":
          config.monitor.flushBatchSize = parseInt(value, 10);
          break;

        case "MONITOR_QUEUE_MAX_SIZE":
          config.monitor.queueMaxSize = parseInt(value, 10);
          break;

        case "DEBUG_MAX_RECORDS":
          config.debug.maxRecords = parseInt(value, 10);
          debugStore.setMaxRecords(config.debug.maxRecords);
          break;

        case "DEBUG_MAX_BODY_SIZE":
          config.debug.maxBodySize = parseInt(value, 10);
          break;

        case "DEBUG_MAX_MEDIA_BYTES":
          config.debug.maxMediaBytes = parseInt(value, 10);
          break;
      }
    }

    logger.info("Runtime config updated", { updates: Object.keys(updates) });
  }

  /**
   * 回滚运行时配置（写入失败时调用）
   */
  private static revertRuntimeUpdate(_updates: Record<string, string>): void {
    // 当前实现中，我们直接修改 config 对象
    // 完整回滚需要保存旧值，这里简化处理 - 重新加载环境变量
    logger.warn("Runtime config update failed, manual restart may be needed to restore");
  }

  /**
   * 持久化配置到 .env 文件
   */
  private static persistToEnv(
    updates: Record<string, string>
  ): { success: boolean; error?: string } {
    if (this.writeLock) {
      return { success: false, error: "Another write operation is in progress" };
    }

    this.writeLock = true;

    try {
      const envPath = path.resolve(process.cwd(), ".env");

      if (!fs.existsSync(envPath)) {
        this.writeLock = false;
        return { success: false, error: ".env file not found" };
      }

      let envContent = fs.readFileSync(envPath, "utf-8");

      for (const [key, value] of Object.entries(updates)) {
        // 使用正则替换已存在的配置项
        const existingPattern = new RegExp(`^${key}=.*$`, "gm");
        const newLine = `${key}=${value}`;

        if (existingPattern.test(envContent)) {
          // 替换现有值
          envContent = envContent.replace(existingPattern, newLine);
        } else {
          // 追加新配置项
          envContent += `\n${newLine}`;
        }
      }

      fs.writeFileSync(envPath, envContent, "utf-8");
      logger.info("Config persisted to .env", { updates: Object.keys(updates) });

      this.writeLock = false;
      return { success: true };
    } catch (error) {
      this.writeLock = false;
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to persist config to .env", { error: message });
      return { success: false, error: `Failed to write .env: ${message}` };
    }
  }
}
