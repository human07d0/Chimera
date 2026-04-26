import "dotenv/config";

export const SUPPORTED_UPSTREAM_MODELS = ["mimo-v2-flash", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5", "mimo-v2.5-pro"] as const;
type SupportedUpstreamModel = (typeof SUPPORTED_UPSTREAM_MODELS)[number];

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
  defaultValue: T
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

function optionalModelListEnv(
  name: string,
  defaultValue: readonly SupportedUpstreamModel[]
): SupportedUpstreamModel[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    return [...defaultValue];
  }

  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const enabled: SupportedUpstreamModel[] = [];

  for (const model of requested) {
    if (!SUPPORTED_UPSTREAM_MODELS.includes(model as SupportedUpstreamModel)) {
      warnConfig(
        `Invalid ${name} item: '${model}'. Supported values: ${SUPPORTED_UPSTREAM_MODELS.join(", ")}`
      );
      continue;
    }

    const typedModel = model as SupportedUpstreamModel;
    if (!enabled.includes(typedModel)) {
      enabled.push(typedModel);
    }
  }

  if (enabled.length === 0) {
    warnConfig(
      `${name} has no valid model values, falling back to defaults: ${defaultValue.join(", ")}`
    );
    return [...defaultValue];
  }

  return enabled;
}

const defaultEnabledModels: readonly SupportedUpstreamModel[] = SUPPORTED_UPSTREAM_MODELS;
const configuredEnabledModels = optionalModelListEnv("MIMO_ENABLED_MODELS", defaultEnabledModels);

export const config = {
  /** 小米 MiMo API Key（主代理必填，仅使用 token-plan 时可留空） */
  mimoApiKey: process.env["MIMO_API_KEY"] || "",

  /** 代理服务自身鉴权 Key，为空则不启用 */
  proxyApiKey: process.env["PROXY_API_KEY"] || "",

      /** Ops 运维界面密码，为空则不启用运维界面 */
  opsPassword: process.env["OPS_PASSWORD"] || "",

  server: {


    port: optionalIntEnv("PORT", 3000),
    host: optionalEnv("HOST", "0.0.0.0"),
  },

  upstream: {
    baseUrl: optionalEnv("MIMO_BASE_URL", "https://api.xiaomimimo.com"),
    /** Anthropic API Base URL */
    anthropicBaseUrl: optionalEnv("ANTHROPIC_BASE_URL", "https://api.xiaomimimo.com/anthropic/v1"),
    /** 启用的真实 MiMo 模型 */
    enabledModels: configuredEnabledModels,
    /** 默认模型（用于健康检查与监控回退值） */
    defaultModel: configuredEnabledModels[0],
    timeout: optionalIntEnv("UPSTREAM_TIMEOUT_MS", 120_000),
  },

  webSearch: {
    maxKeyword: optionalIntEnv("WEB_SEARCH_MAX_KEYWORD", 3),
    forceSearch: optionalBoolEnv("WEB_SEARCH_FORCE_SEARCH", true),
    limit: optionalIntEnv("WEB_SEARCH_LIMIT", 3),
    userLocation: {
      type: "approximate" as const,
      country: optionalEnv("WEB_SEARCH_COUNTRY", "China"),
      region: optionalEnv("WEB_SEARCH_REGION", "Beijing"),
      city: optionalEnv("WEB_SEARCH_CITY", "Beijing"),
    },
  },

  monitor: {
    storage: optionalEnumEnv("MONITOR_STORAGE", ["memory", "sqlite"] as const, "memory"),
    sqlitePath: optionalEnv("MONITOR_SQLITE_PATH", "./data/monitor.db"),
    retentionDays: optionalIntEnv("MONITOR_RETENTION_DAYS", 30),
    flushIntervalMs: optionalIntEnv("MONITOR_FLUSH_INTERVAL_MS", 200),
    flushBatchSize: optionalIntEnv("MONITOR_FLUSH_BATCH_SIZE", 100),
    queueMaxSize: optionalIntEnv("MONITOR_QUEUE_MAX_SIZE", 10_000),
  },

  /** token-plan 透传代理配置 */
  tokenPlan: {
    enabled: optionalBoolEnv("TOKEN_PLAN_ENABLED", false),
    proxyApiKey: process.env["TOKEN_PLAN_PROXY_API_KEY"] || "",
    mimoApiKey: process.env["TOKEN_PLAN_MIMO_API_KEY"] || "",
    baseUrl: optionalEnv("TOKEN_PLAN_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1"),
    anthropicBaseUrl: optionalEnv("TOKEN_PLAN_ANTHROPIC_BASE_URL", "https://token-plan-cn.xiaomimimo.com/anthropic"),
    timeout: optionalIntEnv("UPSTREAM_TIMEOUT_MS", 120_000),
  },

  logLevel: optionalEnv("LOG_LEVEL", "info") as "error" | "warn" | "info" | "debug",

  debug: {
    enabled: optionalBoolEnv("DEBUG_ENABLED", false),
    maxRecords: optionalIntEnv("DEBUG_MAX_RECORDS", 500),
    maxBodySize: optionalIntEnv("DEBUG_MAX_BODY_SIZE", 1_048_576),
  },
};

function validateMonitorConfig(): void {
      warnInvalidIntEnv("MONITOR_RETENTION_DAYS", 30);
  warnInvalidIntEnv("MONITOR_FLUSH_INTERVAL_MS", 200);
  warnInvalidIntEnv("MONITOR_FLUSH_BATCH_SIZE", 100);
  warnInvalidIntEnv("MONITOR_QUEUE_MAX_SIZE", 10_000);

  const { retentionDays, flushIntervalMs, flushBatchSize, queueMaxSize } = config.monitor;



  if (retentionDays < 1) {
    warnConfig(`Invalid MONITOR_RETENTION_DAYS: ${retentionDays}, falling back to 30`);
    config.monitor.retentionDays = 30;
  }

  if (flushIntervalMs < 50) {
    warnConfig(`Invalid MONITOR_FLUSH_INTERVAL_MS: ${flushIntervalMs}, falling back to 200`);
    config.monitor.flushIntervalMs = 200;
  }

  if (flushBatchSize < 1) {
    warnConfig(`Invalid MONITOR_FLUSH_BATCH_SIZE: ${flushBatchSize}, falling back to 100`);
    config.monitor.flushBatchSize = 100;
  }

      if (queueMaxSize < 1) {
    warnConfig(`Invalid MONITOR_QUEUE_MAX_SIZE: ${queueMaxSize}, falling back to 10000`);
    config.monitor.queueMaxSize = 10_000;
  }
}



validateMonitorConfig();



