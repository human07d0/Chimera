import { Request } from "express";

export function extractApiKey(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const apiKeyHeader = req.headers["api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  const xApiKeyHeader = req.headers["x-api-key"];
  if (typeof xApiKeyHeader === "string" && xApiKeyHeader.trim()) {
    return xApiKeyHeader.trim();
  }

  return null;
}
