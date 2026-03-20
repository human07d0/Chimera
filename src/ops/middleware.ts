import { Request, Response, NextFunction } from "express";
import { config } from "../config";

/**
 * Ops 鉴权中间件
 * 使用 OPS_PASSWORD 进行认证
 */
export function opsAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 未配置 OPS_PASSWORD 时拒绝访问
  if (!config.opsPassword) {
    res.status(503).json({
      success: false,
      error: "Ops interface is disabled (OPS_PASSWORD not configured)",
    });
    return;
  }

  const providedKey = extractOpsPassword(req);

  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: "Missing ops password. Provide it via 'Authorization: Bearer <password>' or 'ops-password: <password>' header.",
    });
    return;
  }

  if (providedKey !== config.opsPassword) {
    res.status(401).json({
      success: false,
      error: "Invalid ops password",
    });
    return;
  }

  next();
}

function extractOpsPassword(req: Request): string | null {
  // 方式一：Authorization: Bearer <password>
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  // 方式二：ops-password: <password>
  const opsPasswordHeader = req.headers["ops-password"];
  if (typeof opsPasswordHeader === "string" && opsPasswordHeader.trim()) {
    return opsPasswordHeader.trim();
  }

  return null;
}
