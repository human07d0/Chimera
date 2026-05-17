import { logger } from "../../utils/logger";
import { MonitorEvent, MonitorStorage, QueryParams, StatsParams, StatsResult, TrendParams, TrendBucket, TokenTrendParams, TokenTrendBucket } from "./index";

export class MemoryStorage implements MonitorStorage {
  private buffer: (MonitorEvent | undefined)[];
  private head = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(maxRecords = 10_000) {
    this.capacity = maxRecords;
    this.buffer = new Array(maxRecords);
  }

  init(): void {
  }

  append(event: MonitorEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    logger.debug("Monitor event appended (memory)", {
      requestId: event.request_id,
      path: event.path,
      statusCode: event.status_code,
    });
  }

  private *iterate(): Generator<MonitorEvent> {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      yield this.buffer[(start + i) % this.capacity]!;
    }
  }

  query(params: QueryParams): MonitorEvent[] {
    const { days = 3, limit = 100, offset = 0, model } = params;
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = [...this.iterate()].filter((record) => record.ts_start >= cutoffTs);

    if (model) {
      filtered = filtered.filter((record) => record.model_requested === model);
    }

    filtered.sort((a, b) => b.ts_start - a.ts_start);

    return filtered.slice(offset, offset + limit);
  }

  stats(params: StatsParams): StatsResult {
    const { days = 3, start, end, model, source } = params;
    const cutoffTs = start ?? Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = [...this.iterate()].filter((record) => record.ts_start >= cutoffTs);
    if (end !== undefined) {
      filtered = filtered.filter((record) => record.ts_start < end);
    }

    if (model) {
      filtered = filtered.filter((record) => record.model_requested === model);
    }

    if (source) {
      filtered = filtered.filter((record) => record.source === source);
    }

    const totalInputTokens = filtered.reduce((sum, item) => sum + item.input_tokens, 0);
    const totalOutputTokens = filtered.reduce((sum, item) => sum + item.output_tokens, 0);

    return {
      totalCalls: filtered.length,
      totalInputTokens,
      totalOutputTokens,
      totalCachedPromptTokens: filtered.reduce((sum, item) => sum + item.cached_prompt_tokens, 0),
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost: filtered.reduce((sum, item) => sum + item.cost, 0),
    };
  }

  trend(params: TrendParams): TrendBucket[] {
    const { days = 3, start, end, model, source, granularity } = params;
    const cutoffTs = start ?? Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = [...this.iterate()].filter((record) => record.ts_start >= cutoffTs);
    if (end !== undefined) {
      filtered = filtered.filter((record) => record.ts_start < end);
    }

    if (model) {
      filtered = filtered.filter((record) => record.model_requested === model);
    }

    if (source) {
      filtered = filtered.filter((record) => record.source === source);
    }

    const bucketMs = granularity === "hour" ? 60 * 60 * 1000 : granularity === "6h" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const buckets = new Map<number, TrendBucket>();

    for (const record of filtered) {
      const bucketTs = Math.floor(record.ts_start / bucketMs) * bucketMs;

      let bucket = buckets.get(bucketTs);
      if (!bucket) {
        bucket = { ts: bucketTs, calls: 0, tokens: 0, cost: 0, latency_ms: 0 };
        buckets.set(bucketTs, bucket);
      }

      bucket.calls++;
      bucket.tokens += record.input_tokens + record.output_tokens;
      bucket.cost += record.cost;
      bucket.latency_ms += record.latency_ms;
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.ts - b.ts)
      .map((b) => ({
        ...b,
        latency_ms: b.calls > 0 ? Math.round(b.latency_ms / b.calls) : 0,
      }));
  }

  tokenTrend(params: TokenTrendParams): TokenTrendBucket[] {
    const { start, end, source } = params;
    const cutoffTs = start ?? Date.now() - 3 * 24 * 60 * 60 * 1000;

    let filtered = [...this.iterate()].filter((record) => record.ts_start >= cutoffTs);
    if (end !== undefined) {
      filtered = filtered.filter((record) => record.ts_start < end);
    }

    if (source) {
      filtered = filtered.filter((record) => record.source === source);
    }

    const bucketMs = 24 * 60 * 60 * 1000;
    const buckets = new Map<string, TokenTrendBucket>();

    for (const record of filtered) {
      const bucketTs = Math.floor(record.ts_start / bucketMs) * bucketMs;
      const key = `${bucketTs}:${record.model_upstream}`;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { ts: bucketTs, model_upstream: record.model_upstream, calls: 0, input_tokens: 0, output_tokens: 0, cached_prompt_tokens: 0 };
        buckets.set(key, bucket);
      }

      bucket.calls++;
      bucket.input_tokens += record.input_tokens;
      bucket.output_tokens += record.output_tokens;
      bucket.cached_prompt_tokens += record.cached_prompt_tokens;
    }

    return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts || a.model_upstream.localeCompare(b.model_upstream));
  }

  prune(retentionDays: number): number {
    const cutoffTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const surviving: MonitorEvent[] = [];
    for (const event of this.iterate()) {
      if (event.ts_start >= cutoffTs) {
        surviving.push(event);
      }
    }
    const deletedCount = this.count - surviving.length;

    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    for (const event of surviving) {
      this.append(event);
    }

    if (deletedCount > 0) {
      logger.info("Monitor prune completed (memory)", { deletedCount, retentionDays });
    }

    return deletedCount;
  }

  close(): void {
  }
}

export const memoryStorage = new MemoryStorage();
