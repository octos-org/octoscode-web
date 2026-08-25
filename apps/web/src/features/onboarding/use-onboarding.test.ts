import { describe, expect, it } from "vitest";
import { OFFICIAL_ROUTE, selectionFromCatalog } from "./use-onboarding.ts";

const catalog = {
  families: [
    {
      id: "deepseek",
      env: "DEEPSEEK_API_KEY",
      models: [
        {
          id: "deepseek-chat",
          endpoints: [
            {
              id: "openrouter",
              label: "OpenRouter",
              base_url: "https://openrouter.ai/api/v1",
              api_key_env: "OPENROUTER_API_KEY",
              api_type: "openai",
            },
          ],
        },
      ],
    },
  ],
};

describe("Octoscode onboarding selection", () => {
  it("derives the official route from the server family", () => {
    expect(
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: OFFICIAL_ROUTE,
      }),
    ).toEqual({
      family_id: "deepseek",
      model_id: "deepseek-chat",
      route: {
        route_id: "deepseek",
        label: "Official API",
        api_key_env: "DEEPSEEK_API_KEY",
        api_type: "openai",
      },
    });
  });

  it("preserves a catalog endpoint and rejects stale selections", () => {
    expect(
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: "openrouter",
      }).route,
    ).toMatchObject({
      route_id: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      api_key_env: "OPENROUTER_API_KEY",
    });
    expect(() =>
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "removed",
        routeId: OFFICIAL_ROUTE,
      }),
    ).toThrow("no longer advertised");
  });

  it("preserves a keyless official route without inventing an env name", () => {
    expect(
      selectionFromCatalog(
        {
          families: [
            {
              id: "ollama",
              env: "",
              models: [{ id: "qwen3", endpoints: [] }],
            },
          ],
        },
        {
          familyId: "ollama",
          modelId: "qwen3",
          routeId: OFFICIAL_ROUTE,
        },
      ).route,
    ).toMatchObject({ route_id: "ollama", api_key_env: "" });
  });
});
