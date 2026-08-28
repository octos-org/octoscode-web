import { describe, expect, it } from "vitest";
import {
  parseLlmCatalogResult,
  parseLlmFetchModelsResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
  parseProfileLlmConfigResult,
  parseProfileLlmDeleteResult,
  parseProfileLlmListResult,
  parseProfileLlmSelectResult,
} from "../src/index.ts";

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

  it("decodes profile creation, provider test, and provider save results", () => {
    expect(
      parseLocalProfileCreateResult({
        profile_id: "coding",
        user_id: "user-coding",
        name: "Coding",
        created: true,
        runtime_mode: "solo",
      }),
    ).toMatchObject({ profile_id: "coding", created: true });
    const tested = parseLlmTestResult({
      profile_id: "coding",
      applied: true,
      message: "Provider test succeeded",
      api_key: "must-not-cross-the-client-boundary",
    });
    expect(tested).toMatchObject({ profile_id: "coding", applied: true });
    expect(tested).not.toHaveProperty("api_key");
    const upserted = parseLlmUpsertResult({
      profile_id: "coding",
      applied: true,
      api_key: "must-not-cross-the-client-boundary",
    });
    expect(upserted).toEqual({ profile_id: "coding", applied: true });
    expect(upserted).not.toHaveProperty("api_key");
    expect(
      parseLlmTestResult({
        profile_id: "coding",
        applied: true,
        message: "Provider test succeeded",
      }),
    ).toMatchObject({ profile_id: "coding", applied: true });
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
    expect(JSON.stringify(parsed)).not.toContain("top-level-secret");
    expect(JSON.stringify(parsed)).not.toContain("nested-secret");
  });

  it("decodes fetched model ids and delete state", () => {
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: ["glm-5.3-flash", "glm-5.2"],
      }),
    ).toEqual({
      profile_id: "coding",
      family_id: "zai",
      models: ["glm-5.3-flash", "glm-5.2"],
    });
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: [],
        reason: "provider_unavailable",
      }),
    ).toEqual({
      profile_id: "coding",
      family_id: "zai",
      models: [],
      reason: "provider_unavailable",
    });

    const deleted = parseProfileLlmDeleteResult({
      profile_id: "coding",
      primary: null,
      fallbacks: [],
      applied: true,
      api_key: "must-not-cross-the-client-boundary",
    });
    expect(deleted).toEqual({
      profile_id: "coding",
      primary: null,
      fallbacks: [],
      applied: true,
    });
    expect(deleted).not.toHaveProperty("api_key");
  });

  it("rejects malformed detailed, fetched, and deleted model results", () => {
    expect(
      parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: configuredModel({ selected: false }),
        fallbacks: [],
      }),
    ).toBeNull();
    expect(
      parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: null,
        fallbacks: [configuredModel({ selected: true })],
      }),
    ).toBeNull();
    expect(
      parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: { ...configuredModel({ selected: true }), route: 42 },
        fallbacks: [],
      }),
    ).toBeNull();
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: ["glm-5.3-flash", { id: "not-a-wire-model-id" }],
      }),
    ).toBeNull();
    expect(
      parseProfileLlmDeleteResult({
        profile_id: "coding",
        primary: null,
        fallbacks: [],
        applied: "yes",
      }),
    ).toBeNull();
  });

  it("enforces collection and text bounds on model-management results", () => {
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: Array.from({ length: 500 }, (_, index) => `model-${index}`),
        reason: "r".repeat(4_096),
      }),
    ).not.toBeNull();
    expect(
      parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: null,
        fallbacks: Array.from({ length: 501 }, () =>
          configuredModel({ selected: false }),
        ),
      }),
    ).toBeNull();
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: Array.from({ length: 501 }, (_, index) => `model-${index}`),
      }),
    ).toBeNull();
    expect(
      parseLlmFetchModelsResult({
        profile_id: "coding",
        family_id: "zai",
        models: ["m".repeat(4_097)],
      }),
    ).toBeNull();
    expect(
      parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: configuredModel({
          selected: true,
          route: {
            route_id: "r".repeat(4_097),
          },
        }),
        fallbacks: [],
      }),
    ).toBeNull();
  });

  it("decodes the configured model directory used by the composer", () => {
    const models = [
      {
        model: "glm-5.2",
        provider: "zai",
        title: "zai / glm-5.2",
        family: "zai",
        route: "official",
        selected: true,
        available: true,
      },
      {
        model: "deepseek-v4-pro",
        provider: "deepseek",
        title: "deepseek / deepseek-v4-pro",
        selected: false,
        available: true,
      },
    ];
    expect(
      parseProfileLlmListResult({ session_id: "coding:local:main", models }),
    ).toEqual({ session_id: "coding:local:main", models });
    expect(
      parseProfileLlmSelectResult({
        session_id: "coding:local:main",
        selected: models[0],
        applied: true,
        restart_required: true,
      }),
    ).toEqual({
      session_id: "coding:local:main",
      selected: models[0],
      applied: true,
      restart_required: true,
    });
  });

  it("rejects a malformed composer model instead of guessing", () => {
    expect(
      parseProfileLlmListResult({
        session_id: "coding:local:main",
        models: [{ model: "glm-5.2", selected: true, available: true }],
      }),
    ).toBeNull();
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
