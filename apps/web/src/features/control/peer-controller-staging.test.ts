/**
 * peer-controller-staging unit tests — P2b RED (grant 2855).
 *
 * Root addition to P2b: the console must OWN editable controlled state. Before
 * this the lane `<select>` was `defaultValue`-driven and Brief/Title were
 * `readOnly` props, so an operator could neither type a brief nor choose a lane
 * in the product (e2e peer-controller.spec.ts:48-58 documents the gap).
 *
 * These are PURE assertions (no React, no DOM — apps/web has no jsdom): the
 * staging reducer, the stale-pick drop, and the ONE submit payload that carries
 * the operator's typed values all the way into a single `peer/dispatch` frame.
 */
import { describe, expect, it } from "vitest";
import type { DriverAcquireView } from "@octos-org/octoscode-client/external-driver";
import {
  EMPTY_PEER_CONTROLLER_STAGING,
  PEER_DISPATCH_REFUSED_REFUSAL,
  applyPeerControllerEdit,
  peerControllerPanelState,
  peerControllerStagedLane,
  peerControllerStagingSubmit,
  peerControllerStateFrom,
} from "./peer-controller-staging.ts";
import type { PeerLanePickerState } from "./peer-lane-source.ts";
import { peerDispatchRefusalLabel } from "./peer-dispatch-commands.ts";
import { planPeerDispatch } from "../session/use-octos-session.ts";

const READY: PeerLanePickerState = {
  kind: "ready",
  keys: ["lane-primary", "lane-review"],
};
const DISABLED: PeerLanePickerState = { kind: "disabled" };

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [],
  },
  pendingWork: [],
  recovery: "none" as const,
};

describe("peer controller staging starts EMPTY (no implicit lane default)", () => {
  it("starts with no lane, no brief and no title", () => {
    expect(EMPTY_PEER_CONTROLLER_STAGING).toEqual({
      lane: "",
      brief: "",
      title: "",
    });
  });

  it("the staged lane is empty while the picker is disabled", () => {
    expect(
      peerControllerStagedLane(
        { lane: "lane-primary", brief: "b", title: "t" },
        DISABLED,
      ),
    ).toBe("");
  });
});

describe("applyPeerControllerEdit — one controlled field per edit", () => {
  it("writes exactly the edited field and preserves the others", () => {
    const typing = applyPeerControllerEdit(EMPTY_PEER_CONTROLLER_STAGING, {
      field: "brief",
      value: "Review the diff",
    });
    expect(typing).toEqual({
      lane: "",
      brief: "Review the diff",
      title: "",
    });
    const choosing = applyPeerControllerEdit(typing, {
      field: "lane",
      value: "lane-review",
    });
    expect(choosing).toEqual({
      lane: "lane-review",
      brief: "Review the diff",
      title: "",
    });
    const titling = applyPeerControllerEdit(choosing, {
      field: "title",
      value: "diff-review",
    });
    expect(titling).toEqual({
      lane: "lane-review",
      brief: "Review the diff",
      title: "diff-review",
    });
  });

  it("never mutates the previous value", () => {
    const before = { ...EMPTY_PEER_CONTROLLER_STAGING };
    applyPeerControllerEdit(before, { field: "brief", value: "x" });
    expect(before).toEqual({ lane: "", brief: "", title: "" });
  });
});

describe("peerControllerStagedLane — a closed picker can never keep a stale pick", () => {
  it("keeps a staged pick only while the picker still advertises it", () => {
    expect(
      peerControllerStagedLane(
        { lane: "lane-review", brief: "b", title: "t" },
        READY,
      ),
    ).toBe("lane-review");
  });

  it("drops a withdrawn lane instead of substituting another", () => {
    expect(
      peerControllerStagedLane(
        { lane: "glm-5.3", brief: "b", title: "t" },
        READY,
      ),
    ).toBe("");
    expect(
      peerControllerStagedLane(
        { lane: "lane-review", brief: "b", title: "t" },
        { kind: "ready", keys: ["lane-primary"] },
      ),
    ).toBe("");
  });
});

describe("peerControllerStagingSubmit — the ONE submit contract", () => {
  it("returns the typed values as the exact dispatch payload", () => {
    expect(
      peerControllerStagingSubmit({
        staging: { lane: "lane-review", brief: "Review this", title: "review" },
        lanePicker: READY,
        seatHeld: true,
      }),
    ).toEqual({
      laneKey: "lane-review",
      brief: "Review this",
      title: "review",
    });
  });

  it("is NULL whenever the Dispatch gate is closed (nothing is sent)", () => {
    const base = {
      staging: { lane: "lane-primary", brief: "Review this", title: "review" },
      lanePicker: READY,
      seatHeld: true,
    } as const;
    expect(peerControllerStagingSubmit({ ...base, seatHeld: false })).toBe(
      null,
    );
    expect(
      peerControllerStagingSubmit({ ...base, lanePicker: DISABLED }),
    ).toBeNull();
    expect(
      peerControllerStagingSubmit({
        ...base,
        staging: { ...base.staging, lane: "" },
      }),
    ).toBeNull();
    expect(
      peerControllerStagingSubmit({
        ...base,
        staging: { ...base.staging, brief: "   " },
      }),
    ).toBeNull();
  });

  it("refuses a lane the operator could not have chosen", () => {
    expect(
      peerControllerStagingSubmit({
        staging: { lane: "glm-5.3", brief: "Review this", title: "review" },
        lanePicker: READY,
        seatHeld: true,
      }),
    ).toBeNull();
  });
});

describe("the submitted values are ONE peer/dispatch frame (typed brief + lane)", () => {
  it("carries the operator's lane as `model` and the brief into the dispatch", () => {
    const submit = peerControllerStagingSubmit({
      staging: {
        lane: "lane-review",
        brief: "Review the diff",
        title: "diff-review",
      },
      lanePicker: READY,
      seatHeld: true,
    });
    expect(submit).not.toBeNull();
    if (submit === null) return;
    const plan = planPeerDispatch({
      acquire: ACQUIRE,
      laneKeys: READY.kind === "ready" ? READY.keys : [],
      laneKey: submit.laneKey,
      operationId: "op-1",
      seed: {
        brief: submit.brief,
        slug: submit.title,
        prompt: "",
      },
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind !== "dispatch") return;
    expect(plan.params.model).toBe("lane-review");
    expect(plan.params.dispatch).toEqual({
      kind: "new_brief",
      brief: "Review the diff",
      title: "diff-review",
    });
  });
});

describe("peerControllerStateFrom — bounded seat outcomes only", () => {
  it("narrows an accepted seat receipt to the console's row facts", () => {
    expect(
      peerControllerStateFrom({
        kind: "receipt",
        receipt: {
          operationId: "op-1",
          state: "accepted",
          targetOperationId: "dispatch-op-1",
          expectedTurnId: "11111111-1111-1111-1111-111111111111",
          targetSessionId: "dev:local:tui#peer-abc",
          slug: "peer-abc",
          acceptedAtMs: 1,
          payloadDigest: "digest",
          duplicate: false,
        },
      }),
    ).toEqual({ kind: "receipt", slug: "peer-abc", duplicate: false });
  });

  it("keeps a typed refusal bounded to its kind, never raw copy", () => {
    expect(
      peerControllerStateFrom({
        kind: "refused",
        refusalKind: "driver_fence_stale",
      }),
    ).toEqual({
      kind: "refused",
      source: "control",
      refusalKind: "driver_fence_stale",
    });
  });

  it("settles idle for an in-flight seat command", () => {
    expect(peerControllerStateFrom({ kind: "idle" })).toEqual({ kind: "idle" });
    expect(
      peerControllerStateFrom({ kind: "sending", command: "steer" }),
    ).toEqual({ kind: "idle" });
  });
});

describe("peerControllerPanelState — a refused dispatch is NEVER silent (2920 (a))", () => {
  it("renders the TYPED dispatch refusal kind the Core sends via error.data.kind", () => {
    // The Core refuses `peer/dispatch` with a JSON-RPC error carrying
    // `data.kind` (evidence native-glm-dispatch-refusal-shape-2920) and never
    // sets `prepareError`, so a dispatch failure with NO typed kind previously
    // rendered nothing at all. A typed kind must reach the console's own
    // bounded label.
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchRefusalKind: "driver_fence_stale",
      }),
    ).toEqual({
      kind: "refused",
      source: "dispatch",
      refusalKind: "driver_fence_stale",
    });
    expect(peerDispatchRefusalLabel("driver_fence_stale")).toBe(
      "Your control of this session expired",
    );
  });

  it("degrades a kind-less dispatch failure to the generic bounded sentinel", () => {
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: true,
        dispatchRefusalKind: null,
      }),
    ).toEqual({
      kind: "refused",
      source: "dispatch",
      refusalKind: PEER_DISPATCH_REFUSED_REFUSAL,
    });
  });

  it("prefers busy over every settled refusal, and settles idle with no failure", () => {
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: true,
        dispatchFailed: true,
        dispatchRefusalKind: "driver_fence_stale",
      }),
    ).toEqual({ kind: "sending", source: "dispatch" });
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchRefusalKind: null,
      }),
    ).toEqual({ kind: "idle" });
  });
});

describe("peerControllerPanelState — the console's OWN sink is never silent (P2g 3030)", () => {
  it("renders a null-manager sink as the bounded `unknown` row, not idle", () => {
    // Run-12 triage: a ready console with a null manager dispatched nothing and
    // surfaced NOTHING. Fail-closed means VISIBLE, so the sink's `unknown`
    // settles a rendered row.
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchSink: { kind: "unknown", reason: "no-manager" },
      }),
    ).toEqual({ kind: "unknown", source: "dispatch", reason: "no-manager" });
  });

  it("prefers the console's own typed sink refusal over the mirrored manager kind", () => {
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchRefusalKind: "driver_busy_handover",
        dispatchSink: { kind: "refused", refusalKind: "driver_fence_stale" },
      }),
    ).toEqual({
      kind: "refused",
      source: "dispatch",
      refusalKind: "driver_fence_stale",
    });
  });

  it("stays idle for a confirmed `dispatched` sink with no failure", () => {
    expect(
      peerControllerPanelState({
        control: { kind: "idle" },
        dispatchBusy: false,
        dispatchFailed: false,
        dispatchSink: { kind: "dispatched" },
      }),
    ).toEqual({ kind: "idle" });
  });
});
