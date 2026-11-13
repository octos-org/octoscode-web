import { describe, expect, it, vi } from "vitest";
import type {
  ProfileLlmConfigResult,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  MODEL_SETTINGS_METHODS,
  ModelSettingsController,
  type ModelSettingsClient,
  type ModelSettingsDraft,
  type ModelSettingsState,
} from "./model-settings.ts";
import { appuiCaps } from "../../test-fixtures/caps.ts";

const draft: ModelSettingsDraft = {
  familyId: " zai-coding ",
  modelId: " glm-5.3-flash ",
  route: {
    routeId: " official ",
    label: " Coding plan ",
    baseUrl: " https://api.z.ai/api/anthropic ",
    apiKeyEnv: " ZAI_CODING_API_KEY ",
    apiType: " anthropic ",
  },
  setPrimary: true,
};

const configuration: ProfileLlmConfigResult = {
  profile_id: "coding",
  primary: {
    family_id: "zai-coding",
    model_id: "glm-5.3-flash",
    route: {
      route_id: "official",
      api_key_env: "ZAI_CODING_API_KEY",
      api_type: "anthropic",
    },
    has_api_key: true,
    selected: true,
    available: true,
  },
  fallbacks: [],
};

describe("model settings contract", () => {
  it("stops after a failed probe and redacts provider echoes", async () => {
    const upsert = vi.fn();
    const client = fakeClient({
      testLlmProfile: vi.fn(async () => ({
        profile_id: "coding",
        applied: false,
        message: "Bearer secret-plan-key rejected",
        error: "api_key=secret-plan-key is invalid",
      })),
      upsertLlmProfile: upsert,
    });
    const published: ModelSettingsState[] = [];
    const controller = controllerFor(client, published);
    controller.configureCapabilities(allCapabilities());

    expect(await controller.save(draft, "secret-plan-key")).toBeNull();

    expect(upsert).not.toHaveBeenCalled();
    expect(controller.snapshot.error).toContain("[redacted]");
    expect(JSON.stringify(published)).not.toContain("secret-plan-key");
    expect(controller.snapshot.phase).toBe("idle");
  });
});

function controllerFor(
  client: ModelSettingsClient,
  published: ModelSettingsState[],
): ModelSettingsController {
  return new ModelSettingsController({
    client: () => client,
    profileId: () => "coding",
    publish: (state) => published.push(state),
  });
}

function allCapabilities(): UiProtocolCapabilities {
  return appuiCaps({ methods: Object.values(MODEL_SETTINGS_METHODS) });
}

function fakeClient(
  overrides: Partial<ModelSettingsClient> = {},
): ModelSettingsClient {
  return {
    readProfileLlmConfig: async () => configuration,
    getLlmCatalog: async () => ({ families: [] }),
    testLlmProfile: async () => ({
      profile_id: "coding",
      applied: true,
      message: "ok",
    }),
    upsertLlmProfile: async () => ({
      profile_id: "coding",
      applied: true,
    }),
    fetchLlmModels: async () => ({
      profile_id: "coding",
      family_id: "zai-coding",
      models: [],
    }),
    deleteProfileModel: async () => ({
      profile_id: "coding",
      applied: true,
      primary: configuration.primary,
      fallbacks: configuration.fallbacks,
    }),
    ...overrides,
  };
}
