import "dotenv/config";

function warnConfig(message: string): void {
  console.warn(`[config] ${message}`);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function optionalBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return value.toLowerCase() === "true";
}

function optionalEnumEnv<T extends string>(
  name: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const value = process.env[name];
  if (!value) return defaultValue;
  if (allowed.includes(value as T)) return value as T;
  warnConfig(`Invalid ${name}: ${value}, falling back to ${defaultValue}`);
  return defaultValue;
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

function warnInvalidIntEnv(name: string, defaultValue: number): void {
  const value = process.env[name];
  if (!value) return;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    warnConfig(`Invalid ${name}: ${value}, falling back to ${defaultValue}`);
  }
}

export const config = {
  configDir: optionalEnv("CONFIG_DIR", "./config/provider/"),

  enabledProviders: (process.env["ENABLED_PROVIDERS"] || "").trim(),

  proxyApiKey: process.env["PROXY_API_KEY"] || "",

  opsPassword: process.env["OPS_PASSWORD"] || "",

  server: {
    port: optionalIntEnv("PORT", 3000),
    host: optionalEnv("HOST", "0.0.0.0"),
  },

  monitor: {
    storage: optionalEnumEnv(
      "MONITOR_STORAGE",
      ["memory", "sqlite"] as const,
      "memory",
    ),
    sqlitePath: optionalEnv("MONITOR_SQLITE_PATH", "./data/monitor.db"),
    retentionDays: optionalIntEnv("MONITOR_RETENTION_DAYS", 30),
    flushIntervalMs: optionalIntEnv("MONITOR_FLUSH_INTERVAL_MS", 200),
    flushBatchSize: optionalIntEnv("MONITOR_FLUSH_BATCH_SIZE", 100),
    queueMaxSize: optionalIntEnv("MONITOR_QUEUE_MAX_SIZE", 10_000),
  },

  logLevel: optionalEnv("LOG_LEVEL", "info") as
    | "error"
    | "warn"
    | "info"
    | "debug",

  debug: {
    enabled: optionalBoolEnv("DEBUG_ENABLED", false),
    maxRecords: optionalIntEnv("DEBUG_MAX_RECORDS", 500),
    maxBodySize: optionalIntEnv("DEBUG_MAX_BODY_SIZE", 1_048_576),
    maxMediaBytes: optionalIntEnv("DEBUG_MAX_MEDIA_BYTES", 10_485_760),
  },
};

function validateMonitorConfig(): void {
  warnInvalidIntEnv("MONITOR_RETENTION_DAYS", 30);
  warnInvalidIntEnv("MONITOR_FLUSH_INTERVAL_MS", 200);
  warnInvalidIntEnv("MONITOR_FLUSH_BATCH_SIZE", 100);
  warnInvalidIntEnv("MONITOR_QUEUE_MAX_SIZE", 10_000);

  const { retentionDays, flushIntervalMs, flushBatchSize, queueMaxSize } =
    config.monitor;

  if (retentionDays < 1) {
    warnConfig(
      `Invalid MONITOR_RETENTION_DAYS: ${retentionDays}, falling back to 30`,
    );
    config.monitor.retentionDays = 30;
  }

  if (flushIntervalMs < 50) {
    warnConfig(
      `Invalid MONITOR_FLUSH_INTERVAL_MS: ${flushIntervalMs}, falling back to 200`,
    );
    config.monitor.flushIntervalMs = 200;
  }

  if (flushBatchSize < 1) {
    warnConfig(
      `Invalid MONITOR_FLUSH_BATCH_SIZE: ${flushBatchSize}, falling back to 100`,
    );
    config.monitor.flushBatchSize = 100;
  }

  if (queueMaxSize < 1) {
    warnConfig(
      `Invalid MONITOR_QUEUE_MAX_SIZE: ${queueMaxSize}, falling back to 10000`,
    );
    config.monitor.queueMaxSize = 10_000;
  }
}

validateMonitorConfig();

function validateDebugConfig(): void {
  warnInvalidIntEnv("DEBUG_MAX_RECORDS", 500);
  warnInvalidIntEnv("DEBUG_MAX_BODY_SIZE", 1_048_576);
  warnInvalidIntEnv("DEBUG_MAX_MEDIA_BYTES", 10_485_760);

  const { maxRecords, maxBodySize, maxMediaBytes } = config.debug;

  if (maxRecords < 1) {
    warnConfig(
      `Invalid DEBUG_MAX_RECORDS: ${maxRecords}, falling back to 500`,
    );
    config.debug.maxRecords = 500;
  }

  if (maxBodySize < 1024) {
    warnConfig(
      `Invalid DEBUG_MAX_BODY_SIZE: ${maxBodySize}, falling back to 1048576`,
    );
    config.debug.maxBodySize = 1_048_576;
  }

  if (maxMediaBytes < 1024) {
    warnConfig(
      `Invalid DEBUG_MAX_MEDIA_BYTES: ${maxMediaBytes}, falling back to 10485760`,
    );
    config.debug.maxMediaBytes = 10_485_760;
  }
}

validateDebugConfig();
