import { config } from "../config";

// --------------------------------------------------------------------------
// 虚拟模型的特性标志
// --------------------------------------------------------------------------
export interface ModelFeatures {
  /** 是否开启深度思考（thinking chain） */
  thinking: boolean;
  /** 是否开启联网搜索 */
  search: boolean;
  /** 是否强制 JSON 结构化输出 */
  json: boolean;
}

// --------------------------------------------------------------------------
// 虚拟模型定义
// --------------------------------------------------------------------------
export interface VirtualModel {
  /** 对外暴露的虚拟模型 ID */
  id: string;
  /** 可读的描述 */
  description: string;
  /** 实际映射的小米模型 ID */
  upstreamModel: string;
  features: ModelFeatures;
  /** OpenAI /v1/models 接口中的 created 时间戳 */
  created: number;
  /** Maximum input context length in tokens */
  contextLength: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
}

interface FeaturePreset {
  suffix: string;
  descriptionSuffix: string;
  features: ModelFeatures;
}

const FEATURE_PRESETS: FeaturePreset[] = [
  {
    suffix: "",
    descriptionSuffix: "基础对话",
    features: { thinking: false, search: false, json: false },
  },
  {
    suffix: "-thinking",
    descriptionSuffix: "深度思考",
    features: { thinking: true, search: false, json: false },
  },
  {
    suffix: "-search",
    descriptionSuffix: "联网搜索",
    features: { thinking: false, search: true, json: false },
  },
  {
    suffix: "-json",
    descriptionSuffix: "结构化输出（JSON）",
    features: { thinking: false, search: false, json: true },
  },
  {
    suffix: "-thinking-search",
    descriptionSuffix: "深度思考 + 联网搜索",
    features: { thinking: true, search: true, json: false },
  },
  {
    suffix: "-thinking-json",
    descriptionSuffix: "深度思考 + 结构化输出（JSON）",
    features: { thinking: true, search: false, json: true },
  },
  {
    suffix: "-search-json",
    descriptionSuffix: "联网搜索 + 结构化输出（JSON）",
    features: { thinking: false, search: true, json: true },
  },
  {
    suffix: "-thinking-search-json",
    descriptionSuffix: "深度思考 + 联网搜索 + 结构化输出（JSON）",
    features: { thinking: true, search: true, json: true },
  },
];

// 固定时间戳，让模型列表看起来正常
const BASE_TS = 1_700_000_000;

// Token limits by upstream model ID
const TOKEN_LIMITS: Record<string, { contextLength: number; maxOutputTokens: number }> = {
  "mimo-v2.5-pro": { contextLength: 1_000_000, maxOutputTokens: 128_000 },
  "mimo-v2-pro":   { contextLength: 1_000_000, maxOutputTokens: 128_000 },
  "mimo-v2.5":     { contextLength: 1_000_000, maxOutputTokens: 128_000 },
  "mimo-v2-omni":  { contextLength: 256_000,   maxOutputTokens: 128_000 },
  "mimo-v2-flash": { contextLength: 256_000,   maxOutputTokens: 64_000 },
};

const DEFAULT_TOKEN_LIMITS = { contextLength: 256_000, maxOutputTokens: 64_000 };

function buildVirtualModels(): VirtualModel[] {
  const models: VirtualModel[] = [];

  for (const upstreamModel of config.upstream.enabledModels) {
    const limits = TOKEN_LIMITS[upstreamModel] ?? DEFAULT_TOKEN_LIMITS;

    for (const preset of FEATURE_PRESETS) {
      models.push({
        id: `${upstreamModel}${preset.suffix}`,
        description: `${upstreamModel} — ${preset.descriptionSuffix}`,
        upstreamModel,
        features: preset.features,
        created: BASE_TS,
        contextLength: limits.contextLength,
        maxOutputTokens: limits.maxOutputTokens,
      });
    }
  }

  return models;
}

// NOTE: Built once at module load time. Does not reflect runtime config changes.
export const VIRTUAL_MODELS: VirtualModel[] = buildVirtualModels();

// 快速查找 Map
export const VIRTUAL_MODEL_MAP = new Map<string, VirtualModel>(
  VIRTUAL_MODELS.map((m) => [m.id, m])
);

/**
 * 根据虚拟模型 ID 查找模型定义。
 * 找不到则返回 undefined。
 */
export function findVirtualModel(modelId: string): VirtualModel | undefined {
  return VIRTUAL_MODEL_MAP.get(modelId);
}

/**
 * 构造 web_search 工具对象，参数来自 config
 */
export function buildWebSearchTool(): object {
  return {
    type: "web_search",
    max_keyword: config.webSearch.maxKeyword,
    force_search: config.webSearch.forceSearch,
    limit: config.webSearch.limit,
    user_location: config.webSearch.userLocation,
  };
}

