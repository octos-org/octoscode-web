import { describe, expect, it } from "vitest";
import {
  modelSettingsDraftFromProvider,
  projectModelManagement,
} from "./model-management-projection.ts";

describe("model management projection", () => {
  it("projects bounded Core configuration without a credential value", () => {
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
      catalog: {
        families: [
          {
            id: "zai",
            env: "ZAI_API_KEY",
            models: [
              {
                id: "glm-5.3-flash",
                endpoints: [
                  {
                    id: "official",
                    label: "Z.AI",
                    base_url: "https://api.z.ai/api/paas/v4",
                    api_key_env: "ZAI_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
            ],
          },
        ],
      },
      configuration: {
        profile_id: "coding",
        primary: {
          family_id: "zai",
          model_id: "glm-5.3-flash",
          route: {
            route_id: "official",
            label: "Z.AI",
            base_url: "https://api.z.ai/api/paas/v4",
            api_key_env: "ZAI_API_KEY",
            api_type: "openai",
          },
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

    expect(projection.state).toEqual({ status: "ready" });
    expect(projection.providers).toEqual([
      expect.objectContaining({
        id: "zai:glm-5.3-flash:official",
        modelLabel: "GLM-5.3-Flash",
        apiKeyConfigured: true,
        primary: true,
      }),
    ]);
    expect(projection.families[0]?.models[0]).toEqual(
      expect.objectContaining({
        id: "glm-5.3-flash",
        route: expect.objectContaining({ apiKeyEnv: "ZAI_API_KEY" }),
      }),
    );
    expect(JSON.stringify(projection)).not.toContain('apiKey":');
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
