import { describe, expect, it } from "vitest";
import type { LlmCatalogResult } from "@octos-org/octoscode-client";
import {
  orderedProviderFamilies,
  providerPresentation,
} from "./provider-presentation.ts";
import {
  CUSTOM_OPENAI_ROUTE,
  OFFICIAL_ROUTE,
  selectionFromCatalog,
} from "./onboarding-submission.ts";

const catalog: LlmCatalogResult = {
  families: [
    {
      id: "zai-coding",
      env: "ZAI_API_KEY",
      models: [{ id: "glm-5.3", endpoints: [] }],
    },
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
  it("puts six curated providers first, including the coding-plan family", () => {
    expect(orderedProviderFamilies(catalog).map((family) => family.id)).toEqual(
      [
        "zai-coding",
        "deepseek",
        "moonshot",
        "zai",
        "dashscope",
        "minimax",
        "zhipu",
        "anthropic",
      ],
    );
    expect(
      orderedProviderFamilies(catalog)
        .slice(0, 6)
        .map((family) => family.id),
    ).toContain("zai-coding");
    expect(providerPresentation("moonshot").name).toBe("Kimi 月之暗面");
  });

  it("uses readable names and accurate descriptions for other providers", () => {
    expect(providerPresentation("anthropic")).toEqual({
      name: "Anthropic",
      tag: "Claude models from Anthropic",
    });
    expect(providerPresentation("gemini")).toEqual({
      name: "Google Gemini",
      tag: "Gemini models from Google",
    });
  });

  it("keeps Z.ai and Zhipu official family, model and route identities", () => {
    for (const [familyId, modelId, apiKeyEnv] of [
      ["zai", "glm-5.3", "ZAI_API_KEY"],
      ["zhipu", "glm-4-plus", "ZHIPU_API_KEY"],
    ] as const) {
      expect(
        selectionFromCatalog(catalog, {
          familyId,
          modelId,
          routeId: OFFICIAL_ROUTE,
        }),
      ).toMatchObject({
        family_id: familyId,
        model_id: modelId,
        route: { route_id: familyId, api_key_env: apiKeyEnv },
      });
    }
    expect(providerPresentation("zhipu").name).toBe("智谱 AI");
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
