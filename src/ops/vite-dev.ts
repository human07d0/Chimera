import path from "path";
import type { Application } from "express";

import { opsRouter } from "./index";
import { logger } from "../utils/logger";

const VITE_CONFIG_PATH = path.resolve(process.cwd(), "vite.config.ts");

/**
 * Creates Vite dev middleware for the Ops UI in development mode.
 * Mounts the Ops router and Vite's HMR-enabled middleware at /ops.
 *
 * @param app - Express application instance
 * @throws {Error} If Vite config is missing or vite is not installed
 */
export async function createViteDevMiddleware(app: Application): Promise<void> {
  try {
    const { createServer: createViteServer } = await import("vite");
    const viteDevServer = await createViteServer({
      configFile: VITE_CONFIG_PATH,
      server: { middlewareMode: true },
    });

    app.use("/ops", opsRouter);
    app.use("/ops", viteDevServer.middlewares);
    logger.info("Ops dev mode: Vite middleware enabled (HMR)");
  } catch (err) {
    logger.error("Failed to create Vite dev middleware — skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Do NOT re-throw — no error boundary exists upstream.
    // Log and return so the server starts without Vite HMR.
  }
}
