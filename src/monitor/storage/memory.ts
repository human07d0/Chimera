import { logger } from "../../utils/logger";
import { MonitorEvent, MonitorStorage, QueryParams, StatsParams, StatsResult } from "./index";

class MemoryStorage implements MonitorStorage {
  private records: MonitorEvent[] = [];
  private readonly maxRecords = 10_000;

  init(): void {
    // 内存存储无需初始化
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
    const { days = 3, model } = params;
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = this.records.filter((record) => record.ts_start >= cutoffTs);

    if (model) {
      filtered = filtered.filter((record) => record.model_requested === model);
    }

    return {
      totalCalls: filtered.length,
      totalInputTokens: filtered.reduce((sum, item) => sum + item.input_tokens, 0),
      totalOutputTokens: filtered.reduce((sum, item) => sum + item.output_tokens, 0),
      totalCachedPromptTokens: filtered.reduce((sum, item) => sum + item.cached_prompt_tokens, 0),
      totalCost: filtered.reduce((sum, item) => sum + item.cost, 0),
    };
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
    // 内存存储无需关闭资源
  }
}

export const memoryStorage = new MemoryStorage();
