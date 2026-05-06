import { Request, Response, Router } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { debugStore } from "./store";
import { DebugMediaItem } from "./types";

export const debugRouter: Router = Router();

function sanitizeMedia(items: DebugMediaItem[] | undefined): Omit<DebugMediaItem, "data_base64">[] {
  if (!items) return [];
  return items.map(({ data_base64, ...rest }) => rest);
}

function parseQueryInt(value: unknown, defaultValue: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseStringParam(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

/** GET /debug/calls — 查询调试记录列表 */
debugRouter.get("/calls", (req: Request, res: Response) => {
  try {
    const limit = parseQueryInt(req.query.limit, 50);
    const offset = parseQueryInt(req.query.offset, 0);
    const model = parseStringParam(req.query.model);
    const search = parseStringParam(req.query.search);

    const { total, items } = debugStore.query({ limit, offset, model, search });

    res.json({
      success: true,
      data: {
        total,
        items: items.map((e) => ({
          request_id: e.request_id,
          ts_start: e.ts_start,
          ts_end: e.ts_end,
          path: e.path,
          method: e.method,
          status_code: e.status_code,
          model_requested: e.model_requested,
          model_upstream: e.model_upstream,
          stream: e.stream,
          error_type: e.error_type,
          request_body: e.request_body,
          response_body: e.response_body,
          media: sanitizeMedia(e.media),
        })),
      },
    });
  } catch (err) {
    logger.error("Debug query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: "Query failed" });
  }
});

/** GET /debug/calls/:id — 获取单条调试记录详情（含完整 body） */
debugRouter.get("/calls/:id", (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const event = debugStore.getById(id);
    if (!event) {
      res.status(404).json({ success: false, error: "Not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        ...event,
        media: sanitizeMedia(event.media),
      },
    });
  } catch (err) {
    logger.error("Debug get-by-id failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: "Query failed" });
  }
});

/** POST /debug/prune — 清空内存缓冲区 */
debugRouter.post("/prune", (req: Request, res: Response) => {
  try {
    const count = debugStore.prune();
    logger.info("Debug store pruned", { count });
    res.json({ success: true, data: { deletedCount: count } });
  } catch (err) {
    logger.error("Debug prune failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: "Prune failed" });
  }
});