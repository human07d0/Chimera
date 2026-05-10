// 监控事件（request-level，禁止 payload）
export interface MonitorEvent {
  request_id: string;
  ts_start: number;
  ts_end: number;
  latency_ms: number;
  path: string;
  method: string;
  status_code: number;
  model_requested: string;
  model_upstream: string;
  stream: boolean;
  chunks: number;
  bytes_out: number;
  first_token_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cached_prompt_tokens: number;
  cost: number;
  error_type: string | null;
  source: "main" | "token-plan";
}

export interface QueryParams {
  days?: number;
  limit?: number;
  offset?: number;
  model?: string;
}

export interface StatsParams {
  days?: number;
  model?: string;
  source?: "main" | "token-plan";
}

export interface StatsResult {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedPromptTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface MonitorStorage {
  // sql.js 使用同步 API
  init(): void;
  append(event: MonitorEvent): void;
  query(params: QueryParams): MonitorEvent[];
  stats(params: StatsParams): StatsResult;
  prune(retentionDays: number): number;
  close(): void;
}

export { memoryStorage } from "./memory";
