import type { ProviderHandler, ProviderConfig, ModelConfig, ResolvedModel } from "./types";
import { loadProviders } from "./loader";
import { builtinHandlers } from "./builtin";
import { customHandlers } from "./custom";
import { logger } from "../utils/logger";

export class ProviderRegistry {
  private handlers: Map<string, ProviderHandler>;
  private providers: ProviderConfig[] = [];
  private index: Map<string, Map<string, ResolvedModel>> = new Map();
  private initialized = false;

  constructor() {
    this.handlers = new Map([...builtinHandlers, ...customHandlers]);
  }

  init(configDir?: string): void {
    this.providers = loadProviders(configDir);
    this.buildIndex();
    this.initialized = true;

    const totalModels = this.providers.reduce((sum, p) => sum + p.models.length, 0);
    logger.info("Provider registry initialized", {
      providers: this.providers.length,
      models: totalModels,
      endpoints: [...this.index.keys()],
    });
  }

  private buildIndex(): void {
    this.index.clear();

    for (const provider of this.providers) {
      const handler = this.handlers.get(provider.type);
      if (!handler) {
        throw new Error(`No handler registered for type '${provider.type}'`);
      }

      const endpoint = provider.endpoint || "";
      if (!this.index.has(endpoint)) {
        this.index.set(endpoint, new Map());
      }
      const endpointModels = this.index.get(endpoint)!;

      for (const model of provider.models) {
        if (endpointModels.has(model.id)) {
          throw new Error(
            `Duplicate model id '${model.id}' at endpoint '${endpoint}'`,
          );
        }
        endpointModels.set(model.id, {
          handler,
          providerConfig: provider,
          modelConfig: model,
        });
      }
    }
  }

  lookup(modelId: string, endpointPrefix: string): ResolvedModel | null {
    if (!this.initialized) {
      throw new Error("Registry has not been initialized. Call init() before lookup().");
    }
    const endpoint = endpointPrefix || "";
    const endpointModels = this.index.get(endpoint);
    if (!endpointModels) return null;
    return endpointModels.get(modelId) ?? null;
  }

  getAllModels(endpointPrefix: string): Array<{
    model: ModelConfig;
    providerName: string;
    providerType: string;
  }> {
    const endpoint = endpointPrefix || "";
    const endpointModels = this.index.get(endpoint);
    if (!endpointModels) return [];

    const result: Array<{
      model: ModelConfig;
      providerName: string;
      providerType: string;
    }> = [];

    for (const resolved of endpointModels.values()) {
      result.push({
        model: resolved.modelConfig,
        providerName: resolved.providerConfig.name,
        providerType: resolved.providerConfig.type,
      });
    }

    return result;
  }

  getEndpoints(): string[] {
    return [...this.index.keys()];
  }

  getProviders(): ProviderConfig[] {
    return [...this.providers];
  }
}

export const modelRegistry = new ProviderRegistry();
