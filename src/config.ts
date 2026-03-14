import "dotenv/config";

function requireEnv(name: string): string {
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

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export const config = {
  /** 小米 MiMo API Key */
  mimoApiKey: requireEnv("MIMO_API_KEY"),

  /** 代理服务自身鉴权 Key，为空则不启用 */
  proxyApiKey: process.env["PROXY_API_KEY"] || "",

  server: {
    port: optionalIntEnv("PORT", 3000),
    host: optionalEnv("HOST", "0.0.0.0"),
  },

  upstream: {
    baseUrl: optionalEnv("MIMO_BASE_URL", "https://api.xiaomimimo.com"),
    /** 所有虚拟模型映射到的真实模型 ID */
    model: optionalEnv("MIMO_MODEL", "mimo-v2-flash"),
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

  logLevel: optionalEnv("LOG_LEVEL", "info") as "error" | "warn" | "info" | "debug",
};
