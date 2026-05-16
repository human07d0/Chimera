import { describe, it, expect } from "vitest";
import { buildPlaygroundConfig } from "../server";

describe("buildPlaygroundConfig", () => {
  const mockGetAllModels = (endpoint: string) => {
    if (endpoint === "") return [
      { model: { id: "model-a" }, providerName: "p1", providerType: "openai" },
      { model: { id: "model-b" }, providerName: "p1", providerType: "openai" },
    ];
    if (endpoint === "/token-plan") return [
      { model: { id: "plan-model" }, providerName: "p2", providerType: "anthropic" },
    ];
    return [];
  };

  it("uses raw endpoint strings as keys in endpointModels (not labels)", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => ["", "/token-plan"],
      getAllModels: mockGetAllModels,
      playgroundToken: "test-token-123",
    });

    expect(result.endpointModels).toEqual({
      "": ["model-a", "model-b"],
      "/token-plan": ["plan-model"],
    });
  });

  it("returns endpoints as a plain string array (not objects with prefix/label)", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => ["", "/token-plan", "/custom-endpoint"],
      getAllModels: () => [],
      playgroundToken: "test-token-456",
    });

    expect(result.endpoints).toEqual(["", "/token-plan", "/custom-endpoint"]);
  });

  it("includes playgroundToken in config", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => [],
      getAllModels: () => [],
      playgroundToken: "my-playground-token",
    });

    expect(result.playgroundToken).toBe("my-playground-token");
  });

  it("includes featureSuffixes in config", () => {
    const result = buildPlaygroundConfig({
      getEndpoints: () => [],
      getAllModels: () => [],
      playgroundToken: "token",
    });

    expect(result.featureSuffixes).toEqual({
      thinking: "-thinking",
      search: "-search",
      json: "-json",
    });
  });
});
