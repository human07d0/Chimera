import type { ProviderHandler } from "../types";
import { mimoHandler } from "./mimo";
import { deepseekHandler } from "./deepseek";

export const builtinHandlers: Map<string, ProviderHandler> = new Map([
  ["mimo", mimoHandler],
  ["deepseek", deepseekHandler],
]);
