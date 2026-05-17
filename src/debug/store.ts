import { config } from "../config";
import { DebugEvent, DebugQueryParams } from "./types";

export class DebugStore {
  private buffer: (DebugEvent | undefined)[];
  private head = 0;
  private count = 0;
  private capacity: number;

  constructor(maxSize?: number) {
    this.capacity = maxSize ?? config.debug.maxRecords;
    this.buffer = new Array(this.capacity);
  }

  append(event: DebugEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  private *iterate(): Generator<DebugEvent> {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      yield this.buffer[(start + i) % this.capacity]!;
    }
  }

  query(params: DebugQueryParams = {}): { total: number; items: DebugEvent[] } {
    let items = [...this.iterate()];

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
    for (const event of this.iterate()) {
      if (event.request_id === id) return event;
    }
    return undefined;
  }

  prune(): number {
    const count = this.count;
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    return count;
  }

  get size(): number {
    return this.count;
  }

  setMaxRecords(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    const records = [...this.iterate()];
    const surviving = records.length > n ? records.slice(records.length - n) : records;
    this.capacity = n;
    this.buffer = new Array(n);
    this.head = 0;
    this.count = 0;
    for (const event of surviving) {
      this.append(event);
    }
  }
}

export const debugStore = new DebugStore();
