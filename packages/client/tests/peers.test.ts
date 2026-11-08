import { describe, expect, it, vi } from "vitest";
import {
  createPeerCommands,
  parsePeerPrepareResult,
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

describe("peer wire authority", () => {
  it("uses the server profile in the native identity", () => {
    expect(peerIdentityForTopic("dev", "peer-review")).toBe(
      "dev:local:tui#peer-review",
    );
    expect(() => peerIdentityForTopic("dev", "review")).toThrow();
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
