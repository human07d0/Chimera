import { Router, Request, Response } from "express";
import { VIRTUAL_MODELS } from "../models/presets";

export const modelsRouter: import("express").Router = Router();

/**
 * GET /v1/models
 * 返回所有虚拟模型列表，格式与 OpenAI /v1/models 兼容。
 */
modelsRouter.get("/models", (_req: Request, res: Response) => {
  const data = VIRTUAL_MODELS.map((m) => ({
    id: m.id,
    object: "model",
    created: m.created,
    owned_by: "xiaomi-mimo-proxy",
    description: m.description,
    // 将特性标志暴露出来，方便客户端了解每个模型的能力
    capabilities: {
      thinking: m.features.thinking,
      web_search: m.features.search,
      json_output: m.features.json,
    },
  }));

  res.json({
    object: "list",
    data,
  });
});

/**
 * GET /v1/models/:model
 * 返回单个模型信息。
 */
modelsRouter.get("/models/:modelId", (req: Request, res: Response) => {
  const { modelId } = req.params;
  const model = VIRTUAL_MODELS.find((m) => m.id === modelId);

  if (!model) {
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
    id: model.id,
    object: "model",
    created: model.created,
    owned_by: "xiaomi-mimo-proxy",
    description: model.description,
    capabilities: {
      thinking: model.features.thinking,
      web_search: model.features.search,
      json_output: model.features.json,
    },
  });
});
