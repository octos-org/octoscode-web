import { describe, expect, it } from "vitest";
import { mergeConfirmedRetainedSessions } from "./retained-session-catalog.ts";

describe("confirmed background navigation", () => {
  it("includes untouched forks and peers across workspaces without replacing existing recency", () => {
    const master = {
      sessionId: "master",
      profileId: "p",
      workspaceRoot: "/project",
      lastOpenedAt: 123,
    };
    const fork = {
      sessionId: "fork",
      profileId: "p",
      workspaceRoot: "/project",
    };
    const peer = {
      sessionId: "p:local:tui#peer-review",
      profileId: "p",
      workspaceRoot: "/peer-worktree",
    };
    expect(
      mergeConfirmedRetainedSessions([master], [master, fork, peer]),
    ).toEqual([
      master,
      { ...fork, lastOpenedAt: 0 },
      { ...peer, lastOpenedAt: 0 },
    ]);
  });
  it("does not collapse equal session IDs from different profiles/workspaces", () => {
    const base = { sessionId: "same", profileId: "p", workspaceRoot: "/a" };
    expect(
      mergeConfirmedRetainedSessions(
        [],
        [base, { ...base, profileId: "q" }, { ...base, workspaceRoot: "/b" }],
      ),
    ).toHaveLength(3);
  });
});
