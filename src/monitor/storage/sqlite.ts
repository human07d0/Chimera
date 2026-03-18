import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { logger } from "../../utils/logger";
import { MonitorEvent, MonitorStorage, QueryParams, StatsParams, StatsResult } from "./index";

type RequestRow = {
  request_id: string;
  ts_start: number;
  ts_end: number;
  latency_ms: number;
  path: string;
  method: string;
  status_code: number;
  model_requested: string;
  model_upstream: string;
  stream: number;
  chunks: number;
  bytes_out: number;
  first_token_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cached_prompt_tokens: number;
  cost: number;
  error_type: string | null;
};

export class SqliteStorage implements MonitorStorage {
  private db: Database<sqlite3.Database, sqlite3.Statement> | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created monitor database directory: ${dir}`);
    }

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });

    // 启用 WAL 模式以提高并发性能
    await this.db.exec("PRAGMA journal_mode = WAL");
    await this.db.exec("PRAGMA synchronous = NORMAL");
    await this.db.exec("PRAGMA busy_timeout = 5000");

    await this.initTables();

    logger.info(`SQLite monitor storage initialized: ${this.dbPath}`);
  }

  private async initTables(): Promise<void> {
    await this.db!.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        path TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        model_requested TEXT NOT NULL,
        model_upstream TEXT NOT NULL,
        stream INTEGER NOT NULL,
        chunks INTEGER NOT NULL,
        bytes_out INTEGER NOT NULL,
        first_token_ms INTEGER,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cached_prompt_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        error_type TEXT
      )
    `);

    await this.db!.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_ts_start ON requests(ts_start)
    `);
    
    await this.db!.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_status_ts_start ON requests(status_code, ts_start)
    `);

    await this.db!.exec(`
      CREATE INDEX IF NOT EXISTS idx_requests_model_requested_ts_start ON requests(model_requested, ts_start)
    `);
  }

  async append(event: MonitorEvent): Promise<void> {
    if (!this.db) {
      throw new Error("Storage not initialized. Call init() first.");
    }

    await this.db.run(
      `INSERT INTO requests (
        request_id, ts_start, ts_end, latency_ms,
        path, method, status_code,
        model_requested, model_upstream,
        stream, chunks, bytes_out, first_token_ms,
        input_tokens, output_tokens, cached_prompt_tokens, cost,
        error_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO NOTHING`,
      [
        event.request_id,
        event.ts_start,
        event.ts_end,
        event.latency_ms,
        event.path,
        event.method,
        event.status_code,
        event.model_requested,
        event.model_upstream,
        event.stream ? 1 : 0,
        event.chunks,
        event.bytes_out,
        event.first_token_ms,
        event.input_tokens,
        event.output_tokens,
        event.cached_prompt_tokens,
        event.cost,
        event.error_type,
      ]
    );
  }

  async query(params: QueryParams): Promise<MonitorEvent[]> {
    if (!this.db) {
      throw new Error("Storage not initialized. Call init() first.");
    }

    const { days = 3, limit = 100, offset = 0, model } = params;
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    let sql = `
      SELECT * FROM requests
      WHERE ts_start >= ?
    `;
    
    const bind: (number | string)[] = [cutoffTs];

    if (model) {
      sql += ` AND model_requested = ?`;
      bind.push(model);
    }

    sql += ` ORDER BY ts_start DESC LIMIT ? OFFSET ?`;
    bind.push(limit, offset);

    const rows = await this.db.all<RequestRow[]>(sql, bind);
    return rows.map((row) => this.rowToEvent(row));
  }

  async stats(params: StatsParams): Promise<StatsResult> {
    if (!this.db) {
      throw new Error("Storage not initialized. Call init() first.");
    }

    const { days = 3, model } = params;
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    let sql = `
      SELECT 
        COUNT(*) as totalCalls,
        COALESCE(SUM(input_tokens), 0) as totalInputTokens,
        COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
        COALESCE(SUM(cached_prompt_tokens), 0) as totalCachedPromptTokens,
        COALESCE(SUM(cost), 0) as totalCost
      FROM requests
      WHERE ts_start >= ?
    `;
    
    const bind: (number | string)[] = [cutoffTs];

    if (model) {
      sql += ` AND model_requested = ?`;
      bind.push(model);
    }

    const result = await this.db.get<StatsResult>(sql, bind);

    return {
      totalCalls: result?.totalCalls ?? 0,
      totalInputTokens: result?.totalInputTokens ?? 0,
      totalOutputTokens: result?.totalOutputTokens ?? 0,
      totalCachedPromptTokens: result?.totalCachedPromptTokens ?? 0,
      totalCost: result?.totalCost ?? 0,
    };
  }

  async prune(retentionDays: number): Promise<number> {
    if (!this.db) {
      throw new Error("Storage not initialized. Call init() first.");
    }

    const cutoffTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const startTime = Date.now();

    const result = await this.db.run(
      "DELETE FROM requests WHERE ts_start < ?",
      cutoffTs
    );
    const deletedCount = result.changes ?? 0;
    
    logger.info("Monitor prune completed (sqlite)", {
      deletedCount,
      retentionDays,
      durationMs: Date.now() - startTime,
    });

    return deletedCount;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      logger.info("SQLite monitor storage closed", { dbPath: this.dbPath });
    }
  }

  private rowToEvent(row: RequestRow): MonitorEvent {
    return {
      request_id: row.request_id,
      ts_start: row.ts_start,
      ts_end: row.ts_end,
      latency_ms: row.latency_ms,
      path: row.path,
      method: row.method,
      status_code: row.status_code,
      model_requested: row.model_requested,
      model_upstream: row.model_upstream,
      stream: row.stream === 1,
      chunks: row.chunks,
      bytes_out: row.bytes_out,
      first_token_ms: row.first_token_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cached_prompt_tokens: row.cached_prompt_tokens,
      cost: row.cost,
      error_type: row.error_type,
    };
  }
}