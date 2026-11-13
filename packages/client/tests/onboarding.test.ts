import { describe, expect, it } from "vitest";
import {
  parseLlmCatalogResult,
  parseProfileLlmConfigResult,
} from "@octos-org/octoscode-client/onboarding";

describe("solo onboarding transport contract", () => {
  it("projects the server-owned provider catalog into bounded arrays", () => {
    expect(
      parseLlmCatalogResult({
        families: {
          deepseek: {
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
        },
      }),
    ).toEqual({
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
    });
  });

  it("rejects a malformed endpoint instead of guessing its identity", () => {
    expect(
      parseLlmCatalogResult({
        families: {
          deepseek: {
            env: "DEEPSEEK_API_KEY",
            models: [{ id: "deepseek-chat", endpoints: [{ id: 9 }] }],
          },
        },
      }),
    ).toBeNull();
  });

  it("accepts a catalog-advertised keyless provider family", () => {
    expect(
      parseLlmCatalogResult({
        families: {
          ollama: {
            env: "",
            models: [{ id: "qwen3", endpoints: [] }],
          },
        },
      }),
    ).toEqual({
      families: [
        {
          id: "ollama",
          env: "",
          models: [{ id: "qwen3", endpoints: [] }],
        },
      ],
    });
  });

  it("decodes the secret-free detailed profile configuration", () => {
    const primary = configuredModel({
      selected: true,
      model_id: "glm-5.3-flash",
      model: "glm-5.3-flash",
    });
    const fallback = configuredModel({
      selected: false,
      family_id: "deepseek",
      provider: "deepseek",
      model_id: "deepseek-v4-pro",
      model: "deepseek-v4-pro",
    });
    const parsed = parseProfileLlmConfigResult({
      profile_id: "coding",
      primary,
      fallbacks: [fallback],
      llm: { primary, fallbacks: [fallback] },
      api_key: "top-level-secret",
    });

    expect(parsed).toEqual({
      profile_id: "coding",
      primary: {
        family_id: "zai",
        model_id: "glm-5.3-flash",
        edit_blocked: true,
        route: {
          route_id: "official",
          label: "Official",
          base_url: "https://api.z.ai/api/paas/v4",
          api_key_env: "ZAI_API_KEY",
          api_type: "openai",
        },
        has_api_key: true,
        selected: true,
        available: true,
      },
      fallbacks: [
        {
          family_id: "deepseek",
          model_id: "deepseek-v4-pro",
          edit_blocked: true,
          route: {
            route_id: "official",
            label: "Official",
            base_url: "https://api.z.ai/api/paas/v4",
            api_key_env: "ZAI_API_KEY",
            api_type: "openai",
          },
          has_api_key: true,
          selected: false,
          available: true,
        },
      ],
    });
  });
});

function configuredModel(overrides: Record<string, unknown>) {
  return {
    provider: "zai",
    model: "glm-5.2",
    family_id: "zai",
    model_id: "glm-5.2",
    route: {
      route_id: "official",
      label: "Official",
      base_url: "https://api.z.ai/api/paas/v4",
      api_key_env: "ZAI_API_KEY",
      api_type: "openai",
      api_key: "nested-secret",
    },
    route_id: "official",
    base_url: "https://api.z.ai/api/paas/v4",
    api_key_env: "ZAI_API_KEY",
    has_api_key: true,
    selected: false,
    available: true,
    api_key: "nested-secret",
    ...overrides,
  };
}
