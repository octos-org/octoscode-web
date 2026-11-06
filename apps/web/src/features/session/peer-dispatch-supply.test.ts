import { describe, expect, it, vi } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  createPeerCommands,
  PEER_METHODS,
} from "@octos-org/octoscode-client/peers";
import { PeerManager } from "../peers/peer-manager.ts";
import { LazyPeerManager } from "../peers/lazy-peer-manager.ts";
import { performStagedDispatch } from "./use-octos-session.ts";

/**
 * P2N (grant 3320): the console's staged dispatch through the REAL stack the
 * hook builds — `performStagedDispatch` -> `LazyPeerManager` -> `PeerManager`
 * -> the client's prepare encoder. Run 2850g against the real Core held the
 * seat, clicked an enabled Dispatch, and sent ZERO `peer/dispatch` frames:
 * the console admits a blank Title, and the sink read the encoder's local
 * rejection as a load/authority mismatch. The fail-closed branches of each
 * layer, and the one-frame user chain, run in e2e/peer-controller.spec.ts;
 * these two cases keep the seams between the layers: the encoder's blank-Title
 * rule, and a same-authority refresh between holding the seat and the kickoff.
 */
describe("P2N — a staged dispatch reaches the wire through the real peer stack", () => {
  const PEER_CAPS: UiProtocolCapabilities = {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: [PEER_METHODS.PREPARE, PEER_METHODS.GATHER],
    supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
    supported_features: [],
  };
  const PEER = {
    slug: "review",
    topic: "peer-review",
    profile_id: "dev",
    cwd: "/repo/wt",
    brief_path: "/peers/review/brief.md",
  };

  /** The REAL stack the hook builds: LazyPeerManager -> PeerManager -> encoder. */
  function stack() {
    // Typed invocation so the assertion below can read the encoded PARAMS.
    const request = vi.fn(async (_method: string, _params: unknown) => ({
      ...PEER,
      peers: [PEER],
    }));
    const commands = createPeerCommands(
      { request },
      { sessionId: "dev:local:tui", profileId: "dev", authority: {} },
      PEER_CAPS,
    );
    const onOpenPeer = vi.fn(async () => ({ status: "started" as const }));
    const lazy = new LazyPeerManager(
      {
        commands: () => commands,
        onOpenPeer,
        onClosePeer: () => undefined,
        readOnly: () => false,
      },
      async () => ({ PeerManager }),
    );
    return { lazy, request, onOpenPeer };
  }

  it("stages a blank-Title dispatch (the LIVE harness never fills Title)", async () => {
    // The live P4 harness fills Brief and clicks Dispatch — it never types a
    // Title. The console's gate requires only a non-empty brief, so this is an
    // ENABLED button whose click must reach the wire.
    const { lazy, request, onOpenPeer } = stack();
    const outcome = await performStagedDispatch({
      manager: lazy,
      laneKey: "kimi-k3",
      brief: "Reply with the single word READY and stop",
      title: "",
      selectLane: () => undefined,
    });
    expect(outcome).toEqual({ kind: "dispatched" });
    // The frame the live run never sent: exactly ONE peer/prepare.
    expect(request).toHaveBeenCalledWith(
      PEER_METHODS.PREPARE,
      expect.objectContaining({
        brief: "Reply with the single word READY and stop",
      }),
    );
    // A blank title is OMITTED, never sent as "" (the encoder's own rule).
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("title");
    expect(onOpenPeer).toHaveBeenCalledTimes(1);
  });

  it("a REFRESH between hold and kickoff still dispatches (the suspected vector)", async () => {
    // The brief's hypothesis: the post-acquire inventory refresh REPLACES the
    // record/authority identity, so the lazy manager's `#load`/`#current`
    // answers the bare null and the sink reports `kickoff-mismatch`. Driven
    // against the REAL `LazyPeerManager`: a RE-RESOLVED commands instance for
    // the SAME scope authority (`samePeerScope`) bumps the epoch but is NOT a
    // scope change, so staging still reaches the wire. ONLY a genuinely FOREIGN
    // authority (a NEW authority object) answers null.
    const authority = { scopeOwner: "active-record" };
    const frames: string[] = [];
    const makeCommands = () =>
      createPeerCommands(
        {
          request: async (method: string, _params: unknown) => {
            frames.push(method);
            return { ...PEER, peers: [PEER] };
          },
        },
        { sessionId: "dev:local:tui", profileId: "dev", authority },
        PEER_CAPS,
      );
    let commands = makeCommands();
    const lazy = new LazyPeerManager(
      {
        commands: () => commands,
        onOpenPeer: async () => ({ status: "started" as const }),
        onClosePeer: () => undefined,
        readOnly: () => false,
      },
      async () => ({ PeerManager }),
    );
    // A first dispatch loads the inner manager (the live "acquire -> dispatch").
    await expect(
      performStagedDispatch({
        manager: lazy,
        laneKey: "kimi-k3",
        brief: "one",
        title: "t",
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "dispatched" });
    // The REFRESH: a NEW commands instance for the SAME scope authority.
    commands = makeCommands();
    lazy.syncAuthority();
    await expect(
      performStagedDispatch({
        manager: lazy,
        laneKey: "kimi-k3",
        brief: "two",
        title: "t",
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "dispatched" });
    expect(frames.filter((m) => m === PEER_METHODS.PREPARE)).toHaveLength(2);
  });
});
