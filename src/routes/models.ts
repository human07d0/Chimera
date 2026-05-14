import { Router, Request, Response } from "express";
import { modelRegistry } from "../providers/registry";

export const modelsRouter: import("express").Router = Router();

modelsRouter.get("/models", (req: Request, res: Response) => {
  const endpointPrefix = extractEndpointPrefix(req);
  const models = modelRegistry.getAllModels(endpointPrefix);

  const data = models.map(({ model, providerName }) => ({
    id: model.id,
    object: "model",
    created: model.created,
    owned_by: providerName,
    description: model.description,
    context_length: model.context_length,
    max_output_tokens: model.max_output_tokens,
    capabilities: model.capabilities ?? {},
    ...(model.pricing ? { pricing: model.pricing } : {}),
  }));

  res.json({
    object: "list",
    data,
  });
});

modelsRouter.get("/models/:modelId", (req: Request, res: Response) => {
  const modelId = req.params.modelId as string;
  const endpointPrefix = extractEndpointPrefix(req);
  const resolved = modelRegistry.lookup(modelId, endpointPrefix);

  if (!resolved) {
    res.status(404).json({
      error: {
        message: `The model '${modelId}' does not exist`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    });
    return;
  }

  res.json({
    id: resolved.modelConfig.id,
    object: "model",
    created: resolved.modelConfig.created,
    owned_by: resolved.providerConfig.name,
    description: resolved.modelConfig.description,
    context_length: resolved.modelConfig.context_length,
    max_output_tokens: resolved.modelConfig.max_output_tokens,
    capabilities: resolved.modelConfig.capabilities ?? {},
    ...(resolved.modelConfig.pricing ? { pricing: resolved.modelConfig.pricing } : {}),
  });
});

function extractEndpointPrefix(req: Request): string {
  const baseUrl = req.baseUrl;
  const match = baseUrl.match(/^(.*?)\/v1$/);
  return match ? match[1] : "";
}
