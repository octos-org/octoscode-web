import { describe, expect, it } from "vitest";
import {
  findModel,
  formatRelativeTime,
  modelGroups,
  permissionOptions,
  profileDefaultNeedsRestart,
  selectedModel,
} from "./product-projection.ts";

describe("product projections", () => {
  it("projects whole permission presets and retains an unlisted current state", () => {
    expect(
      permissionOptions({
        session_id: "s1",
        current: { mode: "workspace_write", network: "allow" },
        profiles: [
          { mode: "read_only", network: "deny" },
          { mode: "workspace_write", network: "deny" },
        ],
      }),
    ).toMatchObject([
      {
        id: "workspace_write:allow",
        modeLabel: "Write",
        networkLabel: "Network allowed",
      },
      { id: "read_only:deny" },
      { id: "workspace_write:deny" },
    ]);
  });

  it("keeps model route identity inside provider groups", () => {
    const models = [
      {
        model: "glm-5.2",
        provider: "zai",
        title: "GLM 5.2",
        route: "coding",
        selected: true,
        available: true,
      },
    ];
    const groups = modelGroups(models);
    const selected = selectedModel(models);
    expect(groups[0]?.models[0]?.id).toBe("glm-5.2:coding");
    expect(selected).toEqual({
      providerId: "zai",
      modelId: "glm-5.2:coding",
    });
    expect(selected && findModel(models, selected)).toEqual(models[0]);
  });

  it("derives restart truth from runtime and Profile default identities", () => {
    const profileModels = [
      {
        model: "glm-5.2",
        provider: "zai",
        title: "GLM 5.2",
        selected: true,
        available: true,
      },
    ];
    expect(
      profileDefaultNeedsRestart(
        { model: "deepseek-v4", provider: "deepseek" },
        profileModels,
        false,
      ),
    ).toBe(true);
    expect(
      profileDefaultNeedsRestart(
        { model: "glm-5.2", provider: "zai" },
        profileModels,
        true,
      ),
    ).toBe(true);
    expect(profileDefaultNeedsRestart(null, profileModels, true)).toBe(true);
  });

  it("formats compact session timestamps", () => {
    expect(
      formatRelativeTime(
        "2026-08-27T00:00:00Z",
        Date.parse("2026-08-27T00:09:00Z"),
      ),
    ).toBe("9m");
  });
});
