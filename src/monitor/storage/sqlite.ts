import initSqlJs, { Database, Statement } from 'sql.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../../utils/logger';
import { MonitorEvent, MonitorStorage, QueryParams, StatsParams, StatsResult, TrendParams, TrendBucket, TokenTrendParams, TokenTrendBucket } from './index';

type RequestRow = [
  string,  // request_id
  number,  // ts_start
  number,  // ts_end
  number,  // latency_ms
  string,  // path
  string,  // method
  number,  // status_code
  string,  // model_requested
  string,  // model_upstream
  number,  // stream
  number,  // chunks
  number,  // bytes_out
  number | null,  // first_token_ms
  number,  // input_tokens
  number,  // output_tokens
  number,  // cached_prompt_tokens
  number,  // cost
  string | null,  // error_type
  string   // source ("main" | "token-plan")
];

export class SqliteStorage implements MonitorStorage {
  private db: Database | null = null;
  private readonly dbPath: string;
  private static sqlModule: import('sql.js').SqlJsStatic | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  static async initSqlModule(): Promise<void> {
    if (!SqliteStorage.sqlModule) {
      SqliteStorage.sqlModule = await initSqlJs();
      logger.info('sql.js module initialized');
    }
  }

  init(): void {
    if (!SqliteStorage.sqlModule) {
      throw new Error('sql.js module not initialized. Call SqliteStorage.initSqlModule() first.');
    }

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created monitor database directory: ${dir}`);
    }

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SqliteStorage.sqlModule.Database(buffer);
      logger.info(`Loaded existing SQLite database: ${this.dbPath}`);
    } else {
      this.db = new SqliteStorage.sqlModule.Database();
      logger.info(`Created new SQLite database: ${this.dbPath}`);
    }

    // 启用 WAL 模式以提高并发性能
    if (this.db) {
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
      this.db.run('PRAGMA busy_timeout = 5000');
    }

    this.initTables();
    this.saveToFile();

    logger.info(`SQLite monitor storage initialized: ${this.dbPath}`);
  }

  private initTables(): void {
    if (!this.db) return;

    this.db.run(`
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
        error_type TEXT,
        source TEXT NOT NULL DEFAULT 'main'
      )
    `);

    // 向后兼容：为已有数据库添加 source 列
    try {
      this.db.run(`ALTER TABLE requests ADD COLUMN source TEXT NOT NULL DEFAULT 'main'`);
    } catch {
      // 列已存在，忽略
    }

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_requests_ts_start ON requests(ts_start)
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_requests_status_ts_start ON requests(status_code, ts_start)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_requests_model_requested_ts_start ON requests(model_requested, ts_start)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_requests_source_ts_start ON requests(source, ts_start)
    `);
  }

  private saveToFile(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  append(event: MonitorEvent): void {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
    }

    this.db.run('BEGIN TRANSACTION');
    try {
      const stmt = this.db.prepare(`
        INSERT INTO requests (
          request_id, ts_start, ts_end, latency_ms,
          path, method, status_code,
          model_requested, model_upstream,
          stream, chunks, bytes_out, first_token_ms,
          input_tokens, output_tokens, cached_prompt_tokens, cost,
          error_type, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.bind([
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
        event.source,
      ]);

      stmt.step();
      stmt.free();
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }

    this.saveToFile();
  }

  query(params: QueryParams): MonitorEvent[] {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
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

    const stmt = this.db.prepare(sql);
    stmt.bind(bind);

    const rows: RequestRow[] = [];
    while (stmt.step()) {
      rows.push(stmt.get() as RequestRow);
    }
    stmt.free();

    return rows.map((row) => this.rowToEvent(row));
  }

  stats(params: StatsParams): StatsResult {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
    }

    const { days = 3, start, end, model, source } = params;
    const cutoffTs = start ?? Date.now() - days * 24 * 60 * 60 * 1000;

    let sql = `
      SELECT 
        COUNT(*) as totalCalls,
        COALESCE(SUM(input_tokens), 0) as totalInputTokens,
        COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
        COALESCE(SUM(cached_prompt_tokens), 0) as totalCachedPromptTokens,
        COALESCE(SUM(input_tokens + output_tokens), 0) as totalTokens,
        COALESCE(SUM(cost), 0) as totalCost
      FROM requests
      WHERE ts_start >= ?
    `;
    
    const bind: (number | string)[] = [cutoffTs];
    if (end !== undefined) {
      sql += ` AND ts_start < ?`;
      bind.push(end);
    }

    if (model) {
      sql += ` AND model_requested = ?`;
      bind.push(model);
    }

    if (source) {
      sql += ` AND source = ?`;
      bind.push(source);
    }

    const stmt = this.db.prepare(sql);
    stmt.bind(bind);

    if (stmt.step()) {
      const row = stmt.get() as [number, number, number, number, number, number];
      stmt.free();
      return {
        totalCalls: row[0] ?? 0,
        totalInputTokens: row[1] ?? 0,
        totalOutputTokens: row[2] ?? 0,
        totalCachedPromptTokens: row[3] ?? 0,
        totalTokens: row[4] ?? 0,
        totalCost: row[5] ?? 0,
      };
    }

    stmt.free();
    return {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedPromptTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    };
  }

  trend(params: TrendParams): TrendBucket[] {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
    }

    const { days = 3, start, end, model, source, granularity } = params;
    const cutoffTs = start ?? Date.now() - days * 24 * 60 * 60 * 1000;

    const truncation = granularity === "hour" ? 3600000 : granularity === "6h" ? 21600000 : 86400000;

    let sql = `
      SELECT
        CAST((ts_start / ?) * ? AS INTEGER) as bucket_ts,
        COUNT(*) as calls,
        COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
        COALESCE(SUM(cost), 0) as cost,
        COALESCE(AVG(latency_ms), 0) as latency_ms
      FROM requests
      WHERE ts_start >= ?
    `;

    const bind: (number | string)[] = [truncation, truncation, cutoffTs];
    if (end !== undefined) {
      sql += ` AND ts_start < ?`;
      bind.push(end);
    }

    if (model) {
      sql += ` AND model_requested = ?`;
      bind.push(model);
    }

    if (source) {
      sql += ` AND source = ?`;
      bind.push(source);
    }

    sql += ` GROUP BY bucket_ts ORDER BY bucket_ts ASC`;

    const stmt = this.db.prepare(sql);
    stmt.bind(bind);

    const buckets: TrendBucket[] = [];
    while (stmt.step()) {
      const row = stmt.get() as [number, number, number, number, number];
      buckets.push({
        ts: row[0],
        calls: row[1],
        tokens: row[2],
        cost: row[3],
        latency_ms: Math.round(row[4]),
      });
    }
    stmt.free();

    return buckets;
  }

  tokenTrend(params: TokenTrendParams): TokenTrendBucket[] {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
    }

    const { start, end, source } = params;
    const cutoffTs = start ?? Date.now() - 3 * 24 * 60 * 60 * 1000;

    let sql = `
      SELECT
        CAST((ts_start / 86400000) * 86400000 AS INTEGER) as bucket_ts,
        model_upstream,
        COUNT(*) as calls,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cached_prompt_tokens), 0) as cached_prompt_tokens
      FROM requests
      WHERE ts_start >= ?
    `;

    const bind: (number | string)[] = [cutoffTs];
    if (end !== undefined) {
      sql += ` AND ts_start < ?`;
      bind.push(end);
    }

    if (source) {
      sql += ` AND source = ?`;
      bind.push(source);
    }

    sql += ` GROUP BY bucket_ts, model_upstream ORDER BY bucket_ts ASC, model_upstream ASC`;

    const stmt = this.db.prepare(sql);
    stmt.bind(bind);

    const buckets: TokenTrendBucket[] = [];
    while (stmt.step()) {
      const row = stmt.get() as [number, string, number, number, number, number];
      buckets.push({
        ts: row[0],
        model_upstream: row[1],
        calls: row[2],
        input_tokens: row[3],
        output_tokens: row[4],
        cached_prompt_tokens: row[5],
      });
    }
    stmt.free();

    return buckets;
  }

  prune(retentionDays: number): number {
    if (!this.db) {
      throw new Error('Storage not initialized. Call init() first.');
    }

    const cutoffTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const startTime = Date.now();

    const stmt = this.db.prepare('DELETE FROM requests WHERE ts_start < ?');
    stmt.bind([cutoffTs]);
    stmt.step();
    const deletedCount = this.db.getRowsModified();
    stmt.free();

    this.saveToFile();

    logger.info('Monitor prune completed (sql.js)', {
      deletedCount,
      retentionDays,
      durationMs: Date.now() - startTime,
    });

    return deletedCount;
  }

  close(): void {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
      logger.info('SQLite monitor storage closed', { dbPath: this.dbPath });
    }
  }

  private rowToEvent(row: RequestRow): MonitorEvent {
    return {
      request_id: row[0],
      ts_start: row[1],
      ts_end: row[2],
      latency_ms: row[3],
      path: row[4],
      method: row[5],
      status_code: row[6],
      model_requested: row[7],
      model_upstream: row[8],
      stream: row[9] === 1,
      chunks: row[10],
      bytes_out: row[11],
      first_token_ms: row[12],
      input_tokens: row[13],
      output_tokens: row[14],
      cached_prompt_tokens: row[15],
      cost: row[16],
      error_type: row[17],
      source: row[18] === "token-plan" ? "token-plan" : "main",
    };
  }
}