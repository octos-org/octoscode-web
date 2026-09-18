import { describe, expect, it } from "vitest";
import {
  parseLlmCatalogResult,
  parseLlmInferenceOverrides,
  parseLlmFetchModelsResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
  parseProfileLlmConfigResult,
  parseProfileLlmDeleteResult,
  parseProfileLlmListResult,
  parseProfileLlmSelectResult,
} from "@octos-org/octoscode-client/onboarding";

describe("solo onboarding transport contract", () => {
  it("preserves omission, null, zero, and closed rc11 inference hints", () => {
    expect(parseLlmInferenceOverrides({})).toEqual({});
    const overrides = {
      temperature: 0,
      top_p: 0,
      context_window: 4294967295,
      reasoning_effort: "none",
      model_hints: {
        uses_completion_tokens: false,
        fixed_temperature: true,
        lacks_vision: false,
        merge_system_messages: false,
        reasoning_style: "effort_and_thinking_toggle",
      },
    };
    const parsed = parseLlmInferenceOverrides(overrides);
    expect(parsed).toEqual(overrides);
    overrides.model_hints.lacks_vision = true;
    expect(parsed?.model_hints?.lacks_vision).toBe(false);
    const inherited = {
      temperature: null,
      top_p: null,
      context_window: null,
      reasoning_effort: null,
      model_hints: null,
    };
    expect(parseLlmInferenceOverrides(inherited)).toEqual(inherited);
    expect(parseLlmInferenceOverrides({ model_hints: {} })).toEqual({
      model_hints: {},
    });
  });

  it.each([
    { temperature: NaN },
    { temperature: Infinity },
    { temperature: -1 },
    { temperature: 2.01 },
    { top_p: 1.01 },
    { context_window: 0 },
    { context_window: 1.5 },
    { context_window: 4294967296 },
    { reasoning_effort: "disabled" },
    { reasoning_effort: "xhigh" },
    { model_hints: { fixed_temperature: null } },
    { model_hints: { reasoning_style: null } },
    { model_hints: { reasoning_style: "future" } },
    { model_hints: { future: true } },
    { max_output_tokens: 100 },
    { temperature: undefined },
    { api_key: "not-an-inference-field" },
  ])("rejects invalid or foreign inference configuration %j", (value) => {
    expect(parseLlmInferenceOverrides(value)).toBeNull();
  });

  it.each([
    [{ cost_per_m: 0 }, true],
    [{ strong: false }, true],
    [{ future_setting: null }, true],
    [{ max_output_tokens: 100 }, true],
    [{ cost_per_m: null, strong: null }, false],
    [
      {
        provider: "zai",
        model: "model",
        route_id: "official",
        base_url: null,
        api_key_env: null,
      },
      false,
    ],
  ])(
    "keeps unknown configured values read-only without retaining arbitrary data %j",
    (extra, blocked) => {
      const parsed = parseProfileLlmConfigResult({
        profile_id: "coding",
        primary: {
          family_id: "zai",
          model_id: "model",
          route: { route_id: "official", api_type: "openai" },
          has_api_key: false,
          selected: true,
          available: true,
          ...extra,
        },
        fallbacks: [],
      });
      expect(parsed).not.toBeNull();
      expect(Boolean(parsed?.primary?.edit_blocked)).toBe(blocked);
      expect(parsed?.primary).not.toHaveProperty("max_output_tokens");
      expect(parsed?.primary).not.toHaveProperty("cost_per_m");
      expect(parsed?.primary).not.toHaveProperty("future_setting");
    },
  );
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
