import { config } from "../config";
import { DebugEvent, DebugQueryParams } from "./types";

export class DebugStore {
  private buffer: DebugEvent[] = [];
  private maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = maxSize ?? config.debug.maxRecords;
  }

  append(event: DebugEvent): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  query(params: DebugQueryParams = {}): { total: number; items: DebugEvent[] } {
    let items = [...this.buffer];

    if (params.model) {
      const model = params.model;
      items = items.filter(
        (e) => e.model_requested === model || e.model_upstream === model
      );
    }

    if (params.search) {
      const keyword = params.search.toLowerCase();
      items = items.filter(
        (e) =>
          e.request_body.toLowerCase().includes(keyword) ||
          e.response_body.toLowerCase().includes(keyword)
      );
    }

    items.sort((a, b) => b.ts_start - a.ts_start);

    const total = items.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    items = items.slice(offset, offset + limit);

    return { total, items };
  }

  getById(id: string): DebugEvent | undefined {
    return this.buffer.find((e) => e.request_id === id);
  }

  prune(): number {
    const count = this.buffer.length;
    this.buffer = [];
    return count;
  }

  get size(): number {
    return this.buffer.length;
  }

  setMaxRecords(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.maxSize = n;
    while (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }
}

export const debugStore = new DebugStore();