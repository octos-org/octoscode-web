import { describe, expect, it, vi } from "vitest";
import {
  createSkillCommands,
  parseInstalledSkills,
  parseSkillRegistry,
} from "../src/skills.ts";
import { APPUI_SKILL_METHODS } from "../src/skill-methods.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: Object.values(APPUI_SKILL_METHODS),
  supported_notifications: [],
  supported_features: ["profile.skills.reviewed_install.v1"],
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
      {
        name: "sample",
        version: null,
        toolCount: 0,
        sourceRepo: null,
        sourceCommit: null,
        reviewedAt: null,
        artifactSha256: null,
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("never-export");
    const registry = parseSkillRegistry(
      { profile_id: "p1", server_platform: "linux-x86_64", packages: [pkg] },
      "p1",
    );
    expect(registry?.packages[0]?.installedSkills).toEqual([]);
    expect(registry?.serverPlatform).toBe("linux-x86_64");
    expect(registry?.packages[0]?.binaries).toEqual({});
    expect(
      parseSkillRegistry(
        { profile_id: "p1", server_platform: 7, packages: [] },
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
    await expect(
      none.installReviewed({
        package: "sample",
        repo: "org/sample",
        sourceCommit: "a".repeat(40),
        reviewedAt: "2026-11-11T00:00:00Z",
        platform: "linux-x86_64",
      }),
    ).rejects.toThrow("not advertised");
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
      package: "sample",
      repo: "org/sample",
      source_commit: "a".repeat(40),
      reviewed_at: "2026-11-11T00:00:00Z",
      platform: "linux-x86_64",
      artifact_sha256: null,
      artifact_bytes: null,
    }));
    const commands = createSkillCommands({ request }, "p1", capabilities);
    const receipt = await commands.installReviewed({
      package: "sample",
      repo: "org/sample",
      sourceCommit: "a".repeat(40),
      reviewedAt: "2026-11-11T00:00:00Z",
      platform: "linux-x86_64",
    });
    expect(receipt.sourceCommit).toBe("a".repeat(40));
    expect(request).toHaveBeenLastCalledWith(
      APPUI_SKILL_METHODS.INSTALL_REVIEWED,
      {
        profile_id: "p1",
        package: "sample",
        repo: "org/sample",
        source_commit: "a".repeat(40),
        reviewed_at: "2026-11-11T00:00:00Z",
        platform: "linux-x86_64",
        force: false,
      },
    );
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
