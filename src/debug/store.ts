import { config } from "../config";
import { DebugEvent, DebugQueryParams } from "./types";

/**
 * 纯内存环形缓冲区，存储调试事件。
 * 无持久化，进程重启即清空。
 */
export class DebugStore {
  private buffer: DebugEvent[] = [];
  private maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = maxSize ?? config.debug.maxRecords;
  }

  /** 写入一条调试事件，超限时淘汰最旧记录 */
  append(event: DebugEvent): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  /** 按条件查询调试记录 */
  query(params: DebugQueryParams = {}): { total: number; items: DebugEvent[] } {
    let items = [...this.buffer];

    // 模型过滤
    if (params.model) {
      const model = params.model;
      items = items.filter(
        (e) => e.model_requested === model || e.model_upstream === model
      );
    }

    // 关键词搜索（在 request_body / response_body 中）
    if (params.search) {
      const keyword = params.search.toLowerCase();
      items = items.filter(
        (e) =>
          e.request_body.toLowerCase().includes(keyword) ||
          e.response_body.toLowerCase().includes(keyword)
      );
    }

    // 按时间倒序
    items.sort((a, b) => b.ts_start - a.ts_start);

    const total = items.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    items = items.slice(offset, offset + limit);

    return { total, items };
  }

  /** 按 request_id 查找单条记录 */
  getById(id: string): DebugEvent | undefined {
    return this.buffer.find((e) => e.request_id === id);
  }

  /** 清空缓冲区 */
  prune(): number {
    const count = this.buffer.length;
    this.buffer = [];
    return count;
  }

  /** 当前记录数 */
  get size(): number {
    return this.buffer.length;
  }

  /** 运行时更新环形缓冲区最大容量，缩小时裁剪最旧记录 */
  setMaxRecords(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.maxSize = n;
    while (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }
}

/** 全局单例 */
export const debugStore = new DebugStore();