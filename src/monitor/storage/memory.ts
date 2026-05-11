import { logger } from "../../utils/logger";
import { MonitorEvent, MonitorStorage, QueryParams, StatsParams, StatsResult, TrendParams, TrendBucket, TokenTrendParams, TokenTrendBucket } from "./index";

class MemoryStorage implements MonitorStorage {
  private records: MonitorEvent[] = [];
  private readonly maxRecords = 10_000;

  init(): void {
  }

  append(event: MonitorEvent): void {
    this.records.push(event);

    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    logger.debug("Monitor event appended (memory)", {
      requestId: event.request_id,
      path: event.path,
      statusCode: event.status_code,
    });
  }

  query(params: QueryParams): MonitorEvent[] {
    const { days = 3, limit = 100, offset = 0, model } = params;
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = this.records.filter((record) => record.ts_start >= cutoffTs);

    if (model) {
      filtered = filtered.filter((record) => record.model_requested === model);
    }

    filtered.sort((a, b) => b.ts_start - a.ts_start);

    return filtered.slice(offset, offset + limit);
  }

  stats(params: StatsParams): StatsResult {
    const { days = 3, start, end, model, source } = params;
    const cutoffTs = start ?? Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = this.records.filter((record) => record.ts_start >= cutoffTs);
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

    let filtered = this.records.filter((record) => record.ts_start >= cutoffTs);
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

    let filtered = this.records.filter((record) => record.ts_start >= cutoffTs);
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
    const initialLength = this.records.length;

    this.records = this.records.filter((record) => record.ts_start >= cutoffTs);

    const deletedCount = initialLength - this.records.length;
    if (deletedCount > 0) {
      logger.info("Monitor prune completed (memory)", { deletedCount, retentionDays });
    }

    return deletedCount;
  }

  close(): void {
  }
}

export const memoryStorage = new MemoryStorage();
