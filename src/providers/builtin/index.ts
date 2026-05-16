import type { ProviderHandler } from "../types";
import { mimoHandler } from "./mimo";
import { deepseekHandler } from "./deepseek";
import { aliyunHandler } from "./aliyun";
import { kimiHandler } from "./kimi";

export const builtinHandlers: Map<string, ProviderHandler> = new Map([
  ["mimo", mimoHandler],
  ["deepseek", deepseekHandler],
  ["aliyun", aliyunHandler],
  ["kimi", kimiHandler],
]);
