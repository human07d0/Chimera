import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { extractApiKey } from "../utils/auth";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.proxyApiKey) {
    next();
    return;
  }

  const providedKey = extractApiKey(req);

  if (!providedKey) {
    res.status(401).json({
      error: {
        message:
          "Missing API key. Provide it via 'Authorization: Bearer <key>', 'api-key: <key>' or 'x-api-key: <key>' header.",
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
    return;
  }

  if (providedKey !== config.proxyApiKey) {
    res.status(401).json({
      error: {
        message: "Invalid API key.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
    return;
  }

  next();
}
