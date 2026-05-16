import type { Request } from "express";

export function extractEndpointPrefix(req: Request): string {
  const baseUrl = req.baseUrl.replace("/playground/api", "");
  // The anthropic/v1 alternative serves the anthropic router; chat/models
  // always see /v1 but the superset regex is safe for all three call sites.
  const match = baseUrl.match(/^(.*?)\/(?:v1|anthropic\/v1)$/);
  return match ? match[1] : "";
}
