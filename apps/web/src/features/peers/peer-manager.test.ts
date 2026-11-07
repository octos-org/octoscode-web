import { describe, expect, it, vi } from "vitest";
import {
  createPeerCommands,
  PEER_METHODS,
  type PeerCommands,
} from "@octos-org/octoscode-client/peers";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  PeerManager,
  type PeerOpenRequest,
  type PeerOpenOutcome,
} from "./peer-manager.ts";

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
const identity = "dev:local:tui#peer-review";
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
});
