import { Router, Request, Response } from "express";
import { modelRegistry } from "../providers/registry";

interface EndpointInfo {
  method: string;
  path: string;
  description: string;
  auth: boolean;
}

export const apiRouter: ReturnType<typeof Router> = Router();

apiRouter.get("/api", (_req: Request, res: Response) => {
  const endpoints: EndpointInfo[] = [];

  // Static endpoints
  endpoints.push(
    { method: "GET", path: "/health", description: "Health check", auth: false },
    { method: "GET", path: "/api", description: "This endpoint - lists all available APIs", auth: false },

    { method: "GET", path: "/monitor/stats", description: "Monitor statistics", auth: false },
    { method: "GET", path: "/monitor/trend", description: "Monitor trend data", auth: false },
    { method: "GET", path: "/monitor/token-trend", description: "Token usage trend", auth: false },
    { method: "GET", path: "/monitor/calls", description: "Monitor call details", auth: false },
    { method: "POST", path: "/monitor/prune", description: "Prune monitor data (requires auth in production)", auth: true },
  );

  // Dynamic endpoints based on provider registry
  const providerEndpoints = modelRegistry.getEndpoints();

  for (const endpoint of providerEndpoints) {
    const prefix = endpoint || "";

    endpoints.push(
      { method: "GET", path: `${prefix}/v1/models`, description: "List models (OpenAI compatible)", auth: false },
      { method: "POST", path: `${prefix}/v1/chat/completions`, description: "Chat completions (OpenAI compatible)", auth: true },
      { method: "POST", path: `${prefix}/anthropic/v1/messages`, description: "Messages (Anthropic compatible)", auth: true },
      { method: "GET", path: `${prefix}/v1/endpoints`, description: "List provider endpoints", auth: true },
    );
  }

  res.json({
    service: "chimera",
    description: "LLM proxy service - OpenAI/Anthropic compatible facade for multiple upstream providers",
    endpoints,
  });
});
