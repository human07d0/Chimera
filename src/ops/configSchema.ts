export interface ConfigFieldDef {
  envKey: string;
  alias: string;
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
  min?: number;
}

export const CONFIG_FIELDS: ConfigFieldDef[] = [
  { envKey: "LOG_LEVEL", alias: "logLevel", type: "string", enum: ["error", "warn", "info", "debug"], description: "日志级别" },
  { envKey: "MONITOR_FLUSH_INTERVAL_MS", alias: "monitorFlushIntervalMs", type: "number", min: 50, description: "监控异步写入队列的刷新间隔（毫秒）" },
  { envKey: "MONITOR_RETENTION_DAYS", alias: "monitorRetentionDays", type: "number", min: 1, description: "监控数据保留天数" },
  { envKey: "MONITOR_FLUSH_BATCH_SIZE", alias: "monitorFlushBatchSize", type: "number", min: 1, description: "监控异步写入批量大小" },
  { envKey: "MONITOR_QUEUE_MAX_SIZE", alias: "monitorQueueMaxSize", type: "number", min: 1, description: "监控异步队列最大长度" },
  { envKey: "DEBUG_ENABLED", alias: "debugEnabled", type: "boolean", description: "调试模块开关" },
  { envKey: "DEBUG_MAX_RECORDS", alias: "debugMaxRecords", type: "number", min: 1, description: "调试记录最大条数（环形缓冲区容量）" },
  { envKey: "DEBUG_MAX_BODY_SIZE", alias: "debugMaxBodySize", type: "number", min: 1024, description: "调试记录单条请求/响应体最大字节数" },
  { envKey: "DEBUG_MAX_MEDIA_BYTES", alias: "debugMaxMediaBytes", type: "number", min: 1024, description: "调试模式媒体资源缓存最大字节数" },
];

export const KEY_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  CONFIG_FIELDS.map((f) => [f.alias, f.envKey])
);

export function getFieldDef(envKey: string): ConfigFieldDef | undefined {
  return CONFIG_FIELDS.find((f) => f.envKey === envKey);
}

export function generateSchema(): Record<string, { key: string; type: string; description: string; enum?: string[]; min?: number }> {
  const schema: Record<string, { key: string; type: string; description: string; enum?: string[]; min?: number }> = {};
  for (const field of CONFIG_FIELDS) {
    const entry: { key: string; type: string; description: string; enum?: string[]; min?: number } = {
      key: field.envKey,
      type: field.type,
      description: field.description,
    };
    if (field.enum) entry.enum = field.enum;
    if (field.min !== undefined) entry.min = field.min;
    schema[field.alias] = entry;
  }
  return schema;
}
