import { Request, Response, NextFunction } from "express";
import { isLocalRequest } from "./isLocalRequest";
import { logger } from "./logger";

export function localhostGuard(req: Request, res: Response, next: NextFunction): void {
  if (isLocalRequest(req)) {
    next();
    return;
  }

  logger.warn("Non-local request blocked by localhostGuard", {
    ip: req.socket.remoteAddress,
    path: req.path,
    method: req.method,
  });

  res.status(404).json({
    error: {
      message: "The requested endpoint does not exist",
      type: "invalid_request_error",
      code: "endpoint_not_found",
    },
  });
}
