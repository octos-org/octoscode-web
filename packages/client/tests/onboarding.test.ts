import { describe, expect, it } from "vitest";
import {
  parseLlmCatalogResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
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
    expect(
      parseLlmTestResult({
        profile_id: "coding",
        applied: true,
        message: "Provider test succeeded",
      }),
    ).toMatchObject({ profile_id: "coding", applied: true });
    expect(
      parseLlmUpsertResult({ profile_id: "coding", applied: true }),
    ).toEqual({ profile_id: "coding", applied: true });
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
