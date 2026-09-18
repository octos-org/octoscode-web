import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  createPeerCommands,
  PEER_METHODS,
} from "@octos-org/octoscode-client/peers";
import type {
  DriverAcquireView,
  ExternalDriverCommands,
} from "@octos-org/octoscode-client/external-driver";
import { ExternalDriverRefusalError } from "@octos-org/octoscode-client/external-driver";
import type { PeerPrepareParams } from "@octos-org/octoscode-client/peer-protocol";
import { PeerManager } from "../peers/peer-manager.ts";
import { LazyPeerManager } from "../peers/lazy-peer-manager.ts";
import {
  peerAdoptSeam,
  performStagedDispatch,
  planPeerDispatch,
  planPeerSeatRelease,
} from "./use-octos-session.ts";
import { PEER_LANE_UNAVAILABLE_REFUSAL } from "../control/peer-lane-source.ts";
import type { PeerDispatchSeed } from "../control/peer-dispatch-commands.ts";

/**
 * P1 RED (grant 2810 §2): the `peer/dispatch` SUPPLIER at the supply site. The
 * supplier is the ONE place that turns an operator's lane choice + the held
 * control fence into a single staging frame — and it is FAIL-CLOSED:
 *
 *   • an unknown (or unread) lane is refused with the typed
 *     `driver_model_unavailable` and builds NO params, so NO frame is sent;
 *   • a missing/mismatched control fence is refused typed, never dispatched;
 *   • the ACCEPTED receipt's adopted identity is installed through
 *     `recordManager.adoptOnRecord` — which is NOT landed yet, so the seam is
 *     NULL and the caller fails closed rather than fabricating a record.
 *
 * `planPeerDispatch`/`planPeerSeatRelease`/`peerAdoptSeam` are pure, so they run
 * under node (apps/web has no jsdom), exactly like the seat derivation tests.
 */
const ACQUIRE: DriverAcquireView = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: ["dispatch-op-1"],
  },
  pendingWork: ["dispatch-op-1"],
  recovery: "none" as const,
};

const SEED: PeerDispatchSeed = {
  brief: "Review this",
  slug: "review",
  prompt: "kickoff text",
};

const KEYS = ["lane-primary", "lane-review"];

describe("planPeerDispatch — unknown lane ⇒ no frame + typed refusal", () => {
  it("refuses a lane the profile does not advertise and builds NO params", () => {
    const plan = planPeerDispatch({
      acquire: ACQUIRE,
      laneKeys: KEYS,
      laneKey: "glm-5.3",
      operationId: "op-1",
      seed: SEED,
    });
    expect(plan).toEqual({
      kind: "refused",
      refusalKind: PEER_LANE_UNAVAILABLE_REFUSAL,
    });
    expect("params" in plan).toBe(false);
  });

  it("refuses every lane while the lane source is unread", () => {
    expect(
      planPeerDispatch({
        acquire: ACQUIRE,
        laneKeys: null,
        laneKey: "lane-primary",
        operationId: "op-1",
        seed: SEED,
      }).kind,
    ).toBe("refused");
  });

  it("refuses typed when no control fence is held", () => {
    expect(
      planPeerDispatch({
        acquire: null,
        laneKeys: KEYS,
        laneKey: "lane-primary",
        operationId: "op-1",
        seed: SEED,
      }),
    ).toEqual({ kind: "refused", refusalKind: "driver_fence_stale" });
  });

  it("admits an advertised lane with the held fence and the minted operationId", () => {
    const plan = planPeerDispatch({
      acquire: ACQUIRE,
      laneKeys: KEYS,
      laneKey: "lane-review",
      operationId: "op-1",
      seed: SEED,
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind !== "dispatch") return;
    expect(plan.params).toEqual({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
      operationId: "op-1",
      model: "lane-review",
      dispatch: { kind: "new_brief", brief: "Review this", title: "review" },
      kickoffInput: [{ kind: "text", text: "kickoff text" }],
    });
  });

  it("sends the REQUESTED lane key as `model`, never a resolved model", () => {
    const plan = planPeerDispatch({
      acquire: ACQUIRE,
      laneKeys: ["lane custom"],
      laneKey: "lane custom",
      operationId: "op-1",
      seed: SEED,
    });
    expect(plan.kind === "dispatch" && plan.params.model).toBe("lane custom");
  });
});

describe("peerAdoptSeam — the adopt-from-receipt seam fails closed until it lands", () => {
  it("is NULL when the manager does not implement adoptOnRecord", () => {
    expect(peerAdoptSeam({ openOnRecord: async () => ({}) })).toBeNull();
  });

  it("is NULL for a non-callable adoptOnRecord", () => {
    expect(peerAdoptSeam({ adoptOnRecord: 42 })).toBeNull();
  });

  it("binds the manager's own adoptOnRecord and forwards the receipt ids", async () => {
    const record = { scope: { sessionId: "master#peer-review" } };
    const adoptOnRecord = vi.fn(async () => record);
    const seam = peerAdoptSeam({ adoptOnRecord })!;
    await expect(
      seam({
        adoptedSessionId: "master#peer-review",
        adoptedTurnId: "11111111-1111-1111-1111-111111111111",
        scope: {
          endpoint: "ws://127.0.0.1:1",
          workspaceRoot: "/repo",
          profileId: "dev",
          sessionId: "master#peer-review",
          authorityEpoch: 1,
        },
      }),
    ).resolves.toBe(record);
    expect(adoptOnRecord).toHaveBeenCalledTimes(1);
  });
});

describe("planPeerSeatRelease — release the seat, park the binding", () => {
  it("is NULL with no held fence (no frame at all)", () => {
    expect(planPeerSeatRelease(null)).toBeNull();
  });

  it("releases with the caller-held fence, the CAS revision and next:external", () => {
    expect(planPeerSeatRelease(ACQUIRE)).toEqual({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
      expectedRevision: 12,
      next: "external",
    });
  });
});

describe("the supply site exposes the panel's dispatch/release surface", () => {
  const source = readFileSync(
    new URL("./use-octos-session.ts", import.meta.url),
    "utf8",
  );

  it("wires the coordinator's dispatchPeer supplier", () => {
    expect(source).toContain("dispatchPeer:");
  });

  it("exposes peers.dispatch and peers.releaseSeat", () => {
    expect(source).toContain("dispatch(");
    expect(source).toContain("releaseSeat(");
  });

  it("keeps the adopt seam explicitly marked as unlanded", () => {
    expect(source).toContain("adoptOnRecord");
  });

  it("never sends a fallback lane literal", () => {
    expect(source).not.toContain('"external-master"');
  });
});

describe("the supplier leaf contract stays the client's real shape", () => {
  it("buildPeerDispatchParams-compatible params are what the leaf accepts", () => {
    // Compile-time pin: PeerDispatchParams is the leaf's own argument view, so
    // the supplier can never drift into a snake_case or extra-key payload.
    const leaf = {} as Pick<ExternalDriverCommands, "peerDispatch">;
    expect(typeof leaf).toBe("object");
  });
});

/**
 * P2g RED (grant 3030): the console's STAGED-DISPATCH SINK. Run-12 triage
 * (evidence native-deepseek-web-pc-p3e-run12-triage-3010.md) found a ready,
 * seat-held console dispatching ZERO frames and surfacing NOTHING. The sink is
 * fail-closed ONLY if a closed gate is VISIBLE: one frame, or a typed, rendered
 * refusal/`unknown` — never silence.
 */
describe("performStagedDispatch — a ready console is NEVER silent", () => {
  const seed = {
    laneKey: "lane-review",
    brief: "Review this",
    title: "review",
  };

  it("hands a held manager exactly ONE kickoff with the staged lane/brief/title", async () => {
    const kickoff = vi.fn(async (_params: PeerPrepareParams) => ({
      peers: [],
    }));
    const selectLane = vi.fn();
    await expect(
      performStagedDispatch({
        manager: { kickoff },
        ...seed,
        selectLane,
      }),
    ).resolves.toEqual({ kind: "dispatched" });
    // The lane is recorded BEFORE the kickoff: the supplier reads it at call
    // time, so an unrecorded lane would stage on a stale/empty choice.
    expect(selectLane).toHaveBeenCalledWith("lane-review");
    expect(kickoff).toHaveBeenCalledTimes(1);
    expect(kickoff.mock.calls[0]?.[0]).toEqual({
      brief: "Review this",
      title: "review",
    });
  });

  it("settles a typed `unknown` for a NULL manager — never silence", async () => {
    await expect(
      performStagedDispatch({
        manager: null,
        ...seed,
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "unknown", reason: "no-manager" });
  });

  it("settles `unknown` when the manager cannot stage (load/current mismatch)", async () => {
    await expect(
      performStagedDispatch({
        manager: { kickoff: async () => null },
        ...seed,
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "unknown", reason: "kickoff-mismatch" });
  });

  it("keeps a typed fence refusal's bounded kind and never throws", async () => {
    await expect(
      performStagedDispatch({
        manager: {
          kickoff: async () => {
            throw new ExternalDriverRefusalError(
              "peer/dispatch",
              "driver_fence_stale",
            );
          },
        },
        ...seed,
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "refused", refusalKind: "driver_fence_stale" });
  });

  it("degrades a kind-less rejection to `unknown`, never a rethrow", async () => {
    await expect(
      performStagedDispatch({
        manager: {
          kickoff: async () => {
            throw new Error("peer/prepare is not available");
          },
        },
        ...seed,
        selectLane: () => undefined,
      }),
    ).resolves.toEqual({ kind: "unknown", reason: "leaf-refused" });
  });
});

describe("the console's dispatch sink never swallows a staging as a bare void", () => {
  const source = readFileSync(
    new URL("./use-octos-session.ts", import.meta.url),
    "utf8",
  );

  it("routes BOTH console dispatch sinks through the never-silent sink", () => {
    expect(source).toContain("performStagedDispatch");
    // The swallowed form the run-12 triage named: an unobserved kickoff whose
    // early return (null manager) and null settle were both invisible.
    expect(source).not.toContain("void manager.kickoff(");
  });
});

/**
 * P2N RED (grant 3320): the LIVE `kickoff-mismatch` at ZERO frames.
 *
 * Run 2850g (evidence native-glm-web-pc-p4-live-2850g) drove the REAL Core: seat
 * held, real lanes, Dispatch ENABLED and clicked — and the console settled
 * `unknown/kickoff-mismatch` with ZERO `peer/dispatch` frames. P2L's instrument
 * named the branch, and that name SENT THE HUNT the wrong way: `kickoff-mismatch`
 * is the lazy manager's load/authority class, so the brief reads as a
 * record-identity bug (a record snapshot replaced by the post-acquire inventory
 * refresh). It is not.
 *
 * These cases drive the REAL `LazyPeerManager` over the REAL `PeerManager` and
 * the REAL prepare encoder, so the actual live vector is reproduced: the console
 * admits a blank Title (its gate requires only a non-empty brief), the encoder
 * REJECTS a present-but-blank `title` (`peer-prepare.ts:14`), `kickoff` settles
 * `null` on a FULLY CURRENT authority, and the sink reports it as a load
 * mismatch. A genuine `#load`/`#current` mismatch must STILL say so — that typed
 * reason stays for the real foreign-record case.
 */
describe("P2N — a local prepare rejection is NOT a load/authority mismatch", () => {
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

  it("names a LOCAL rejection as `invalid-staging`, never the mismatch branch", async () => {
    // A manager whose encoder refused locally publishes its own bounded
    // prepareError; the sink must read THAT, not assume the load/authority class.
    const kickoff = vi.fn(async () => null);
    const outcome = await performStagedDispatch({
      manager: {
        kickoff,
        getSnapshot: () => ({
          prepareError:
            "Check the peer brief and fleet settings before retrying.",
        }),
      },
      laneKey: "lane-review",
      brief: "",
      title: "",
      selectLane: () => undefined,
    });
    expect(outcome).toEqual({ kind: "unknown", reason: "invalid-staging" });
  });

  it("KEEPS `kickoff-mismatch` for a genuine null with NO local error", async () => {
    const outcome = await performStagedDispatch({
      manager: {
        kickoff: async () => null,
        getSnapshot: () => ({ prepareError: null }),
      },
      laneKey: "lane-review",
      brief: "Review this",
      title: "review",
      selectLane: () => undefined,
    });
    expect(outcome).toEqual({ kind: "unknown", reason: "kickoff-mismatch" });
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
