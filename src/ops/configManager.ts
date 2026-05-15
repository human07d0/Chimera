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
type Snapshot = Record<string, unknown>;

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
  ]);

  // NOTE: This mapping is intentionally manual. Each field lives at a different nested
  // path in the config object (e.g. config.monitor.flushIntervalMs)
  // and there is no generic way to derive the accessor from CONFIG_FIELDS alone.
  static getCurrentConfig(): Record<string, unknown> {
    return {
      logLevel: config.logLevel,

      monitorRetentionDays: config.monitor.retentionDays,
      monitorFlushIntervalMs: config.monitor.flushIntervalMs,
      monitorFlushBatchSize: config.monitor.flushBatchSize,
      monitorQueueMaxSize: config.monitor.queueMaxSize,

      debugMaxRecords: config.debug.maxRecords,
      debugMaxBodySize: config.debug.maxBodySize,
      debugMaxMediaBytes: config.debug.maxMediaBytes,
      debugEnabled: config.debug.enabled,

      sensitive: {
        // MIMO_API_KEY is not in config.ts (provider-level config), read env directly
        hasMimoApiKey: !!process.env["MIMO_API_KEY"],
        hasProxyApiKey: !!config.proxyApiKey,
        hasOpsPassword: !!config.opsPassword,
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

    const snapshot = this.snapshotCurrentValues(validatedUpdates);
    try {
      this.applyRuntimeUpdate(validatedUpdates);
    } catch (err) {
      this.revertRuntimeUpdate(snapshot);
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Runtime config update failed, reverted", { error: message });
      return { success: false, error: `Runtime update failed: ${message}` };
    }

    const persistResult = this.persistToEnv(validatedUpdates);
    if (!persistResult.success) {
      this.revertRuntimeUpdate(snapshot);
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
  // and type-specific parsing logic (e.g. DEBUG_MAX_RECORDS also calls debugStore.setMaxRecords).
  private static applyRuntimeUpdate(updates: Record<string, string>): void {
    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case "LOG_LEVEL":
          (config as Record<string, unknown>).logLevel = value as typeof config.logLevel;
          break;

        case "MONITOR_FLUSH_INTERVAL_MS":
          config.monitor.flushIntervalMs = parseInt(value, 10);
          break;

        case "MONITOR_RETENTION_DAYS":
          config.monitor.retentionDays = parseInt(value, 10);
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

        case "DEBUG_ENABLED":
          config.debug.enabled = value === "true";
          break;
      }
    }

    logger.info("Runtime config updated", { updates: Object.keys(updates) });
  }

  private static snapshotCurrentValues(updates: Record<string, string>): Snapshot {
    const snapshot: Snapshot = {};

    for (const key of Object.keys(updates)) {
      switch (key) {
        case "LOG_LEVEL":
          snapshot[key] = config.logLevel;
          break;

        case "MONITOR_FLUSH_INTERVAL_MS":
          snapshot[key] = config.monitor.flushIntervalMs;
          break;

        case "MONITOR_RETENTION_DAYS":
          snapshot[key] = config.monitor.retentionDays;
          break;

        case "MONITOR_FLUSH_BATCH_SIZE":
          snapshot[key] = config.monitor.flushBatchSize;
          break;

        case "MONITOR_QUEUE_MAX_SIZE":
          snapshot[key] = config.monitor.queueMaxSize;
          break;

        case "DEBUG_MAX_RECORDS":
          snapshot[key] = config.debug.maxRecords;
          break;

        case "DEBUG_MAX_BODY_SIZE":
          snapshot[key] = config.debug.maxBodySize;
          break;

        case "DEBUG_MAX_MEDIA_BYTES":
          snapshot[key] = config.debug.maxMediaBytes;
          break;

        case "DEBUG_ENABLED":
          snapshot[key] = config.debug.enabled;
          break;
      }
    }

    return snapshot;
  }

  private static revertRuntimeUpdate(snapshot: Snapshot): void {
    for (const [key, value] of Object.entries(snapshot)) {
      switch (key) {
        case "LOG_LEVEL":
          (config as Record<string, unknown>).logLevel = value as typeof config.logLevel;
          break;

        case "MONITOR_FLUSH_INTERVAL_MS":
          config.monitor.flushIntervalMs = value as number;
          break;

        case "MONITOR_RETENTION_DAYS":
          config.monitor.retentionDays = value as number;
          break;

        case "MONITOR_FLUSH_BATCH_SIZE":
          config.monitor.flushBatchSize = value as number;
          break;

        case "MONITOR_QUEUE_MAX_SIZE":
          config.monitor.queueMaxSize = value as number;
          break;

        case "DEBUG_MAX_RECORDS":
          config.debug.maxRecords = value as number;
          debugStore.setMaxRecords(config.debug.maxRecords);
          break;

        case "DEBUG_MAX_BODY_SIZE":
          config.debug.maxBodySize = value as number;
          break;

        case "DEBUG_MAX_MEDIA_BYTES":
          config.debug.maxMediaBytes = value as number;
          break;

        case "DEBUG_ENABLED":
          config.debug.enabled = value as boolean;
          break;
      }
    }

    logger.warn("Runtime config reverted after persist failure", { keys: Object.keys(snapshot) });
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
