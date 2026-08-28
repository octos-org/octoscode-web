import { describe, expect, it, vi } from "vitest";
import type {
  ProfileLlmConfigResult,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  MODEL_SETTINGS_METHODS,
  ModelSettingsController,
  modelSettingsCapabilities,
  redactModelSettingsError,
  selectionFromModelSettingsDraft,
  type ModelSettingsClient,
  type ModelSettingsDraft,
  type ModelSettingsState,
} from "./model-settings.ts";

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
  it("gates every operation independently from server capabilities", () => {
    const projected = modelSettingsCapabilities(
      capabilities(
        MODEL_SETTINGS_METHODS.READ,
        MODEL_SETTINGS_METHODS.TEST,
        MODEL_SETTINGS_METHODS.DELETE,
      ),
    );
    expect(projected).toEqual({
      read: true,
      catalog: false,
      test: true,
      save: false,
      delete: true,
      fetchModels: false,
    });

    const explicitlyUnsupported = capabilities(MODEL_SETTINGS_METHODS.DELETE);
    explicitlyUnsupported.unsupported = [
      { method: MODEL_SETTINGS_METHODS.DELETE, reason: "disabled" },
    ];
    expect(modelSettingsCapabilities(explicitlyUnsupported).delete).toBe(false);
  });

  it("normalizes an exact Core selection without accepting a credential", () => {
    expect(selectionFromModelSettingsDraft(draft)).toEqual({
      family_id: "zai-coding",
      model_id: "glm-5.3-flash",
      route: {
        route_id: "official",
        label: "Coding plan",
        base_url: "https://api.z.ai/api/anthropic",
        api_key_env: "ZAI_CODING_API_KEY",
        api_type: "anthropic",
      },
    });
    expect(JSON.stringify(draft)).not.toContain("api_key");
  });

  it("tests the exact request before saving and never publishes the raw key", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    let testedSelection: unknown;
    const client = fakeClient({
      testLlmProfile: vi.fn(async (params) => {
        calls.push({ method: "test", params });
        testedSelection = params.selection;
        return {
          profile_id: "coding",
          applied: true,
          message: "Provider connection verified",
        };
      }),
      upsertLlmProfile: vi.fn(async (params) => {
        calls.push({ method: "upsert", params });
        expect(params.selection).toBe(testedSelection);
        return {
          profile_id: "coding",
          applied: true,
        };
      }),
      readProfileLlmConfig: vi.fn(async (params) => {
        calls.push({ method: "read", params });
        return configuration;
      }),
    });
    const published: ModelSettingsState[] = [];
    const controller = controllerFor(client, published);
    controller.configureCapabilities(allCapabilities());

    const result = await controller.save(draft, " secret-plan-key ");

    expect(calls.map((call) => call.method)).toEqual([
      "test",
      "upsert",
      "read",
    ]);
    expect(calls[0]?.params).toMatchObject({
      profile_id: "coding",
      api_key: "secret-plan-key",
      selection: {
        family_id: "zai-coding",
        model_id: "glm-5.3-flash",
      },
    });
    expect(calls[1]?.params).toMatchObject({ set_primary: true });
    expect(result).toEqual({
      test: {
        profileId: "coding",
        applied: true,
        message: "Provider connection verified",
        error: null,
      },
      mutation: {
        profileId: "coding",
        applied: true,
      },
    });
    expect(controller.snapshot.configuration).toBe(configuration);
    expect(JSON.stringify(published)).not.toContain("secret-plan-key");
  });

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

  it("retires an in-flight secret-bearing operation when authority changes", async () => {
    const pending = deferred<{
      profile_id: string;
      applied: boolean;
      message: string;
    }>();
    const upsert = vi.fn();
    const client = fakeClient({
      testLlmProfile: vi.fn(() => pending.promise),
      upsertLlmProfile: upsert,
    });
    const published: ModelSettingsState[] = [];
    let profileId = "coding";
    const controller = new ModelSettingsController({
      client: () => client,
      profileId: () => profileId,
      publish: (state) => published.push(state),
    });
    controller.configureCapabilities(allCapabilities());
    const saving = controller.save(draft, "authority-secret");

    profileId = "review";
    controller.configureCapabilities(allCapabilities());
    pending.resolve({
      profile_id: "coding",
      applied: true,
      message: "authority-secret accepted",
    });

    expect(await saving).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(controller.snapshot.configuration).toBeNull();
    expect(controller.snapshot.lastTest).toBeNull();
    expect(controller.snapshot.phase).toBe("idle");
    expect(JSON.stringify(published)).not.toContain("authority-secret");
  });

  it("fails closed per operation while retaining supported read-only behavior", async () => {
    const read = vi.fn(async () => configuration);
    const catalog = vi.fn();
    const test = vi.fn();
    const fetchModels = vi.fn();
    const remove = vi.fn();
    const client = fakeClient({
      readProfileLlmConfig: read,
      getLlmCatalog: catalog,
      testLlmProfile: test,
      fetchLlmModels: fetchModels,
      deleteProfileModel: remove,
    });
    const controller = controllerFor(client, []);
    controller.configureCapabilities(capabilities(MODEL_SETTINGS_METHODS.READ));

    await controller.refresh();
    expect(controller.snapshot.configuration).toBe(configuration);
    expect(read).toHaveBeenCalledOnce();
    expect(catalog).not.toHaveBeenCalled();
    expect(await controller.test(draft, "unused")).toBeNull();
    expect(await controller.fetchModels(draft, "unused")).toBeNull();
    expect(await controller.delete(draft)).toBeNull();
    expect(test).not.toHaveBeenCalled();
    expect(fetchModels).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("maps model discovery and deletion without inventing success", async () => {
    const client = fakeClient({
      fetchLlmModels: vi.fn(async () => ({
        profile_id: "coding",
        family_id: "zai-coding",
        models: ["glm-5.3", "glm-5.3-flash"],
      })),
      deleteProfileModel: vi.fn(async () => ({
        profile_id: "coding",
        applied: false,
        primary: configuration.primary,
        fallbacks: configuration.fallbacks,
      })),
    });
    const controller = controllerFor(client, []);
    controller.configureCapabilities(allCapabilities());

    expect(await controller.fetchModels(draft)).toMatchObject({
      models: ["glm-5.3", "glm-5.3-flash"],
      reason: null,
    });
    expect(controller.snapshot.fetchedModels).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
    ]);
    expect(await controller.delete(draft)).toEqual({
      profileId: "coding",
      applied: false,
    });
  });

  it("redacts a fulfilled model-discovery reason before publishing it", async () => {
    const published: ModelSettingsState[] = [];
    const client = fakeClient({
      fetchLlmModels: vi.fn(async () => ({
        profile_id: "coding",
        family_id: "zai-coding",
        models: [],
        reason: "Bearer discovery-secret rejected",
      })),
    });
    const controller = controllerFor(client, published);
    controller.configureCapabilities(allCapabilities());

    const result = await controller.fetchModels(draft, "discovery-secret");

    expect(result?.reason).toContain("[redacted]");
    expect(JSON.stringify(published)).not.toContain("discovery-secret");
  });

  it("redacts literal, encoded, named, and bearer credential forms", () => {
    const redacted = redactModelSettingsError(
      "bad secret/key api_key=secret/key Bearer secret/key",
      "secret/key",
    );
    expect(redacted).not.toContain("secret/key");
    expect(redacted).not.toContain("secret%2Fkey");
    expect(redacted).toContain("[redacted]");
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

function capabilities(...methods: string[]): UiProtocolCapabilities {
  return {
    version: { protocol: "octos.ui.v1", schema_version: 1, jsonrpc: "2.0" },
    capabilities_schema_version: 1,
    supported_methods: methods,
    supported_notifications: [],
  };
}

function allCapabilities(): UiProtocolCapabilities {
  return capabilities(...Object.values(MODEL_SETTINGS_METHODS));
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
