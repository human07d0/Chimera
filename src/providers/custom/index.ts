import type { ProviderHandler } from "../types";
import { openaiHandler } from "./openai";
import { anthropicHandler } from "./anthropic";

export const customHandlers: Map<string, ProviderHandler> = new Map([
  ["openai", openaiHandler],
  ["anthropic", anthropicHandler],
]);
