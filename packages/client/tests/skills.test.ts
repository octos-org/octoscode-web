import { describe, expect, it, vi } from "vitest";
import {
  createSkillCommands,
  parseInstalledSkills,
  parseSkillPackages,
} from "../src/skills.ts";
import { APPUI_SKILL_METHODS } from "../src/skill-methods.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: Object.values(APPUI_SKILL_METHODS),
  supported_notifications: [],
};
const skill = {
  name: "sample",
  version: null,
  tool_count: 0,
  source_repo: null,
};
const pkg = {
  name: "sample",
  description: "Sample",
  repo: "org/sample",
  version: null,
  author: null,
  license: null,
  skills: ["sample"],
  requires: [],
  provides_tools: false,
  tags: [],
  installed: false,
  installed_skills: [],
};

describe("profile skill contracts", () => {
  it("accepts real explicit-null fields and whitelists projected metadata", () => {
    const parsed = parseInstalledSkills(
      {
        profile_id: "p1",
        count: 1,
        skills: [{ ...skill, secret: "never-export" }],
      },
      "p1",
    );
    expect(parsed).toEqual([
      { name: "sample", version: null, toolCount: 0, sourceRepo: null },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("never-export");
    expect(
      parseSkillPackages({ profile_id: "p1", packages: [pkg] }, "p1")?.[0]
        ?.installedSkills,
    ).toEqual([]);
  });
  it("rejects wrong scope, duplicates, mismatched counts and malformed nulls", () => {
    const list = { profile_id: "p1", count: 1, skills: [skill] };
    expect(parseInstalledSkills(list, "p2")).toBeNull();
    expect(parseInstalledSkills({ ...list, count: 2 }, "p1")).toBeNull();
    expect(
      parseInstalledSkills({ ...list, count: 2, skills: [skill, skill] }, "p1"),
    ).toBeNull();
    expect(
      parseInstalledSkills(
        { ...list, skills: [{ ...skill, tool_count: 2 ** 54 }] },
        "p1",
      ),
    ).toBeNull();
    expect(
      parseSkillPackages(
        { profile_id: "p1", packages: [{ ...pkg, version: {} }] },
        "p1",
      ),
    ).toBeNull();
  });
  it("gates before dispatch and binds every read and mutation to the profile", async () => {
    const request = vi.fn(async () => ({}));
    const none = createSkillCommands({ request }, "p1", {
      ...capabilities,
      supported_methods: [],
    });
    await expect(none.list()).rejects.toThrow("not advertised");
    await expect(none.install("org/sample")).rejects.toThrow("not advertised");
    await expect(none.remove("sample")).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ profile_id: "p2", count: 0, skills: [] });
    await expect(
      createSkillCommands({ request }, "p1", capabilities).list(),
    ).rejects.toThrow("wrong-profile");
    expect(request).toHaveBeenLastCalledWith(APPUI_SKILL_METHODS.LIST, {
      profile_id: "p1",
    });
  });
  it("never force-overwrites and checks exact mutation receipts", async () => {
    const request = vi.fn(async () => ({
      profile_id: "p1",
      ok: true,
      installed: ["sample"],
      skipped: [],
      deps_installed: [],
    }));
    const commands = createSkillCommands({ request }, "p1", capabilities);
    await expect(
      commands.install(" org/sample ", " stable "),
    ).resolves.toMatchObject({ installed: ["sample"] });
    expect(request).toHaveBeenLastCalledWith(APPUI_SKILL_METHODS.INSTALL, {
      profile_id: "p1",
      repo: "org/sample",
      branch: "stable",
      force: false,
    });
    await expect(commands.install(" ")).rejects.toThrow("required");
    expect(request).toHaveBeenCalledTimes(1);
    const remove = vi.fn(async () => ({
      profile_id: "p1",
      ok: true,
      removed: "other",
    }));
    await expect(
      createSkillCommands({ request: remove }, "p1", capabilities).remove(
        "sample",
      ),
    ).rejects.toThrow("removal result");
  });
});
