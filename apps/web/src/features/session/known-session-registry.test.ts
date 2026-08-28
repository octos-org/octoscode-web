import { describe, expect, it } from "vitest";
import type { SessionOpened } from "@octos-org/octoscode-client";
import {
  knownSessionFromOpened,
  knownSessionKey,
  parseKnownSessionRegistry,
  rememberKnownSession,
  type KnownSessionRef,
} from "./known-session-registry.ts";

function opened(overrides: Partial<SessionOpened> = {}): SessionOpened {
  return {
    session_id: "coding:api:web-one",
    active_profile_id: "coding",
    workspace_root: "/srv/work/octoscode-web",
    ...overrides,
  };
}

describe("known Session registry", () => {
  it("projects only server-echoed routing identity and local recency", () => {
    expect(knownSessionFromOpened(opened(), 42)).toEqual({
      sessionId: "coding:api:web-one",
      profileId: "coding",
      workspaceRoot: "/srv/work/octoscode-web",
      lastOpenedAt: 42,
    });
    expect(JSON.stringify(knownSessionFromOpened(opened(), 42))).not.toMatch(
      /prompt|title|token|secret/i,
    );
  });

  it("fails closed when Core does not echo profile or Workspace scope", () => {
    expect(
      knownSessionFromOpened(
        {
          session_id: "coding:api:web-one",
          workspace_root: "/srv/work/octoscode-web",
        },
        1,
      ),
    ).toBeNull();
    expect(
      knownSessionFromOpened(opened({ workspace_root: "" }), 1),
    ).toBeNull();
  });

  it("retains multiple Sessions in one Workspace and refreshes one tuple", () => {
    let sessions = rememberKnownSession([], opened(), 10);
    sessions = rememberKnownSession(
      sessions,
      opened({ session_id: "coding:api:web-two" }),
      20,
    );
    sessions = rememberKnownSession(sessions, opened(), 30);

    expect(sessions.map((session) => session.sessionId)).toEqual([
      "coding:api:web-one",
      "coding:api:web-two",
    ]);
    expect(sessions[0]?.lastOpenedAt).toBe(30);
  });

  it("uses Workspace, profile, and id as the compatibility identity", () => {
    const base = knownSessionFromOpened(opened(), 1)!;
    expect(knownSessionKey(base)).not.toBe(
      knownSessionKey({ ...base, profileId: "review" }),
    );
    expect(knownSessionKey(base)).not.toBe(
      knownSessionKey({ ...base, workspaceRoot: "/srv/work/other" }),
    );
  });

  it("rejects a partially corrupt browser projection", () => {
    expect(
      parseKnownSessionRegistry([
        knownSessionFromOpened(opened(), 1),
        {
          sessionId: "coding:api:web-two",
          profileId: "coding",
          workspaceRoot: "/srv/work/octoscode-web",
          lastOpenedAt: Number.NaN,
        },
      ]),
    ).toEqual([]);
  });

  it("bounds long-lived tab state to the 100 most recent Sessions", () => {
    let sessions: KnownSessionRef[] = [];
    for (let index = 0; index < 110; index += 1) {
      sessions = rememberKnownSession(
        sessions,
        opened({ session_id: `coding:api:web-${index}` }),
        index,
      );
    }
    expect(sessions).toHaveLength(100);
    expect(sessions[0]?.sessionId).toBe("coding:api:web-109");
    expect(sessions.at(-1)?.sessionId).toBe("coding:api:web-10");
  });
});
