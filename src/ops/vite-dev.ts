import path from "path";
import type { Application } from "express";

import { opsRouter } from "./index";
import { logger } from "../utils/logger";

export async function createViteDevMiddleware(app: Application): Promise<void> {
  const { createServer: createViteServer } = await import("vite");
  const viteDevServer = await createViteServer({
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
    server: { middlewareMode: true },
  });

  app.use("/ops", opsRouter);
  app.use("/ops", viteDevServer.middlewares);
  logger.info("Ops dev mode: Vite middleware enabled (HMR)");
}
