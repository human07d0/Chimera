import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { logger } from "../utils/logger";
import { builtinHandlers } from "./builtin";
import { customHandlers } from "./custom";
import type { ProviderHandler } from "./types";
import type { ProviderConfig, ModelConfig } from "./types";

const CUSTOM_TYPES = new Set(["openai", "anthropic"]);

const VALID_TYPES = ["mimo", "deepseek", "aliyun", "kimi", "openai", "anthropic"] as const;

const flatPricingSchema = z.object({
  input: z.number(),
  cached_input: z.number().optional(),
  output: z.number(),
}).strict();

const tierEntrySchema = z.object({
  max_tokens: z.number(),
  input: z.number(),
  cached_input: z.number().optional(),
  output: z.number(),
});

const tieredPricingSchema = z.object({
  tiers: z.array(tierEntrySchema).min(1),
}).strict();

const pricingSchema = z.union([tieredPricingSchema, flatPricingSchema]);

const INPUT_MODALITIES = ["text", "image", "file", "audio", "video"] as const;
const OUTPUT_MODALITIES = ["text", "image", "audio"] as const;

const modalitiesSchema = z.object({
  input: z.array(z.enum(INPUT_MODALITIES)),
  output: z.array(z.enum(OUTPUT_MODALITIES)),
});

const modelSchema = z
  .object({
    id: z.string(),
    upstream: z.string(),
    context_length: z.number(),
    max_output_tokens: z.number(),
    description: z.string().optional(),
    created: z.number().optional(),
    default: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    pricing: pricingSchema.optional(),
    modalities: modalitiesSchema.optional(),
  })
  .strict();

const providerSchema = z
  .object({
    version: z.literal(1),
    type: z.enum(VALID_TYPES),
    api_key: z.string(),
    base_url: z.string().optional(),
    anthropic_url: z.string().nullable().optional(),
    auth_header: z.string(),
    auth_prefix: z.string().default(""),
    timeout: z.number().default(120000),
    endpoint: z.string().default(""),
    models: z.array(modelSchema),
    capabilities: z.record(z.string(), z.unknown()).default({}),
    web_search: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .strict();

type RawProvider = z.infer<typeof providerSchema>;

export function normalizeEndpoint(endpoint: string): string {
  if (endpoint === "") return "";
  const result = "/" + endpoint.replace(/^\/+/, "").replace(/\/+$/, "");
  if (result === "/") return "";
  return result;
}

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) return "";
    return envValue;
  });
}

function resolveEnvVarsInValue(value: unknown): unknown {
  if (typeof value === "string") return resolveEnvVars(value);
  if (Array.isArray(value)) return value.map(resolveEnvVarsInValue);
  if (value !== null && typeof value === "object") {
    return resolveEnvVarsInObject(value as Record<string, unknown>);
  }
  return value;
}

function resolveEnvVarsInObject(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = resolveEnvVarsInValue(val);
  }
  return result;
}

function validateDefaultKeys(defaults: Record<string, unknown> | undefined, modelId: string, providerType: string): void {
  if (!defaults) return;
  if (providerType === "mimo" && "max_tokens" in defaults) {
    throw new Error(
      `Model '${modelId}': default.max_tokens is not allowed for MiMo because transformRequest renames it to max_completion_tokens. Use default.max_completion_tokens instead.`,
    );
  }
}

function normalizeCapabilities(
  providerCaps: Record<string, unknown>,
  modelCaps: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!modelCaps) return { ...providerCaps };
  return { ...providerCaps, ...modelCaps };
}

export function loadProviders(configDir?: string, enabledProviderNames?: Set<string> | null): ProviderConfig[] {
  const dir = configDir ?? "./config/provider/";
  const resolvedDir = path.resolve(dir);

  if (!fs.existsSync(resolvedDir)) {
    logger.warn(`Config directory not found: ${resolvedDir}`);
    return [];
  }

  const files = fs
    .readdirSync(resolvedDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  if (files.length === 0) {
    logger.warn(`No YAML files found in ${resolvedDir}`);
    return [];
  }

  const loadTime = Math.floor(Date.now() / 1000);
  const providers: ProviderConfig[] = [];
  const modelIdMap = new Map<string, Map<string, string[]>>();

  const handlerMap = new Map<string, ProviderHandler>([...builtinHandlers, ...customHandlers]);

  for (const file of files) {
    const name = path.basename(file, path.extname(file));

    if (enabledProviderNames && !enabledProviderNames.has(name)) {
      logger.debug(`Skipping provider '${name}': not in ENABLED_PROVIDERS`);
      continue;
    }

    const filePath = path.join(resolvedDir, file);
    let rawYaml: unknown;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      rawYaml = parseYaml(content);
    } catch (err) {
      throw new Error(
        `Failed to parse YAML file ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const resolved = resolveEnvVarsInValue(rawYaml);

    const parsed = providerSchema.safeParse(resolved);
    if (!parsed.success) {
      throw new Error(
        `Invalid provider config in ${file}: ${parsed.error.message}`,
      );
    }

    const raw: RawProvider = parsed.data;

    if (raw.models.length === 0) {
      logger.warn(`Provider '${file}' has no models, skipping`);
      continue;
    }

    const endpoint = normalizeEndpoint(raw.endpoint);

    if (!modelIdMap.has(endpoint)) {
      modelIdMap.set(endpoint, new Map());
    }
    const endpointModels = modelIdMap.get(endpoint)!;

    const models: ModelConfig[] = [];
    for (const rawModel of raw.models) {
      validateDefaultKeys(rawModel.default, rawModel.id, raw.type);

      if (!endpointModels.has(rawModel.id)) {
        endpointModels.set(rawModel.id, []);
      }
      endpointModels.get(rawModel.id)!.push(file);

      models.push({
        id: rawModel.id,
        upstream: rawModel.upstream,
        context_length: rawModel.context_length,
        max_output_tokens: rawModel.max_output_tokens,
        description: rawModel.description ?? rawModel.id,
        created: rawModel.created ?? loadTime,
        default: rawModel.default,
        capabilities: normalizeCapabilities(
          raw.capabilities,
          rawModel.capabilities,
        ),
        modalities: rawModel.modalities,
        pricing: rawModel.pricing,
      });
    }

    const handler = handlerMap.get(raw.type);

    let baseUrl = raw.base_url ?? "";
    if (!baseUrl && handler) {
      const defaultUrl = handler.getDefaultBaseUrl();
      if (defaultUrl) baseUrl = defaultUrl;
    }

    if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = "https://" + baseUrl;
    }

    const isCustom = CUSTOM_TYPES.has(raw.type);
    const anthropicUrl = isCustom ? null : (raw.anthropic_url ?? handler?.getDefaultAnthropicUrl() ?? null);

    providers.push({
      version: raw.version,
      type: raw.type,
      name,
      api_key: raw.api_key,
      base_url: baseUrl,
      anthropic_url: anthropicUrl,
      auth_header: raw.auth_header,
      auth_prefix: raw.auth_prefix,
      timeout: raw.timeout,
      endpoint,
      models,
      capabilities: raw.capabilities,
      web_search: raw.web_search,
    });

    logger.info(`Provider '${name}' loaded`, {
      type: raw.type,
      endpoint: endpoint || "(default)",
      models: models.length,
    });
  }

  const conflicts: string[] = [];
  for (const [endpoint, endpointModels] of modelIdMap) {
    for (const [modelId, filenames] of endpointModels) {
      if (filenames.length > 1) {
        const countMap = new Map<string, number>();
        for (const f of filenames) {
          countMap.set(f, (countMap.get(f) ?? 0) + 1);
        }
        const details = [...countMap.entries()]
          .map(([f, count]) => `'${path.basename(f, path.extname(f))}' (${f}) [${count} definition${count > 1 ? "s" : ""}]`)
          .join(", ");
        conflicts.push(`Model '${modelId}' at endpoint '${endpoint}': found in ${details}`);
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Duplicate model IDs detected:\n${conflicts.map((c) => `  - ${c}`).join("\n")}`,
    );
  }

  for (const provider of providers) {
    if (CUSTOM_TYPES.has(provider.type) && !provider.base_url) {
      throw new Error(
        `Custom provider '${provider.name}' (type: ${provider.type}) requires a non-empty base_url`,
      );
    }
    if (provider.models.length === 0) {
      logger.warn(`Provider '${provider.name}' has no models — skipping`, { type: provider.type });
    }
  }

  return providers.filter((p) => p.models.length > 0);
}
