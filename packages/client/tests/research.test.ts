import { describe, expect, it, vi } from "vitest";
import {
  createResearchCommands,
  parseResearchLanes,
  parseResearchLaneMutation,
  researchLaneParams,
  type ResearchLane,
} from "../src/research.ts";
import { APPUI_RESEARCH_METHODS } from "../src/research-methods.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: Object.values(APPUI_RESEARCH_METHODS),
  supported_notifications: [],
};
const row = {
  key: "cheap",
  provider: "deepseek",
  model: null,
  api_key_env: null,
  base_url: null,
  description: null,
  default_context_window: null,
  max_output_tokens: null,
  api_type: null,
};
const lane: ResearchLane = {
  key: "cheap",
  provider: "deepseek",
  model: null,
  apiKeyEnv: null,
  baseUrl: null,
  description: null,
  contextWindow: null,
  maxOutputTokens: null,
  apiType: null,
};
const list = { profile_id: "p1", sub_providers: [row] };

describe("research lane wire contract", () => {
  it.each([" synthetic-secret ", 'synthetic-"secret"\nvalue'])(
    "never returns normalized or escaped credential-bearing errors",
    async (credential) => {
      const request = vi.fn(async () => {
        throw new Error("Upstream echo: " + JSON.stringify(credential.trim()));
      });
      const commands = createResearchCommands({ request }, "p1", capabilities);
      try {
        await commands.upsert({ ...lane, apiKeyEnv: "KEY_NAME" }, credential);
        expect.fail("Expected a rejected save");
      } catch (cause) {
        expect(String(cause)).toContain("Could not confirm");
        expect(String(cause)).not.toContain("synthetic");
      }
    },
  );
  it("parses exact nullable fields, excludes unknown secrets and enforces owner/unique keys", () => {
    expect(
      parseResearchLanes(
        { ...list, sub_providers: [{ ...row, api_key: "never-retain" }] },
        "p1",
      )?.lanes,
    ).toEqual([lane]);
    expect(parseResearchLanes(list, "other")).toBeNull();
    expect(
      parseResearchLanes({ ...list, sub_providers: [row, row] }, "p1"),
    ).toBeNull();
    expect(
      parseResearchLanes(
        { ...list, sub_providers: [{ ...row, max_output_tokens: 2 ** 32 }] },
        "p1",
      ),
    ).toBeNull();
    expect(
      researchLaneParams({ ...lane, extra: "never-send" } as ResearchLane),
    ).toEqual(row);
  });
  it("treats persisted and restart-required as distinct explicit receipt fields", () => {
    expect(
      parseResearchLaneMutation(
        { ...list, applied: true, restart_required: true },
        "p1",
      ),
    ).toMatchObject({ applied: true, restartRequired: true });
    expect(
      parseResearchLaneMutation(
        { ...list, applied: false, restart_required: false },
        "p1",
      ),
    ).toMatchObject({ applied: false, restartRequired: false });
    expect(
      parseResearchLaneMutation({ ...list, applied: true }, "p1"),
    ).toBeNull();
  });
  it("gates before wire, requires credential destination and redacts an echoed secret", async () => {
    const request = vi.fn(async () => ({}));
    await expect(
      createResearchCommands({ request }, "p1", {
        ...capabilities,
        supported_methods: [],
      }).list(),
    ).rejects.toThrow("not advertised");
    const commands = createResearchCommands({ request }, "p1", capabilities);
    await expect(commands.upsert(lane, "synthetic-secret")).rejects.toThrow(
      "environment name",
    );
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(
      new Error("provider echoed synthetic-secret"),
    );
    await expect(
      commands.upsert(
        { ...lane, apiKeyEnv: "DEEPSEEK_API_KEY" },
        "synthetic-secret",
      ),
    ).rejects.toThrow("Could not confirm the credential-bearing lane save");
    expect(request).toHaveBeenCalledWith(APPUI_RESEARCH_METHODS.UPSERT, {
      profile_id: "p1",
      sub_provider: { ...row, api_key_env: "DEEPSEEK_API_KEY" },
      api_key: "synthetic-secret",
    });
  });
  it("never invents defaults or includes an omitted secret", async () => {
    const request = vi.fn(async () => ({
      ...list,
      applied: true,
      restart_required: true,
    }));
    const commands = createResearchCommands({ request }, "p1", capabilities);
    await expect(commands.upsert(lane)).resolves.toMatchObject({
      restartRequired: true,
    });
    expect(request).toHaveBeenLastCalledWith(APPUI_RESEARCH_METHODS.UPSERT, {
      profile_id: "p1",
      sub_provider: row,
    });
    request.mockResolvedValueOnce({
      ...list,
      sub_providers: [],
      applied: true,
      restart_required: true,
    });
    await commands.remove("cheap");
    expect(request).toHaveBeenLastCalledWith(APPUI_RESEARCH_METHODS.REMOVE, {
      profile_id: "p1",
      key: "cheap",
    });
  });
});
