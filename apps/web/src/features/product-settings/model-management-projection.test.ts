import { describe, expect, it } from "vitest";
import { parseProfileLlmConfigResult } from "@octos-org/octoscode-client/onboarding";
import { configuredProviderDraft } from "./ModelManagementSection.tsx";
import { selectionFromModelSettingsDraft } from "../models/model-settings.ts";
import {
  modelSettingsDraftFromProvider,
  projectModelManagement,
} from "./model-management-projection.ts";

describe("model management projection", () => {
  it("blocks unknown configured edits but keeps the row visible and deletable", () => {
    const configuration = parseProfileLlmConfigResult({
      profile_id: "coding",
      primary: {
        family_id: "zai",
        model_id: "model",
        route: { route_id: "official", api_type: "openai" },
        has_api_key: true,
        selected: true,
        available: true,
        strong: false,
      },
      fallbacks: [],
    });
    const projection = projectModelManagement({
      capabilities: {
        read: true,
        catalog: false,
        test: true,
        save: true,
        delete: true,
        fetchModels: false,
      },
      phase: "idle",
      catalog: null,
      configuration,
      fetchedModels: [],
      lastTest: null,
      error: null,
    });
    const provider = projection.providers[0]!;
    expect(provider).toMatchObject({
      editable: false,
      removable: true,
      editBlocked: true,
    });
    expect(() =>
      selectionFromModelSettingsDraft(
        modelSettingsDraftFromProvider(configuredProviderDraft(provider), true),
      ),
    ).toThrow("cannot preserve");
  });
  it("retains configured inference values through a label-only existing edit", () => {
    const overrides = {
      temperature: 0,
      top_p: null,
      context_window: 131072,
      reasoning_effort: "max",
      model_hints: {
        fixed_temperature: false,
        reasoning_style: "effort_low_high_max",
      },
    };
    const configuration = parseProfileLlmConfigResult({
      profile_id: "coding",
      primary: {
        family_id: "zai",
        model_id: "model",
        route: { route_id: "official", api_type: "openai" },
        has_api_key: true,
        selected: true,
        available: true,
        ...overrides,
      },
      fallbacks: [],
    });
    expect(configuration).not.toBeNull();
    const projection = projectModelManagement({
      capabilities: {
        read: true,
        catalog: false,
        test: true,
        save: true,
        delete: true,
        fetchModels: false,
      },
      phase: "idle",
      catalog: null,
      configuration,
      fetchedModels: [],
      lastTest: null,
      error: null,
    });
    const draft = configuredProviderDraft(projection.providers[0]!);
    draft.route.label = "Renamed only";
    const selection = selectionFromModelSettingsDraft(
      modelSettingsDraftFromProvider(draft, true),
    );
    expect(selection).toMatchObject(overrides);
    expect(selection.route.label).toBe("Renamed only");
    expect(selection).not.toHaveProperty("max_output_tokens");
  });

  it("keeps the API key outside the controller draft", () => {
    const draft = modelSettingsDraftFromProvider(
      {
        familyId: "zai",
        modelId: "glm-5.3-flash",
        route: {
          id: "official",
          label: "Z.AI",
          baseUrl: "https://api.z.ai/api/paas/v4",
          apiProtocol: "openai",
          apiKeyEnv: "ZAI_API_KEY",
        },
        apiKey: "not-published",
      },
      false,
    );

    expect(draft).toEqual({
      familyId: "zai",
      modelId: "glm-5.3-flash",
      route: {
        routeId: "official",
        label: "Z.AI",
        baseUrl: "https://api.z.ai/api/paas/v4",
        apiKeyEnv: "ZAI_API_KEY",
        apiType: "openai",
      },
      setPrimary: false,
    });
    expect(JSON.stringify(draft)).not.toContain("not-published");
  });

  it("never treats an unread Profile configuration as an empty one", () => {
    const projection = projectModelManagement({
      capabilities: {
        read: true,
        catalog: true,
        test: true,
        save: true,
        delete: true,
        fetchModels: true,
      },
      phase: "idle",
      catalog: { families: [] },
      configuration: null,
      fetchedModels: [],
      lastTest: null,
      error: "Profile configuration could not be read.",
    });

    expect(projection.state).toEqual({
      status: "error",
      message: "Profile configuration could not be read.",
    });
    expect(projection.providers).toEqual([]);
  });

  it("keeps a configured row read-only when Core omits route identity", () => {
    const projection = projectModelManagement({
      capabilities: {
        read: true,
        catalog: false,
        test: true,
        save: true,
        delete: true,
        fetchModels: false,
      },
      phase: "idle",
      catalog: null,
      configuration: {
        profile_id: "coding",
        primary: {
          family_id: "zai",
          model_id: "glm-5.3-flash",
          route: {},
          has_api_key: true,
          selected: true,
          available: true,
        },
        fallbacks: [],
      },
      fetchedModels: [],
      lastTest: null,
      error: null,
    });

    expect(projection.providers[0]).toMatchObject({
      editable: false,
      removable: false,
      route: { id: "", apiProtocol: "" },
      mutationUnavailableReason: expect.stringContaining("read-only"),
    });
  });
});
