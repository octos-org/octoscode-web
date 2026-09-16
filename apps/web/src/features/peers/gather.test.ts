import { describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  createPeerCommands,
  type PeerGatherResult,
} from "@octos-org/octoscode-client/peers";
import { PromptTurnQueue } from "../composer/turn-queue.ts";
import type { GatherRecord } from "./gather.ts";
import type { ActiveSessionAuthority } from "../session/active-session-runtime.ts";
import { composeGatherPrompt, gatherFromRecord } from "./gather.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["peer/gather", "turn/start"],
  supported_notifications: [],
};
const row = (slug: string, result: string | null, brief = "Review this") => ({
  slug,
  topic: `peer-${slug}`,
  brief,
  result,
  brief_truncated: false,
  result_truncated: false,
  result_updated_unix: null,
  has_worktree: false,
  closed: false,
});
const result: PeerGatherResult = {
  profile_id: "dev",
  peers: [row("review", "Done")],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function setup() {
  const client = new OctosUiClient({ endpoint: "ws://127.0.0.1:1" });
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  let live = true,
    writable = true;
  const scope = {
    endpoint: "ws://127.0.0.1:1",
    workspaceRoot: "/repo",
    profileId: "dev",
    sessionId: "A",
    authorityEpoch: 1,
  };
  const authority: ActiveSessionAuthority<OctosUiClient> = {
    client,
    generation: 1,
    sessionId: "A",
    profileId: "dev",
    cwd: "/repo",
    capabilities: caps,
    opened: null,
    config: {
      endpoint: scope.endpoint,
      cwd: "/repo",
      profileId: "dev",
      sessionId: "A",
      token: "",
    },
  };
  const queue = new PromptTurnQueue();
  const record: GatherRecord & { queue: PromptTurnQueue } = {
    scope,
    closed: false,
    queue,
    runtime: {
      getSnapshot: () => ({
        phase: live ? "ready" : "recovering",
        recovery: { phase: live ? "healthy" : "hydrating" },
      }),
      isCurrent: (candidate) => live && candidate === authority,
      currentAuthority: () => authority,
    },
    controller: {
      enqueueTurn(turn) {
        if (!writable) return false;
        queue.enqueue(turn);
        return true;
      },
    },
  };
  const response = deferred<PeerGatherResult>();
  const rpc = vi.fn().mockReturnValue(response.promise);
  const factory = vi
    .spyOn(client, "peerCommands")
    .mockImplementation(async (sessionId, profileId, capabilities, owner) =>
      createPeerCommands(
        { request: rpc },
        { sessionId, profileId, authority: owner! },
        capabilities,
      ),
    );
  const request = {
    record,
    authority,
    isRetained: (owner: GatherRecord) => live && owner === record,
    pooledClient: () => client,
    canSubmit: () => writable,
    reasoningEffort: "high" as const,
  };
  return {
    record,
    request,
    response,
    rpc,
    factory,
    stale() {
      live = false;
    },
    readOnly() {
      writable = false;
    },
  };
}

describe("TUI peer gather composition", () => {
  it("matches completed and missing-result sections and limits brief Unicode characters", () => {
    const text = composeGatherPrompt({
      profile_id: "dev",
      peers: [row("done", "Finished", "🦑".repeat(201)), row("busy", null)],
    });
    expect(text).toContain(
      "## peer done (done)\nBrief: " + "🦑".repeat(200) + "\n\nFinished\n",
    );
    expect(text).toContain("## peer busy (no result yet)");
    expect(text).toContain("(still running — no result file yet)");
  });
  it("bounds UTF-8 synthesis at64KiB with fair marked truncation and no broken codepoints", () => {
    const text = composeGatherPrompt({
      profile_id: "dev",
      peers: [
        row("one", "🦑".repeat(30000)),
        row("two", "界".repeat(40000)),
        row("busy", null),
      ],
    });
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(65536);
    expect(text.match(/result truncated/g)).toHaveLength(2);
    expect(text).not.toContain("�");
    expect(text).toContain("## peer busy");
  });
  it("fails closed when Profile-wide scaffolding alone cannot fit", () => {
    expect(() =>
      composeGatherPrompt({
        profile_id: "dev",
        peers: Array.from({ length: 1000 }, (_, index) =>
          row(`p${index}`, null, "界".repeat(200)),
        ),
      }),
    ).toThrow("prompt limit");
  });
});

describe("record-owned gather synthesis", () => {
  it("queues exactly once behind A1 despite selecting B while the read is pending", async () => {
    const h = setup();
    h.record.queue.enqueue({ turnId: "A1", text: "First" });
    const first = gatherFromRecord({ ...h.request, slugs: ["review"] });
    const second = gatherFromRecord({ ...h.request, slugs: ["review"] });
    expect(second).toBe(first);
    // Selecting B does not replace the captured origin record A.
    const b = { queue: new PromptTurnQueue() };
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    expect(h.rpc).toHaveBeenCalledWith("peer/gather", {
      session_id: "A",
      profile_id: "dev",
      slugs: ["review"],
    });
    h.response.resolve(result);
    expect(await first).toBe("queued");
    expect(h.record.queue.snapshot().active?.turnId).toBe("A1");
    expect(h.record.queue.snapshot().pending).toHaveLength(1);
    expect(h.record.queue.snapshot().pending[0]).toMatchObject({
      text: composeGatherPrompt(result),
      reasoningEffort: "high",
    });
    expect(b.queue.snapshot().active).toBeNull();
  });
  it("does not report a different pending filter as successfully queued", async () => {
    const h = setup();
    const first = gatherFromRecord({ ...h.request, slugs: ["review"] });
    expect(await gatherFromRecord({ ...h.request, slugs: ["another"] })).toBe(
      "blocked",
    );
    expect(await gatherFromRecord(h.request)).toBe("blocked");
    await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
    h.response.resolve(result);
    expect(await first).toBe("queued");
    expect(h.record.queue.snapshot().active?.text).toBe(
      composeGatherPrompt(result),
    );
    expect(h.record.queue.snapshot().pending).toHaveLength(0);
  });
  it.each(["empty", "readOnly", "stale"] as const)(
    "does not enqueue for %s receipts",
    async (mode) => {
      const h = setup();
      const pending = gatherFromRecord(h.request);
      await vi.waitFor(() => expect(h.rpc).toHaveBeenCalledOnce());
      if (mode === "readOnly") h.readOnly();
      if (mode === "stale") h.stale();
      h.response.resolve(
        mode === "empty" ? { profile_id: "dev", peers: [] } : result,
      );
      expect(await pending).toBe(mode === "readOnly" ? "blocked" : mode);
      expect(h.record.queue.snapshot().active).toBeNull();
    },
  );
  it("fences a deferred typed factory before any blackboard RPC", async () => {
    const h = setup();
    const gate = deferred<void>();
    h.factory.mockImplementation(
      async (sessionId, profileId, capabilities, owner) => {
        await gate.promise;
        return createPeerCommands(
          { request: h.rpc },
          { sessionId, profileId, authority: owner! },
          capabilities,
        );
      },
    );
    const pending = gatherFromRecord(h.request);
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    h.stale();
    gate.resolve();
    expect(await pending).toBe("stale");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
