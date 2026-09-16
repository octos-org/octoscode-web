import { describe, expect, it, vi } from "vitest";
import {
  createPeerCommands,
  PEER_METHODS,
  type PeerCommands,
} from "@octos-org/octoscode-client/peers";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  PeerManager,
  fleetLanded,
  summarizeRoster,
  peerClearAnnouncement,
  type PeerOpenRequest,
  type PeerOpenOutcome,
  type PeerRosterEntry,
} from "./peer-manager.ts";
import { LazyPeerManager } from "./lazy-peer-manager.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [PEER_METHODS.PREPARE, PEER_METHODS.GATHER],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: [],
};
const peer = {
  slug: "review",
  topic: "peer-review",
  profile_id: "dev",
  cwd: "/repo/wt",
  brief_path: "/peers/review/brief.md",
};
const staged = {
  method: PEER_METHODS.STAGED,
  params: { ...peer, session_id: "dev:local:tui", brief: "Review this" },
};
const closed = {
  method: PEER_METHODS.CLOSED,
  params: { ...peer, session_id: "dev:local:tui" },
};
const identity = "dev:local:tui#peer-review";
const row = {
  slug: "review",
  topic: "peer-review",
  brief: "Review this",
  brief_truncated: false,
  result: "Finished",
  result_truncated: false,
  result_updated_unix: 5,
  has_worktree: false,
  closed: false,
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}
function setup(
  open: (request: PeerOpenRequest) => Promise<PeerOpenOutcome> = async () => ({
    status: "started",
  }),
) {
  const request = vi
    .fn<(method: string, params: unknown) => Promise<unknown>>()
    .mockResolvedValue({ ...peer, peers: [peer] });
  let authority = {};
  const create = () =>
    createPeerCommands(
      { request },
      { sessionId: "dev:local:tui", profileId: "dev", authority },
      caps,
    );
  let commands: PeerCommands | null = create();
  const onOpenPeer = vi.fn(open);
  const onClosePeer = vi.fn();
  let readOnly = false;
  const options = {
    commands: () => commands,
    onOpenPeer,
    onClosePeer,
    readOnly: () => readOnly,
  };
  const manager = new PeerManager(options);
  return {
    manager,
    options,
    request,
    onOpenPeer,
    onClosePeer,
    get commands() {
      if (!commands) throw new Error("commands withdrawn");
      return commands;
    },
    rotate() {
      authority = {};
      commands = create();
      manager.syncAuthority();
    },
    reconnect() {
      commands = create();
      manager.syncAuthority();
    },
    withdraw() {
      commands = null;
      manager.syncAuthority();
    },
    setReadOnly(next: boolean) {
      readOnly = next;
    },
  };
}

describe("peer lifecycle manager", () => {
  it("retains kickoff identity across a null withdrawal and same-owner reconnect replay", async () => {
    const h = setup();
    h.manager.observeNotification(staged, h.commands);
    await flush();
    const old = h.commands;
    const original = h.manager.getSnapshot().peers[0];
    h.withdraw();
    expect(h.manager.canPrepare()).toBe(false);
    expect(h.manager.observeNotification(staged, old)).toBe(false);
    h.reconnect();
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(h.manager.getSnapshot().peers[0]).toEqual(original);
  });
  it("retains close tombstones across same-owner reconnect, but retires them on new authentication", async () => {
    const h = setup();
    h.manager.observeNotification(closed, h.commands);
    h.withdraw();
    h.reconnect();
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    h.rotate();
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
  });
  it("marks interrupted starts unknown and does not reopen them on reconnect replay", async () => {
    const d = deferred<PeerOpenOutcome>();
    const h = setup(() => d.promise);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    const request = h.onOpenPeer.mock.calls[0]![0];
    h.reconnect();
    expect(request.isCurrent()).toBe(false);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "unknown",
      canRetry: false,
      turnId: request.turnId,
    });
    h.manager.observeNotification(staged, h.commands);
    d.resolve({ status: "started" });
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(h.manager.getSnapshot().peers[0]?.status).toBe("unknown");
  });
  it("safe failed opening can retry after reconnect with the original UUID and a fresh lease", async () => {
    const h = setup(async () => ({
      status: "not-started",
      error: "open rejected",
    }));
    h.manager.observeNotification(staged, h.commands);
    await flush();
    const first = h.onOpenPeer.mock.calls[0]![0];
    h.withdraw();
    h.reconnect();
    h.onOpenPeer.mockResolvedValue({ status: "started" });
    expect(await h.manager.retryOpen(identity)).toBe(true);
    const second = h.onOpenPeer.mock.calls[1]![0];
    expect(second.turnId).toBe(first.turnId);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });
  it("local validation errors allow correction without marking staging ambiguous", async () => {
    const h = setup();
    expect(await h.manager.kickoff({ brief: "" })).toBeNull();
    expect(h.manager.getSnapshot().prepareError).not.toBeNull();
    expect(h.manager.getSnapshot().prepareUncertain).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
    expect(await h.manager.kickoff({ brief: "corrected" })).not.toBeNull();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
  });
  it("opens the whole validated fleet with each member's lens and one UUID per member", async () => {
    const h = setup();
    h.request.mockResolvedValue({
      ...peer,
      peers: [
        peer,
        { ...peer, slug: "second", topic: "peer-second", cwd: "/repo/second" },
      ],
    });
    await h.manager.kickoff({ brief: "Shared brief", n: 2 });
    expect(h.onOpenPeer).toHaveBeenCalledTimes(2);
    expect(h.onOpenPeer.mock.calls[0]![0].brief).toContain(
      "fleet member 1 of 2",
    );
    expect(h.onOpenPeer.mock.calls[1]![0]).toMatchObject({
      sessionId: "dev:local:tui#peer-second",
      cwd: "/repo/second",
    });
    expect(h.onOpenPeer.mock.calls[1]![0].brief).toContain(
      "fleet member 2 of 2",
    );
    expect(h.onOpenPeer.mock.calls[1]![0].turnId).not.toBe(
      h.onOpenPeer.mock.calls[0]![0].turnId,
    );
  });
  it("caches snapshots until a state change for useSyncExternalStore", () => {
    const h = setup();
    const listener = vi.fn();
    h.manager.subscribe(listener);
    expect(h.manager.getSnapshot()).toBe(h.manager.getSnapshot());
    h.manager.observeNotification(closed, h.commands);
    expect(listener).toHaveBeenCalledOnce();
    expect(h.manager.getSnapshot()).toBe(h.manager.getSnapshot());
  });
  it("deduplicates staged replay and hands the host full native identity and ONE UUID", async () => {
    const opened = deferred<PeerOpenOutcome>();
    const h = setup(() => opened.promise);
    h.manager.observeNotification(staged, h.commands);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    const request = h.onOpenPeer.mock.calls[0]![0];
    expect(request).toMatchObject({
      sessionId: identity,
      profileId: "dev",
      cwd: "/repo/wt",
      brief: "Review this",
      scope: h.commands.scope,
    });
    expect(request.turnId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(request.prompt).toBe(
      "You are a peer agent. Your brief:\n\nReview this\n\n(The durable copy of this brief is at /peers/review/brief.md — re-read it if your context is compacted.)",
    );
    opened.resolve({ status: "started" });
    await flush();
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(h.manager.getSnapshot().peers[0]?.status).toBe("started");
  });
  it("retains a close-before-stage tombstone, including after acknowledge", async () => {
    const h = setup();
    h.manager.observeNotification(closed, h.commands);
    h.manager.acknowledgeClosed(identity);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    expect(h.onClosePeer).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().peers).toHaveLength(0);
  });
  it("aborts a staged opening on close and cannot resurrect it from a late completion", async () => {
    const opened = deferred<PeerOpenOutcome>();
    const h = setup(() => opened.promise);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    const request = h.onOpenPeer.mock.calls[0]![0];
    h.manager.observeNotification(closed, h.commands);
    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
    opened.resolve({ status: "started" });
    await flush();
    expect(h.manager.getSnapshot().peers[0]?.status).toBe("closed");
    h.manager.acknowledgeClosed(identity);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(h.onClosePeer).toHaveBeenCalledOnce();
  });
  it("rejects old authority, foreign origin, and same-topic foreign-profile events", async () => {
    const h = setup();
    const old = h.commands;
    h.rotate();
    expect(h.manager.observeNotification(staged, old)).toBe(false);
    expect(
      h.manager.observeNotification(
        { ...staged, params: { ...staged.params, session_id: "foreign" } },
        h.commands,
      ),
    ).toBe(false);
    expect(
      h.manager.observeNotification(
        { ...closed, params: { ...closed.params, profile_id: "other" } },
        h.commands,
      ),
    ).toBe(false);
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
  });
  it("retains failed opens for explicit safe retry with the SAME kickoff UUID", async () => {
    const h = setup(async () => ({
      status: "not-started",
      error: "Session open was rejected before kickoff",
    }));
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "failed",
      canRetry: true,
      error: "Session open was rejected before kickoff",
    });
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    const turnId = h.onOpenPeer.mock.calls[0]![0].turnId;
    h.onOpenPeer.mockResolvedValue({ status: "started" });
    expect(await h.manager.retryOpen(identity)).toBe(true);
    expect(h.onOpenPeer.mock.calls[1]![0].turnId).toBe(turnId);
  });
  it("surfaces rejected/ambiguous starts without retrying or issuing another UUID", async () => {
    const h = setup(async () => {
      throw new Error("transport may have sent kickoff");
    });
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "unknown",
      canRetry: false,
    });
    expect(h.manager.getSnapshot().peers[0]?.error).toContain(
      "could not be confirmed",
    );
    expect(await h.manager.retryOpen(identity)).toBe(false);
    h.manager.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
  });
  it.each(["prepare", "gather"])(
    "drops stale %s completion on same-session authority rotation",
    async (method) => {
      const d = deferred<unknown>();
      const h = setup();
      h.request.mockReturnValue(d.promise);
      const pending =
        method === "prepare"
          ? h.manager.kickoff({ brief: "x" })
          : h.manager.gather();
      await flush();
      h.rotate();
      d.resolve(
        method === "prepare"
          ? { ...peer, peers: [peer] }
          : { profile_id: "dev", peers: [row] },
      );
      expect(await pending).toBeNull();
      expect(h.onOpenPeer).not.toHaveBeenCalled();
      expect(h.manager.getSnapshot().peers).toHaveLength(0);
      expect(h.manager.getSnapshot().blackboard).toHaveLength(0);
    },
  );
  it("deduplicates concurrent prepare and does not auto-repeat uncertain staging", async () => {
    const d = deferred<unknown>();
    const h = setup();
    h.request.mockReturnValue(d.promise);
    const first = h.manager.kickoff({ brief: "x" });
    const second = h.manager.kickoff({ brief: "x" });
    expect(first).toBe(second);
    await flush();
    expect(h.request).toHaveBeenCalledOnce();
    d.reject(new Error("disconnected"));
    await first;
    expect(h.manager.getSnapshot().prepareUncertain).toBe(true);
    await expect(h.manager.kickoff({ brief: "x" })).rejects.toThrow(
      "outcome is unknown",
    );
    expect(h.request).toHaveBeenCalledOnce();
  });
  it("does not open a prepare receipt if close landed while prepare was pending", async () => {
    const d = deferred<unknown>();
    const h = setup();
    h.request.mockReturnValue(d.promise);
    const pending = h.manager.kickoff({ brief: "x" });
    await flush();
    h.manager.observeNotification(closed, h.commands);
    d.resolve({ ...peer, peers: [peer] });
    await pending;
    expect(h.onOpenPeer).not.toHaveBeenCalled();
  });
  it("gather remains profile-wide and read-only; unknown rows never acquire session ownership", async () => {
    const h = setup();
    h.setReadOnly(true);
    h.request.mockResolvedValue({ profile_id: "dev", peers: [row] });
    expect(h.manager.canPrepare()).toBe(false);
    expect(h.manager.canPrepare(false)).toBe(false);
    expect(h.manager.canGather()).toBe(true);
    await h.manager.gather();
    expect(h.manager.getSnapshot().blackboard).toHaveLength(1);
    expect(h.manager.getSnapshot().peers).toHaveLength(0);
    expect(h.onOpenPeer).not.toHaveBeenCalled();
  });
  it("latest gather owns busy/results and close wins over an older gather row", async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    const h = setup();
    h.request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = h.manager.gather();
    const second = h.manager.gather();
    a.resolve({ profile_id: "dev", peers: [row] });
    await first;
    expect(h.manager.getSnapshot().gatherBusy).toBe(true);
    h.manager.observeNotification(closed, h.commands);
    b.resolve({ profile_id: "dev", peers: [row] });
    await second;
    expect(h.manager.getSnapshot().blackboard[0]?.closed).toBe(true);
    expect(h.manager.getSnapshot().gatherBusy).toBe(false);
  });
});

describe("lazy peer authority", () => {
  it("snapshots a prepare form before loading and dispatches only its validated original values", async () => {
    const module = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const lazy = new LazyPeerManager(h.options, () => module.promise);
    const input = {
      brief: "Original brief",
      names: ["Reviewer"],
      title: "Original",
    };
    const pending = lazy.kickoff(input);
    input.brief = "Edited brief";
    input.names[0] = "Edited name";
    input.title = "Edited title";
    module.resolve({ PeerManager });
    await pending;
    expect(h.request).toHaveBeenCalledWith(
      PEER_METHODS.PREPARE,
      expect.objectContaining({
        brief: "Original brief",
        names: ["Reviewer"],
        title: "Original",
      }),
    );
    lazy.clear();
  });
  it("rejects invalid deferred prepare input visibly without any RPC", async () => {
    const module = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const lazy = new LazyPeerManager(h.options, () => module.promise);
    const pending = lazy.kickoff({
      brief: "",
      names: ["Repeated", "Repeated"],
      n: 2,
    });
    module.resolve({ PeerManager });
    expect(await pending).toBeNull();
    expect(h.request).not.toHaveBeenCalled();
    expect(lazy.getSnapshot().prepareError).toContain("Check the peer brief");
    lazy.clear();
  });
  it("retains constructed manager kickoff IDs across reconnect replay", async () => {
    const h = setup();
    const lazy = new LazyPeerManager(h.options, async () => ({ PeerManager }));
    lazy.observeNotification(staged, h.commands);
    await flush();
    const id = lazy.getSnapshot().peers[0]?.turnId;
    h.withdraw();
    lazy.syncAuthority();
    h.reconnect();
    lazy.syncAuthority();
    lazy.observeNotification(staged, h.commands);
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(lazy.getSnapshot().peers[0]?.turnId).toBe(id);
  });
  it("retains a buffered close through null withdrawal and same-owner lazy reload", async () => {
    const a = deferred<{ PeerManager: typeof PeerManager }>();
    const b = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const loader = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const lazy = new LazyPeerManager(h.options, loader);
    lazy.observeNotification(closed, h.commands);
    h.withdraw();
    lazy.syncAuthority();
    h.reconnect();
    lazy.syncAuthority();
    lazy.observeNotification(staged, h.commands);
    a.resolve({ PeerManager });
    b.resolve({ PeerManager });
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    expect(lazy.getSnapshot().peers).toHaveLength(0);
  });
  it("does not instantiate or drain buffered stage after clear while import is pending", async () => {
    const d = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const lazy = new LazyPeerManager(h.options, () => d.promise);
    lazy.observeNotification(staged, h.commands);
    const action = lazy.kickoff({ brief: "must not dispatch" });
    lazy.clear();
    d.resolve({ PeerManager });
    await action;
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    expect(lazy.getSnapshot().peers).toHaveLength(0);
  });
  it("settles a bare null when the load/authority contract no longer holds (P2g 3030)", async () => {
    // Clause (c): the `#load()`/`#current` mismatch returns bare null. That null
    // is NOT success and NOT an error — it is the NOT-CONFIRMED class the
    // console's sink (`performStagedDispatch`) maps to a typed `unknown` it
    // RENDERS. The run-12 triage found this exact settle `void`-swallowed.
    const d = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const lazy = new LazyPeerManager(h.options, () => d.promise);
    const pending = lazy.kickoff({ brief: "staged on a retired authority" });
    // Retire the authority BEFORE the module resolves: `#current` now fails.
    h.rotate();
    lazy.syncAuthority();
    d.resolve({ PeerManager });
    await expect(pending).resolves.toBeNull();
    expect(h.request).not.toHaveBeenCalled();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
  });
  it("preserves closed-before-staged ordering during lazy replay", async () => {
    const d = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const lazy = new LazyPeerManager(h.options, () => d.promise);
    lazy.observeNotification(closed, h.commands);
    lazy.observeNotification(staged, h.commands);
    d.resolve({ PeerManager });
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    expect(lazy.getSnapshot()).toBe(lazy.getSnapshot());
  });
  it("drops an old lazy load on authority rotation and permits a fresh one", async () => {
    const a = deferred<{ PeerManager: typeof PeerManager }>();
    const b = deferred<{ PeerManager: typeof PeerManager }>();
    const h = setup();
    const loader = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const lazy = new LazyPeerManager(h.options, loader);
    const old = h.commands;
    lazy.observeNotification(staged, old);
    h.rotate();
    lazy.syncAuthority();
    lazy.observeNotification(staged, h.commands);
    a.resolve({ PeerManager });
    await flush();
    expect(h.onOpenPeer).not.toHaveBeenCalled();
    b.resolve({ PeerManager });
    await flush();
    expect(h.onOpenPeer).toHaveBeenCalledOnce();
    expect(lazy.observeNotification(closed, old)).toBe(false);
  });
});

const secondStaged = {
  method: PEER_METHODS.STAGED,
  params: {
    ...peer,
    slug: "second",
    topic: "peer-second",
    cwd: "/repo/second",
    session_id: "dev:local:tui",
    brief: "Review that",
  },
};
const secondIdentity = "dev:local:tui#peer-second";

/** Stage one peer and let its background open settle to `started`. */
async function stagePeer(
  h: ReturnType<typeof setup>,
  event: { method: string; params: unknown } = staged,
) {
  h.manager.observeNotification(event, h.commands);
  await flush();
}

describe("peer activity axis (audit row 5)", () => {
  it("reports idle with no finished stamp before any peer Session event", async () => {
    const h = setup();
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      activity: "idle",
      finishedAt: null,
    });
  });
  it("turn-started reads live without disturbing the lifecycle status", async () => {
    const h = setup();
    await stagePeer(h);
    const status = h.manager.getSnapshot().peers[0]?.status;
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "turn-started" },
        h.commands,
      ),
    ).toBe(true);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      activity: "live",
      status,
    });
  });
  it("attention requested blocks and resolving it returns the peer to idle", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-requested" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("blocked");
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-resolved" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("idle");
  });
  it("a turn terminal freezes the peer as done with a finished stamp", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    const before = Date.now();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const entry = h.manager.getSnapshot().peers[0];
    expect(entry?.activity).toBe("done");
    expect(typeof entry?.finishedAt).toBe("number");
    expect(entry!.finishedAt!).toBeGreaterThanOrEqual(before);
  });
  it("blocked outranks live, and a terminal clears the blocked wait", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-requested" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("blocked");
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-resolved" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("live");
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("done");
  });
  it("a peer that runs again reads live and refreshes its finished stamp", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const first = h.manager.getSnapshot().peers[0]!.finishedAt!;
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("live");
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    expect(
      h.manager.getSnapshot().peers[0]!.finishedAt!,
    ).toBeGreaterThanOrEqual(first);
  });
  it("stamps only the peer Session the terminal belongs to", async () => {
    const h = setup();
    await stagePeer(h);
    await stagePeer(h, secondStaged);
    expect(h.manager.getSnapshot().peers).toHaveLength(2);
    h.manager.observeSessionEvent(
      { sessionId: secondIdentity, kind: "turn-started" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const byIdentity = new Map(
      h.manager.getSnapshot().peers.map((entry) => [entry.identity, entry]),
    );
    expect(byIdentity.get(identity)).toMatchObject({ activity: "done" });
    expect(byIdentity.get(secondIdentity)).toMatchObject({ activity: "live" });
  });
  it("fences events from a stale transport incarnation and unknown Sessions", async () => {
    const h = setup();
    await stagePeer(h);
    const old = h.commands;
    h.reconnect();
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "turn-started" },
        old,
      ),
    ).toBe(false);
    expect(
      h.manager.observeSessionEvent(
        { sessionId: "dev:local:tui#peer-absent", kind: "turn-started" },
        h.commands,
      ),
    ).toBe(false);
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "turn-started" },
        h.commands,
      ),
    ).toBe(true);
  });
  it("rejects activity for a closed peer and drops its stale state on re-stage", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    h.manager.observeNotification(closed, h.commands);
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "turn-started" },
        h.commands,
      ),
    ).toBe(false);
    // New authentication retires the closed tombstone, so the same topic may
    // stage again — and the new row must start clean on the activity axis.
    h.rotate();
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      activity: "idle",
      finishedAt: null,
    });
  });
});

function rosterEntry(over: Partial<PeerRosterEntry> = {}): PeerRosterEntry {
  return {
    identity,
    profileId: "dev",
    topic: "peer-review",
    slug: "review",
    cwd: "/repo/wt",
    briefPath: "/peers/review/brief.md",
    origin: "staged",
    turnId: "turn-1",
    status: "started",
    activity: "idle",
    finishedAt: null,
    openedAt: null,
    outputTokens: 0,
    error: null,
    canRetry: false,
    ...over,
  };
}

describe("peer roster counts (audit rows 2-4)", () => {
  it("leaves openedAt null while opening, then stamps it when the peer starts", async () => {
    const open = deferred<PeerOpenOutcome>();
    const h = setup(() => open.promise);
    const before = Date.now();
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "opening",
      openedAt: null,
    });
    open.resolve({ status: "started" });
    await flush();
    const entry = h.manager.getSnapshot().peers[0];
    expect(entry?.status).toBe("started");
    expect(typeof entry?.openedAt).toBe("number");
    expect(entry!.openedAt!).toBeGreaterThanOrEqual(before);
  });
  it("leaves openedAt null when the open never starts", async () => {
    const h = setup(async () => ({ status: "not-started", error: "nope" }));
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "failed",
      openedAt: null,
    });
  });
  it("stamps openedAt on a retry that finally opens", async () => {
    let attempt = 0;
    const h = setup(async () =>
      (attempt += 1) === 1
        ? { status: "not-started", error: "nope" }
        : { status: "started" },
    );
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]?.openedAt).toBeNull();
    await h.manager.retryOpen(identity);
    const entry = h.manager.getSnapshot().peers[0];
    expect(entry?.status).toBe("started");
    expect(typeof entry?.openedAt).toBe("number");
  });
  it("preserves the open stamp once the row closes", async () => {
    const h = setup();
    await stagePeer(h);
    const openedAt = h.manager.getSnapshot().peers[0]?.openedAt;
    expect(typeof openedAt).toBe("number");
    h.manager.observeNotification(closed, h.commands);
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      status: "closed",
      openedAt,
    });
  });
  it("summarizes an empty roster as all zero", () => {
    expect(summarizeRoster([])).toEqual({
      total: 0,
      live: 0,
      blocked: 0,
      done: 0,
      idle: 0,
    });
  });
  it("buckets every row by its activity axis", () => {
    expect(
      summarizeRoster([
        rosterEntry({ activity: "idle" }),
        rosterEntry({ identity: "a", activity: "live" }),
        rosterEntry({ identity: "b", activity: "blocked" }),
        rosterEntry({ identity: "c", activity: "done", finishedAt: 1 }),
      ]),
    ).toEqual({ total: 4, live: 1, blocked: 1, done: 1, idle: 1 });
  });
  it("counts fleet landings from done rows only", () => {
    expect(fleetLanded([])).toEqual({ landed: 0, total: 0 });
    expect(
      fleetLanded([
        rosterEntry({ activity: "done", finishedAt: 1 }),
        rosterEntry({ identity: "a", activity: "live" }),
        rosterEntry({ identity: "b", activity: "blocked" }),
      ]),
    ).toEqual({ landed: 1, total: 3 });
  });
  it("agrees with the live manager roster after a real turn completes", async () => {
    const h = setup();
    await stagePeer(h);
    await stagePeer(h, secondStaged);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const peers = h.manager.getSnapshot().peers;
    expect(summarizeRoster(peers)).toEqual({
      total: 2,
      idle: 1,
      live: 0,
      blocked: 0,
      done: 1,
    });
    expect(fleetLanded(peers)).toEqual({ landed: 1, total: 2 });
  });
});

describe("peer output token accumulation (audit row 4)", () => {
  it("accumulates the peer Session's usage output tokens without touching the activity axis", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "usage", outputTokens: 120 },
        h.commands,
      ),
    ).toBe(true);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "usage", outputTokens: 80 },
      h.commands,
    );
    // A later terminal still stamps `done`; the token total is untouched by it.
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.outputTokens).toBe(200);
    expect(entry.activity).toBe("done");
  });
  it("ignores usage events with no or non-positive token count", async () => {
    const h = setup();
    await stagePeer(h);
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "usage" },
        h.commands,
      ),
    ).toBe(true);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "usage", outputTokens: -5 },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]!.outputTokens).toBe(0);
    expect(h.manager.getSnapshot().peers[0]!.activity).toBe("idle");
  });
  it("rejects usage from a Session that is not a live peer row", async () => {
    const h = setup();
    await stagePeer(h);
    expect(
      h.manager.observeSessionEvent(
        {
          sessionId: "dev:local:tui#peer-absent",
          kind: "usage",
          outputTokens: 9,
        },
        h.commands,
      ),
    ).toBe(false);
    expect(h.manager.getSnapshot().peers[0]!.outputTokens).toBe(0);
  });
});

describe("peer attention request id (operator console §6)", () => {
  it("attention-requested stamps the pending request id and kind", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestId: "req-7",
        requestKind: "approval",
      },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]).toMatchObject({
      activity: "blocked",
      requestId: "req-7",
      requestKind: "approval",
    });
  });
  it("attention-resolved clears the pending request id and kind", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestId: "req-7",
        requestKind: "question",
      },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-resolved" },
      h.commands,
    );
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.requestId).toBeNull();
    expect(entry.requestKind).toBeNull();
    expect(entry.activity).toBe("idle");
  });
  it("a turn terminal clears the pending request id and kind", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestId: "req-9",
        requestKind: "approval",
      },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.requestId).toBeNull();
    expect(entry.requestKind).toBeNull();
    expect(entry.activity).toBe("done");
  });
  it("attention-requested with no id stamps nulls rather than undefined", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-requested" },
      h.commands,
    );
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.requestId).toBeNull();
    expect(entry.requestKind).toBeNull();
  });
});

describe("peer accepted dispatch operation id (approval wiring GAP)", () => {
  it("stamps the accepted dispatch operationId when the peer starts", async () => {
    const h = setup(async () => ({
      status: "started",
      operationId: "op-accepted-1",
    }));
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]!.operationId).toBe("op-accepted-1");
  });
  it("stamps null when the started receipt carries no operation id", async () => {
    const h = setup();
    await stagePeer(h);
    expect(h.manager.getSnapshot().peers[0]!.operationId).toBeNull();
  });
  it("preserves the accepted operationId across a reconnect", async () => {
    const h = setup(async () => ({
      status: "started",
      operationId: "op-accepted-2",
    }));
    await stagePeer(h);
    h.reconnect();
    expect(h.manager.getSnapshot().peers[0]!.operationId).toBe("op-accepted-2");
  });
  it("clears the accepted operationId when the peer closes", async () => {
    const h = setup(async () => ({
      status: "started",
      operationId: "op-accepted-3",
    }));
    await stagePeer(h);
    h.manager.observeNotification(closed, h.commands);
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.status).toBe("closed");
    expect(entry.operationId).toBeNull();
  });
});

describe("close clears the pending attention request (data review 1015, defect 1)", () => {
  it("a row closed while blocked drops its pending requestId/requestKind", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestId: "req-close-1",
        requestKind: "approval",
      },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]!.requestId).toBe("req-close-1");
    h.manager.observeNotification(closed, h.commands);
    const entry = h.manager.getSnapshot().peers[0]!;
    expect(entry.status).toBe("closed");
    expect(entry.requestId).toBeNull();
    expect(entry.requestKind).toBeNull();
  });
});

describe("peer clear prune (reference-TUI parity 2500 §2)", () => {
  it("prunes finished rows and keeps live/blocked/idle ones", async () => {
    const h = setup();
    await stagePeer(h);
    await stagePeer(h, secondStaged);
    // Row 1 terminal -> done; row 2 stays idle (no terminal yet).
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers).toHaveLength(2);
    expect(h.manager.clearFinished()).toBe(1);
    const remaining = h.manager.getSnapshot().peers;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.identity).toBe(secondIdentity);
  });
  it("reports 0 and changes nothing when no peer is finished", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    expect(h.manager.clearFinished()).toBe(0);
    expect(h.manager.getSnapshot().peers).toHaveLength(1);
  });
  it("never prunes a blocked (waiting) row even after an earlier terminal", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestId: "a1",
        requestKind: "approval",
      },
      h.commands,
    );
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("blocked");
    expect(h.manager.clearFinished()).toBe(0);
    expect(h.manager.getSnapshot().peers[0]?.activity).toBe("blocked");
  });
  it("a re-running peer is not finished despite an earlier terminal", async () => {
    const h = setup();
    await stagePeer(h);
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started" },
      h.commands,
    );
    expect(h.manager.clearFinished()).toBe(0);
    expect(h.manager.getSnapshot().peers).toHaveLength(1);
  });
});

describe("peer clear announcement copy (parity 2500 §2)", () => {
  it("names the pruned count and degrades to the TUI's none line", () => {
    expect(peerClearAnnouncement(1)).toBe("1 finished peer cleared");
    expect(peerClearAnnouncement(3)).toBe("3 finished peers cleared");
    expect(peerClearAnnouncement(0)).toBe("no finished peers");
  });
});
