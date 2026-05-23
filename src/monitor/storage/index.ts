/**
 * Request-level monitoring event.
 *
 * Captures metrics for a single API request. Does NOT persist payload data.
 */
export interface MonitorEvent {
  /** Unique request identifier */
  request_id: string;

  /** Request start timestamp (Unix ms) */
  ts_start: number;

  /** Request end timestamp (Unix ms) */
  ts_end: number;

  /** Total latency in milliseconds */
  latency_ms: number;

  /** Request path (e.g., "/v1/chat/completions") */
  path: string;

  /** HTTP method */
  method: string;

  /** HTTP status code */
  status_code: number;

  /** Model ID requested by client */
  model_requested: string;

  /** Model ID sent to upstream */
  model_upstream: string;

  /** Provider name */
  provider_name: string;

  /** Whether the request was streaming */
  stream: boolean;

  /** Number of SSE chunks received */
  chunks: number;

  /** Total bytes sent to client */
  bytes_out: number;

  /** Time to first token in ms (null for non-streaming) */
  first_token_ms: number | null;

  /** Input/prompt tokens */
  input_tokens: number;

  /** Output/completion tokens */
  output_tokens: number;

  /** Cached prompt tokens */
  cached_prompt_tokens: number;

  /** Estimated cost in USD */
  cost: number;

  /** Error type (null for successful requests) */
  error_type: string | null;

  /** Request source identifier */
  source: string;
}

/** Parameters for querying monitor events */
export interface QueryParams {
  /** Number of days to look back */
  days?: number;

  /** Maximum number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Filter by model ID */
  model?: string;
}

/** Parameters for aggregate statistics */
export interface StatsParams {
  /** Number of days to look back */
  days?: number;

  /** Start timestamp (Unix ms) */
  start?: number;

  /** End timestamp (Unix ms) */
  end?: number;

  /** Filter by model ID */
  model?: string;

  /** Filter by source */
  source?: string;
}

/** Aggregate statistics result */
export interface StatsResult {
  /** Total number of API calls */
  totalCalls: number;

  /** Total input tokens */
  totalInputTokens: number;

  /** Total output tokens */
  totalOutputTokens: number;

  /** Total cached prompt tokens */
  totalCachedPromptTokens: number;

  /** Total tokens (input + output) */
  totalTokens: number;

  /** Total estimated cost in USD */
  totalCost: number;
}

/** Parameters for trend data queries */
export interface TrendParams {
  /** Number of days to look back */
  days?: number;

  /** Start timestamp (Unix ms) */
  start?: number;

  /** End timestamp (Unix ms) */
  end?: number;

  /** Filter by model ID */
  model?: string;

  /** Filter by source */
  source?: string;

  /** Time bucket granularity */
  granularity: "hour" | "6h" | "day";
}

/** Single time bucket in trend data */
export interface TrendBucket {
  /** Bucket timestamp (Unix ms) */
  ts: number;

  /** Number of calls in this bucket */
  calls: number;

  /** Total tokens in this bucket */
  tokens: number;

  /** Total cost in this bucket */
  cost: number;

  /** Average latency in ms */
  latency_ms: number;
}

/** Token usage trend bucket by model */
export interface TokenTrendBucket {
  /** Bucket timestamp (Unix ms) */
  ts: number;

  /** Upstream model name */
  model_upstream: string;

  /** Number of calls */
  calls: number;

  /** Input tokens */
  input_tokens: number;

  /** Output tokens */
  output_tokens: number;

  /** Cached prompt tokens */
  cached_prompt_tokens: number;
}

/** Parameters for token trend queries */
export interface TokenTrendParams {
  /** Start timestamp (Unix ms) */
  start?: number;

  /** End timestamp (Unix ms) */
  end?: number;

  /** Filter by source */
  source?: string;
}

/**
 * Storage interface for monitoring data.
 *
 * Implementations must provide synchronous operations (sql.js uses sync API).
 * Two implementations exist: memory (dev/temporary) and sqlite (production).
 */
export interface MonitorStorage {
  /** Initialize storage (create tables if needed) */
  init(): void;

  /**
   * Append a monitoring event.
   * @param event - The event to store
   */
  append(event: MonitorEvent): void;

  /**
   * Query events with filtering and pagination.
   * @param params - Query parameters
   * @returns Array of matching events
   */
  query(params: QueryParams): MonitorEvent[];

  /**
   * Get aggregate statistics.
   * @param params - Filter parameters
   * @returns Aggregated stats
   */
  stats(params: StatsParams): StatsResult;

  /**
   * Get trend data grouped by time buckets.
   * @param params - Trend query parameters
   * @returns Array of trend buckets
   */
  trend(params: TrendParams): TrendBucket[];

  /**
   * Get token usage trend grouped by model and time.
   * @param params - Token trend query parameters
   * @returns Array of token trend buckets
   */
  tokenTrend(params: TokenTrendParams): TokenTrendBucket[];

  /**
   * Delete events older than retention period.
   * @param retentionDays - Number of days to retain
   * @returns Number of deleted records
   */
  prune(retentionDays: number): number;

  /** Close storage connection */
  close(): void;
}

export { memoryStorage } from "./memory";
