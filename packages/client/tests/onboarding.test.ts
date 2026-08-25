import { describe, expect, it } from "vitest";
import {
  parseLlmCatalogResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
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
});
