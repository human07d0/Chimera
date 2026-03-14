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
  features: ModelFeatures;
  /** OpenAI /v1/models 接口中的 created 时间戳 */
  created: number;
}

// --------------------------------------------------------------------------
// 8 种组合：thinking × search × json 的所有排列
// --------------------------------------------------------------------------
const BASE_TS = 1_700_000_000; // 固定时间戳，让模型列表看起来正常

export const VIRTUAL_MODELS: VirtualModel[] = [
  {
    id: "mimo-v2-flash",
    description: "MiMo v2 Flash — 基础对话",
    features: { thinking: false, search: false, json: false },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-thinking",
    description: "MiMo v2 Flash — 深度思考",
    features: { thinking: true, search: false, json: false },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-search",
    description: "MiMo v2 Flash — 联网搜索",
    features: { thinking: false, search: true, json: false },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-json",
    description: "MiMo v2 Flash — 结构化输出（JSON）",
    features: { thinking: false, search: false, json: true },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-thinking-search",
    description: "MiMo v2 Flash — 深度思考 + 联网搜索",
    features: { thinking: true, search: true, json: false },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-thinking-json",
    description: "MiMo v2 Flash — 深度思考 + 结构化输出（JSON）",
    features: { thinking: true, search: false, json: true },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-search-json",
    description: "MiMo v2 Flash — 联网搜索 + 结构化输出（JSON）",
    features: { thinking: false, search: true, json: true },
    created: BASE_TS,
  },
  {
    id: "mimo-v2-flash-thinking-search-json",
    description: "MiMo v2 Flash — 深度思考 + 联网搜索 + 结构化输出（JSON）",
    features: { thinking: true, search: true, json: true },
    created: BASE_TS,
  },
];

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
