import { describe, expect, it } from "vitest";
import type { LlmCatalogResult } from "@octos-org/octoscode-client";
import {
  orderedProviderFamilies,
  providerPresentation,
} from "./provider-presentation.ts";
import {
  CUSTOM_OPENAI_ROUTE,
  selectionFromCatalog,
} from "./onboarding-submission.ts";

const catalog: LlmCatalogResult = {
  families: [
    {
      id: "anthropic",
      env: "ANTHROPIC_API_KEY",
      models: [{ id: "claude", endpoints: [] }],
    },
    {
      id: "minimax",
      env: "MINIMAX_API_KEY",
      models: [{ id: "minimax-m3", endpoints: [] }],
    },
    {
      id: "dashscope",
      env: "DASHSCOPE_API_KEY",
      models: [{ id: "qwen3", endpoints: [] }],
    },
    {
      id: "zai",
      env: "ZAI_API_KEY",
      models: [{ id: "glm-5.3", endpoints: [] }],
    },
    {
      id: "zhipu",
      env: "ZHIPU_API_KEY",
      models: [{ id: "glm-4-plus", endpoints: [] }],
    },
    {
      id: "moonshot",
      env: "MOONSHOT_API_KEY",
      models: [{ id: "kimi-2.5", endpoints: [] }],
    },
    {
      id: "deepseek",
      env: "DEEPSEEK_API_KEY",
      models: [{ id: "deepseek-chat", endpoints: [] }],
    },
  ],
};

describe("first-run provider presentation", () => {
  it("puts the five domestic providers first in the recommended order", () => {
    expect(orderedProviderFamilies(catalog).map((family) => family.id)).toEqual(
      ["deepseek", "moonshot", "zai", "dashscope", "minimax", "anthropic"],
    );
    expect(providerPresentation("moonshot").name).toBe("Kimi 月之暗面");
  });

  it("sends the custom OpenAI-compatible URL without embedding credentials", () => {
    expect(
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: CUSTOM_OPENAI_ROUTE,
        baseUrl: "http://127.0.0.1:9091/v1",
      }).route,
    ).toMatchObject({
      route_id: "custom-openai",
      base_url: "http://127.0.0.1:9091/v1",
      api_type: "openai",
    });
    expect(() =>
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: CUSTOM_OPENAI_ROUTE,
        baseUrl: "http://user:secret@127.0.0.1:9091/v1",
      }),
    ).toThrow(/without credentials/);
  });
});
