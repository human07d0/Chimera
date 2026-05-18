import { Router, Request, Response } from "express";
import { modelRegistry } from "../providers/registry";

export const endpointsRouter: import("express").Router = Router();

endpointsRouter.get("/endpoints", (_req: Request, res: Response) => {
  const endpoints = modelRegistry.getEndpoints();
  res.json({
    object: "list",
    endpoints: endpoints.map((prefix) => ({
      prefix,
      path: prefix ? `${prefix}/v1` : "/v1",
    })),
  });
});
