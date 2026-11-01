import { describe, expect, it } from "vitest";
import type { WorkspaceCatalogSession } from "../session/workspace-session-catalog.ts";
import {
  RECENT_LIMIT,
  remoteOverview,
  type LiveSessionSnapshot,
} from "./remote-model.ts";

const row = (
  sessionId: string,
  updatedAt: number,
  extra: Partial<WorkspaceCatalogSession> = {},
): WorkspaceCatalogSession => ({
  sessionId,
  profileId: "_main",
  workspaceRoot: "/work/app",
  title: `Title ${sessionId}`,
  lastPrompt: null,
  updatedAt,
  ...extra,
});

const live = (
  sessionId: string,
  state: LiveSessionSnapshot["state"],
  waitingFor: LiveSessionSnapshot["waitingFor"] = null,
): LiveSessionSnapshot => ({
  sessionId,
  profileId: "_main",
  workspaceRoot: "/work/app",
  state,
  waitingFor,
  firstPrompt: null,
});

describe("remote overview", () => {
  it("splits waiting, running and recent, newest first", () => {
    const overview = remoteOverview({
      catalog: [
        row("a", 10, { activeTurn: true }),
        row("b", 30, { activeTurn: true }),
        row("c", 20),
        row("d", 40),
      ],
      live: [
        live("b", "waiting", {
          kind: "approval",
          title: "Run product checks?",
          toolName: "shell",
        }),
        live("c", "failed"),
      ],
    });
    expect(overview.waiting.map((entry) => entry.sessionId)).toEqual(["b"]);
    expect(overview.waiting[0]!.waitingFor?.title).toBe("Run product checks?");
    expect(overview.running.map((entry) => entry.sessionId)).toEqual(["a"]);
    expect(
      overview.recent.map((entry) => [entry.sessionId, entry.state]),
    ).toEqual([
      ["d", "idle"],
      ["c", "failed"],
    ]);
    expect(overview.unwatched).toEqual([
      { sessionId: "a", profileId: "_main", workspaceRoot: "/work/app" },
    ]);
  });

  it("trusts the server listing over a stale idle record", () => {
    const overview = remoteOverview({
      catalog: [row("a", 10, { activeTurn: true })],
      live: [live("a", "completed")],
    });
    expect(overview.running.map((entry) => entry.sessionId)).toEqual(["a"]);
    expect(overview.unwatched).toEqual([]);
  });

  it("keeps a just-started live session the listing has not caught up with", () => {
    const overview = remoteOverview({
      catalog: [],
      live: [{ ...live("new", "running"), firstPrompt: "Fix the build" }],
    });
    expect(overview.running).toMatchObject([
      { sessionId: "new", title: "Fix the build", folderName: "app" },
    ]);
  });

  it("caps the recent list", () => {
    const overview = remoteOverview({
      catalog: Array.from({ length: RECENT_LIMIT + 3 }, (_, index) =>
        row(`s${index}`, index),
      ),
      live: [],
    });
    expect(overview.recent).toHaveLength(RECENT_LIMIT);
    expect(overview.recent[0]!.sessionId).toBe(`s${RECENT_LIMIT + 2}`);
  });
});
