import type { FlatPricing, PriceTier, TieredPricing } from "../providers/types";

export type { FlatPricing, PriceTier, TieredPricing };

export const pricingMap = new Map<string, FlatPricing | TieredPricing>();

export function registerPricing(modelId: string, pricing: FlatPricing | TieredPricing): void {
  pricingMap.set(modelId, pricing);
}

export function registerProviderPricing(
  providers: Array<{ models: Array<{ id: string; upstream: string; pricing?: FlatPricing | TieredPricing }> }>,
): void {
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.pricing) {
        pricingMap.set(model.id, model.pricing);
        pricingMap.set(model.upstream, model.pricing);
      }
    }
  }
}

export function getTier(tokens: number, tiers: PriceTier[]): PriceTier {
  if (tiers.length === 0) {
    throw new Error("Empty tiers");
  }
  const sorted = [...tiers].sort((a, b) => {
    if (a.max_tokens === -1) return 1;
    if (b.max_tokens === -1) return -1;
    return a.max_tokens - b.max_tokens;
  });
  for (const tier of sorted) {
    if (tier.max_tokens === -1 || tokens <= tier.max_tokens) return tier;
  }
  return sorted[sorted.length - 1];
}

export function calculateCost(
  modelId: string,
  promptTokens: number,
  cachedPromptTokens: number,
  completionTokens: number,
): number {
  const pricing = pricingMap.get(modelId);
  if (!pricing) return 0;

  const paidPromptTokens = Math.max(promptTokens - cachedPromptTokens, 0);

  if ("input" in pricing) {
    const cachedCost = (cachedPromptTokens / 1_000_000) * (pricing.cached_input ?? 0);
    const promptCost = (paidPromptTokens / 1_000_000) * pricing.input;
    const completionCost = (completionTokens / 1_000_000) * pricing.output;
    return cachedCost + promptCost + completionCost;
  }

  const tier = getTier(promptTokens + completionTokens, pricing.tiers);
  const cachedCost = (cachedPromptTokens / 1_000_000) * (tier.cached_input ?? 0);
  const promptCost = (paidPromptTokens / 1_000_000) * tier.input;
  const completionCost = (completionTokens / 1_000_000) * tier.output;
  return cachedCost + promptCost + completionCost;
}
