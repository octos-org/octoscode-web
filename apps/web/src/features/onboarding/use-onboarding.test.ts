import { OctosUiClient } from "@octos-org/octoscode-client";
import { describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_ROUTE,
  selectionFromCatalog,
  submitOnboarding,
} from "./onboarding-submission.ts";
import type { CreatedProfileBinding } from "./use-onboarding.ts";

const catalog = {
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
};

describe("Octoscode onboarding selection", () => {
  it("derives the official route from the server family", () => {
    expect(
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: OFFICIAL_ROUTE,
      }),
    ).toEqual({
      family_id: "deepseek",
      model_id: "deepseek-chat",
      route: {
        route_id: "deepseek",
        label: "Official API",
        api_key_env: "DEEPSEEK_API_KEY",
        api_type: "openai",
      },
    });
  });

  it("preserves a catalog endpoint and rejects stale selections", () => {
    expect(
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: "openrouter",
      }).route,
    ).toMatchObject({
      route_id: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      api_key_env: "OPENROUTER_API_KEY",
    });
    expect(() =>
      selectionFromCatalog(catalog, {
        familyId: "deepseek",
        modelId: "removed",
        routeId: OFFICIAL_ROUTE,
      }),
    ).toThrow("no longer advertised");
  });

  it("preserves a keyless official route without inventing an env name", () => {
    expect(
      selectionFromCatalog(
        {
          families: [
            {
              id: "ollama",
              env: "",
              models: [{ id: "qwen3", endpoints: [] }],
            },
          ],
        },
        {
          familyId: "ollama",
          modelId: "qwen3",
          routeId: OFFICIAL_ROUTE,
        },
      ).route,
    ).toMatchObject({ route_id: "ollama", api_key_env: "" });
  });
});

describe("deferred onboarding submission", () => {
  function setup(invalidatedAt?: "create" | "test" | "save") {
    let current = true;
    const client = new OctosUiClient({ endpoint: "http://localhost" });
    const create = vi
      .spyOn(client, "createLocalProfile")
      .mockImplementation(async () => {
        if (invalidatedAt === "create") current = false;
        return {
          profile_id: "coding",
          user_id: "local",
          name: "Coding",
          created: true,
          runtime_mode: "local",
        };
      });
    const test = vi
      .spyOn(client, "testLlmProfile")
      .mockImplementation(async () => {
        if (invalidatedAt === "test") current = false;
        return { profile_id: "coding", applied: true, message: "Ready" };
      });
    const save = vi
      .spyOn(client, "upsertLlmProfile")
      .mockImplementation(async () => {
        if (invalidatedAt === "save") current = false;
        return { profile_id: "coding", applied: true };
      });
    const onConfigured = vi.fn(async () => {});
    const binding: { current: CreatedProfileBinding | null } = {
      current: null,
    };
    const context = {
      client,
      catalog,
      binding,
      onConfigured,
      setState: vi.fn(),
      isCurrent: () => current,
      submission: {
        profileId: "coding",
        profileName: "Coding",
        makeDefault: true,
        familyId: "deepseek",
        modelId: "deepseek-chat",
        routeId: OFFICIAL_ROUTE,
        apiKey: "test-only-key",
      },
    };
    return { context, create, test, save, onConfigured, binding };
  }

  it("retains the created profile when retrying a failed provider test", async () => {
    const operation = setup();
    operation.test.mockResolvedValueOnce({
      profile_id: "coding",
      applied: false,
      message: "Provider unavailable",
    });
    await expect(submitOnboarding(operation.context)).rejects.toThrow(
      "Provider unavailable",
    );
    expect(operation.binding.current?.profileId).toBe("coding");
    expect(operation.save).not.toHaveBeenCalled();

    await submitOnboarding(operation.context);
    expect(operation.create).toHaveBeenCalledTimes(1);
    expect(operation.test).toHaveBeenCalledTimes(2);
    expect(operation.save).toHaveBeenCalledTimes(1);
    expect(operation.onConfigured).toHaveBeenCalledExactlyOnceWith(
      "coding",
      operation.context.client,
    );
  });

  it.each(["create", "test", "save"] as const)(
    "does not continue after authority changes during %s",
    async (phase) => {
      const operation = setup(phase);
      await submitOnboarding(operation.context);
      expect(operation.onConfigured).not.toHaveBeenCalled();
      if (phase === "create") {
        expect(operation.binding.current).toBeNull();
        expect(operation.test).not.toHaveBeenCalled();
      }
      if (phase !== "save") expect(operation.save).not.toHaveBeenCalled();
    },
  );
});
