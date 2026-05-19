import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import type { ProviderConfig, ModelConfig } from "./types";

const DISCOVERY_TIMEOUT = 30_000;

interface ChimeraRaw {
  api_key: string;
  auth_header: string;
  auth_prefix: string;
  timeout: number;
  endpoint: string;
  version: number;
  capabilities?: Record<string, unknown> | undefined;
  web_search?: Record<string, unknown> | null | undefined;
}

export function normalizeEndpoint(endpoint: string): string {
  if (endpoint === "") return "";
  const result = "/" + endpoint.replace(/^\/+/, "").replace(/\/+$/, "");
  if (result === "/") return "";
  return result;
}

async function fetchEndpoints(baseUrl: string, apiKey: string, authHeader: string, authPrefix: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `${baseUrl}/v1/endpoints`,
    { headers: { [authHeader]: `${authPrefix}${apiKey}` } },
    DISCOVERY_TIMEOUT,
  );
  if (res.status === 404) return [""];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.endpoints as Array<{ prefix: string }>).map(e => e.prefix);
}

async function fetchModels(baseUrl: string, prefix: string, apiKey: string, authHeader: string, authPrefix: string): Promise<ModelConfig[]> {
  const prefixPath = prefix ? `/${prefix}` : "";
  const res = await fetchWithTimeout(
    `${baseUrl}${prefixPath}/v1/models`,
    { headers: { [authHeader]: `${authPrefix}${apiKey}` } },
    DISCOVERY_TIMEOUT,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.data)) {
    throw new Error(`Expected data.data to be an array, got ${typeof data.data}`);
  }
  const loadTime = Math.floor(Date.now() / 1000);
  return data.data.map((m: any) => ({
    id: m.id,
    upstream: m.id,
    context_length: m.context_length ?? 0,
    max_output_tokens: m.max_output_tokens ?? 0,
    description: m.description ?? m.id,
    created: m.created ?? loadTime,
    capabilities: m.capabilities ?? {},
    modalities: m.architecture ? {
      input: m.architecture.input_modalities ?? ["text"],
      output: m.architecture.output_modalities ?? ["text"],
    } : undefined,
    pricing: m.pricing,
  }));
}

export function computeLocalPrefix(configEndpoint: string, upstreamPrefix: string): string {
  if (!configEndpoint && !upstreamPrefix) return "";
  if (!configEndpoint) return normalizeEndpoint(upstreamPrefix);
  if (!upstreamPrefix) return configEndpoint;
  const left = configEndpoint.replace(/\/+$/, "");
  const right = upstreamPrefix.replace(/^\/+/, "");
  return `${left}/${right}`;
}

export function joinUrl(base: string, ...parts: string[]): string {
  return [base, ...parts].filter(Boolean).join("/").replace(/([^:]\/)\/+/g, "$1");
}

export async function discoverChimeraProviders(
  raw: ChimeraRaw,
  yamlName: string,
  baseUrl: string,
  configEndpoint: string,
): Promise<ProviderConfig[]> {
  const apiKey = raw.api_key;
  const authHeader = raw.auth_header;
  const authPrefix = raw.auth_prefix;

  let upstreamPrefixes: string[];
  try {
    upstreamPrefixes = await fetchEndpoints(baseUrl, apiKey, authHeader, authPrefix);
  } catch (err) {
    logger.warn(`Chimera '${yamlName}': failed to discover endpoints, skipping`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const configs: ProviderConfig[] = [];
  for (const prefix of upstreamPrefixes) {
    let models: ModelConfig[];
    try {
      models = await fetchModels(baseUrl, prefix, apiKey, authHeader, authPrefix);
    } catch (err) {
      logger.warn(`Chimera '${yamlName}': failed to discover models at '${prefix || "(default)"}', skipping endpoint`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (models.length === 0) {
      logger.warn(`Chimera '${yamlName}': no models at '${prefix || "(default)"}', skipping endpoint`);
      continue;
    }

    const localPrefix = computeLocalPrefix(configEndpoint, prefix);
    const providerName = prefix ? `${yamlName}/${prefix}` : yamlName;

    configs.push({
      version: raw.version,
      type: "chimera",
      name: providerName,
      api_key: apiKey,
      base_url: joinUrl(baseUrl, prefix),
      anthropic_url: null,
      auth_header: raw.auth_header,
      auth_prefix: raw.auth_prefix,
      timeout: raw.timeout,
      endpoint: localPrefix,
      models,
      capabilities: {},
      web_search: null,
    });
  }
  return configs;
}
