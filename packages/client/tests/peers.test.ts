import { describe, expect, it, vi } from "vitest";
import {
  createPeerCommands,
  parsePeerPrepareResult,
  parsePeerGatherResult,
  parsePeerNotification,
  peerIdentityForTopic,
  PEER_METHODS,
  type PeerScope,
} from "../src/peers.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const scope: PeerScope = {
  sessionId: "dev:local:tui",
  profileId: "dev",
  authority: {},
};
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
  worktree_branch: null,
};
const row = {
  slug: "review",
  topic: "peer-review",
  name: "Review",
  brief: "Review this",
  brief_truncated: false,
  result: null,
  result_truncated: false,
  result_updated_unix: null,
  has_worktree: false,
  closed: false,
  turn_history: null,
};

describe("peer wire authority", () => {
  it("uses the server profile in the native identity", () => {
    expect(peerIdentityForTopic("dev", "peer-review")).toBe(
      "dev:local:tui#peer-review",
    );
    expect(() => peerIdentityForTopic("dev", "review")).toThrow();
  });
  it("sends captured routing, n, and explicit parameters only", async () => {
    const request = vi.fn().mockResolvedValue({ ...peer, peers: [peer] });
    const commands = createPeerCommands({ request }, scope, caps);
    const extra = {
      session_id: "foreign",
      profile_id: "foreign",
      secret: "not-a-wire-field",
      count: 8,
    };
    await commands.prepare({
      brief: " Review this ",
      n: 1,
      worktree: false,
      ...extra,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("peer/prepare", {
      session_id: scope.sessionId,
      profile_id: "dev",
      brief: "Review this",
      n: 1,
      worktree: false,
    });
  });
  it("fails closed before the wire for absent or explicitly unsupported methods", async () => {
    const request = vi.fn();
    await expect(
      createPeerCommands({ request }, scope, undefined).prepare({ brief: "x" }),
    ).rejects.toThrow("not advertised");
    await expect(
      createPeerCommands({ request }, scope, {
        ...caps,
        supported_methods: [],
      }).gather(),
    ).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    { brief: "" },
    { brief: "x", n: 0 },
    { brief: "x", n: 9 },
    { brief: "x", n: 2, names: ["only-one"] },
    { brief: "x", n: 2, names: ["Name", "name"] },
    { brief: "界".repeat(23000) },
  ])("rejects invalid prepare input without staging: %j", async (params) => {
    const request = vi.fn();
    await expect(
      createPeerCommands({ request }, scope, caps).prepare(params),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts scalar legacy and nullable rc11 branches", () => {
    expect(parsePeerPrepareResult(peer, "dev")?.peers).toEqual([]);
    expect(
      parsePeerPrepareResult({ ...peer, peers: [peer] }, "dev")
        ?.worktree_branch,
    ).toBeUndefined();
  });
  it("rejects the entire fleet for malformed/wrong-profile/duplicate children or inconsistent head", () => {
    for (const peers of [
      [peer, {}],
      [peer, { ...peer, profile_id: "foreign" }],
      [peer, peer],
      [{ ...peer, cwd: "/different" }],
    ]) {
      expect(parsePeerPrepareResult({ ...peer, peers }, "dev")).toBeNull();
    }
    expect(
      parsePeerPrepareResult({ ...peer, topic: "peer-other" }, "dev"),
    ).toBeNull();
    expect(
      parsePeerPrepareResult({ ...peer, brief_path: "" }, "dev"),
    ).toBeNull();
  });
  it("rejects a prepare receipt that does not contain the requested fleet size", async () => {
    const request = vi.fn().mockResolvedValue({ ...peer, peers: [peer] });
    await expect(
      createPeerCommands({ request }, scope, caps).prepare({
        brief: "x",
        n: 2,
      }),
    ).rejects.toThrow("prepare result");
  });
  it("validates nullable gather fields and exact profile/filter without manufacturing owner scope", async () => {
    expect(
      parsePeerGatherResult({ profile_id: "dev", peers: [row] }, "dev")
        ?.peers[0]?.result,
    ).toBeNull();
    expect(
      parsePeerGatherResult({ profile_id: "foreign", peers: [row] }, "dev"),
    ).toBeNull();
    expect(
      parsePeerGatherResult(
        { profile_id: "dev", peers: [{ ...row, closed: "false" }] },
        "dev",
      ),
    ).toBeNull();
    const request = vi
      .fn()
      .mockResolvedValue({ profile_id: "dev", peers: [row] });
    await expect(
      createPeerCommands({ request }, scope, caps).gather({
        slugs: ["different"],
      }),
    ).rejects.toThrow("gather result");
    expect(request).toHaveBeenCalledWith("peer/gather", {
      session_id: scope.sessionId,
      profile_id: "dev",
      slugs: ["different"],
    });
  });
  it("requires originating session AND profile on durable notifications", () => {
    const notification = {
      method: PEER_METHODS.STAGED,
      params: { ...peer, session_id: scope.sessionId, brief: "x" },
    };
    expect(parsePeerNotification(notification, scope)?.kind).toBe("staged");
    expect(
      parsePeerNotification(
        {
          ...notification,
          params: { ...notification.params, session_id: "foreign" },
        },
        scope,
      ),
    ).toBeNull();
    expect(
      parsePeerNotification(
        {
          ...notification,
          params: { ...notification.params, profile_id: "foreign" },
        },
        scope,
      ),
    ).toBeNull();
    expect(
      parsePeerNotification(
        { ...notification, params: { ...notification.params, brief: "" } },
        scope,
      ),
    ).toBeNull();
  });
});
