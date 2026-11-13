import { describe, expect, it, vi } from "vitest";
import { createSkillCommands } from "../src/skills.ts";
import { APPUI_SKILL_METHODS } from "../src/skill-methods.ts";

import { makeCaps } from "./fixtures/caps.ts";

const capabilities = makeCaps({
  methods: Object.values(APPUI_SKILL_METHODS),
  features: ["profile.skills.reviewed_install.v1"],
});

describe("profile skill contracts", () => {
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
