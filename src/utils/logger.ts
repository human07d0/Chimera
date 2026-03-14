import { config } from "../config";

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] <= LEVELS[config.logLevel];
}

function formatMessage(level: LogLevel, message: string, meta?: object): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  error(message: string, meta?: object): void {
    if (shouldLog("error")) console.error(formatMessage("error", message, meta));
  },
  warn(message: string, meta?: object): void {
    if (shouldLog("warn")) console.warn(formatMessage("warn", message, meta));
  },
  info(message: string, meta?: object): void {
    if (shouldLog("info")) console.log(formatMessage("info", message, meta));
  },
  debug(message: string, meta?: object): void {
    if (shouldLog("debug")) console.log(formatMessage("debug", message, meta));
  },
};
