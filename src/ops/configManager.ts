import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { debugStore } from "../debug/store";
import { KEY_ALIASES, getFieldDef, CONFIG_FIELDS } from "./configSchema";

/**
 * 运行时配置管理器
 * 支持修改白名单内的配置项，并持久化到 .env 文件
 */
export class OpsConfigManager {
  private static writeLock = false;

  static readonly WRITABLE_KEYS: ReadonlySet<string> = new Set(
    CONFIG_FIELDS.map((f) => f.envKey)
  );

  private static readonly KEY_ALIASES: Readonly<Record<string, string>> = KEY_ALIASES;

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

  // NOTE: This mapping is intentionally manual. Each field lives at a different nested
  // path in the config object (e.g. config.webSearch.maxKeyword, config.monitor.flushIntervalMs)
  // and there is no generic way to derive the accessor from CONFIG_FIELDS alone.
  static getCurrentConfig(): Record<string, unknown> {
    return {
      logLevel: config.logLevel,

      webSearchMaxKeyword: config.webSearch.maxKeyword,
      webSearchForceSearch: config.webSearch.forceSearch,
      webSearchLimit: config.webSearch.limit,
      webSearchCountry: config.webSearch.userLocation.country,
      webSearchRegion: config.webSearch.userLocation.region,
      webSearchCity: config.webSearch.userLocation.city,

      monitorRetentionDays: config.monitor.retentionDays,
      monitorFlushIntervalMs: config.monitor.flushIntervalMs,
      monitorFlushBatchSize: config.monitor.flushBatchSize,
      monitorQueueMaxSize: config.monitor.queueMaxSize,

      upstreamTimeoutMs: config.upstream.timeout,

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

  static updateConfig(updates: Record<string, unknown>): { success: boolean; error?: string } {
    const validatedUpdates: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      const normalizedKey = this.normalizeUpdateKey(key);

      if (!normalizedKey || !this.WRITABLE_KEYS.has(normalizedKey)) {
        return {
          success: false,
          error: `Configuration key '${key}' is not allowed to be modified at runtime`,
        };
      }

      const validated = this.validateAndConvert(normalizedKey, value);
      if (validated.error) {
        return { success: false, error: validated.error };
      }
      validatedUpdates[normalizedKey] = validated.value!;
    }

    this.applyRuntimeUpdate(validatedUpdates);

    const persistResult = this.persistToEnv(validatedUpdates);
    if (!persistResult.success) {
      this.revertRuntimeUpdate(validatedUpdates);
      return persistResult;
    }

    return { success: true };
  }

  private static validateAndConvert(
    key: string,
    value: unknown
  ): { value?: string; error?: string } {
    const fieldDef = getFieldDef(key);
    if (!fieldDef) {
      return { error: `Unknown configuration key: ${key}` };
    }

    switch (fieldDef.type) {
      case "string":
        if (typeof value !== "string") {
          return { error: `${key} must be a string` };
        }
        if (fieldDef.enum) {
          if (!fieldDef.enum.includes(value)) {
            return { error: `${key} must be one of: ${fieldDef.enum.join(", ")}` };
          }
          return { value };
        }
        if (value.trim() === "") {
          return { error: `${key} must be a non-empty string` };
        }
        return { value: value.trim() };

      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value) || (fieldDef.min !== undefined && value < fieldDef.min)) {
          if (fieldDef.min === 1) {
            return { error: `${key} must be a positive number` };
          }
          if (fieldDef.min !== undefined) {
            return { error: `${key} must be a number >= ${fieldDef.min}` };
          }
          return { error: `${key} must be a number` };
        }
        return { value: String(Math.trunc(value)) };
      }

      case "boolean":
        if (typeof value !== "boolean") {
          return { error: `${key} must be a boolean` };
        }
        return { value: String(value) };

      default:
        return { error: `Unsupported type for key: ${key}` };
    }
  }

  private static normalizeUpdateKey(key: string): string | null {
    if (this.WRITABLE_KEYS.has(key)) {
      return key;
    }

    return this.KEY_ALIASES[key] || null;
  }

  // NOTE: This mapping is intentionally manual. Each field has a different config path
  // and type-specific parsing logic (e.g. UPSTREAM_TIMEOUT_MS updates both config.upstream
  // and config.tokenPlan, DEBUG_MAX_RECORDS also calls debugStore.setMaxRecords).
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

  private static revertRuntimeUpdate(_updates: Record<string, string>): void {
    // 当前实现中，我们直接修改 config 对象
    // 完整回滚需要保存旧值，这里简化处理 - 重新加载环境变量
    logger.warn("Runtime config update failed, manual restart may be needed to restore");
  }

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
        const existingPattern = new RegExp(`^${key}=.*$`, "gm");
        const newLine = `${key}=${value}`;

        if (existingPattern.test(envContent)) {
          envContent = envContent.replace(existingPattern, newLine);
        } else {
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
