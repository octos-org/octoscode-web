import type { SessionListResult } from "@octos-org/octoscode-client/protocol";
import { describe, expect, it } from "vitest";
import {
  createRemoteCatalog,
  type RemoteCatalogClient,
} from "./remote-catalog.ts";

const SESSION = "_main:api:web-00000000-0000-4000-8000-000000000001";

function fakeClient(options: { failList?: boolean; unscoped?: boolean } = {}) {
  const calls: string[] = [];
  const client: RemoteCatalogClient = {
    async resolveLaunch({ cwd }) {
      calls.push(`resolve ${cwd}`);
      return {
        decision: "resume" as const,
        resolved_profile: "_main",
        existing_profiles: [],
      };
    },
    async listSessions({ cwd, profile_id }) {
      calls.push(`list ${cwd} ${profile_id}`);
      if (options.failList) throw new Error("socket closed");
      return options.unscoped
        ? ({ sessions: [] } as SessionListResult)
        : ({
            workspace_root: cwd,
            profile_id,
            sessions: [
              {
                id: SESSION,
                message_count: 2,
                title: "Fix the build",
                updated_at: "2026-11-01T01:00:00Z",
                active_turn: true,
              },
            ],
          } as SessionListResult);
    },
  };
  return { calls, client };
}

describe("remote catalog", () => {
  it("resolves the folder's profile once, then lists by folder", async () => {
    const fake = fakeClient();
    const catalog = createRemoteCatalog({ profileId: "", now: () => 42 });
    await catalog.refresh(fake.client, ["/work/app"]);
    await catalog.refresh(fake.client, ["/work/app"]);
    expect(fake.calls).toEqual([
      "resolve /work/app",
      "list /work/app _main",
      "list /work/app _main",
    ]);
    expect(catalog.getSnapshot().get("/work/app")).toMatchObject({
      status: "loaded",
      profileId: "_main",
      listedAt: 42,
      sessions: [
        { sessionId: SESSION, title: "Fix the build", activeTurn: true },
      ],
    });
  });

  it("uses the connection's profile when it has one", async () => {
    const fake = fakeClient();
    const catalog = createRemoteCatalog({ profileId: "_main" });
    await catalog.refresh(fake.client, ["/work/app"]);
    expect(fake.calls).toEqual(["list /work/app _main"]);
  });

  it("keeps the last rows when a refresh fails", async () => {
    const good = fakeClient();
    const catalog = createRemoteCatalog({ profileId: "_main" });
    await catalog.refresh(good.client, ["/work/app"]);
    // A reconnect hands the store a new transport that fails.
    const broken = fakeClient({ failList: true });
    await catalog.refresh(broken.client, ["/work/app"]);
    expect(catalog.getSnapshot().get("/work/app")).toMatchObject({
      status: "error",
      error: "socket closed",
      sessions: [{ sessionId: SESSION }],
    });
  });

  it("reports a server that cannot list by folder", async () => {
    const fake = fakeClient({ unscoped: true });
    const catalog = createRemoteCatalog({ profileId: "_main" });
    await catalog.refresh(fake.client, ["/work/app"]);
    expect(catalog.getSnapshot().get("/work/app")).toMatchObject({
      status: "error",
      sessions: [],
    });
  });
});
