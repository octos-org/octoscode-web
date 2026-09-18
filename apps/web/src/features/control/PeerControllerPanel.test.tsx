/**
 * PeerControllerPanel unit tests — P2 RED (grant 2840; program 2800 §3).
 *
 * The staging console is FAIL-CLOSED and presentation-only, exactly like the
 * control SEAT: unless BOTH `peer/control` and `peer/dispatch` are advertised
 * (with `external_driver_v1`) it renders NOTHING and sends ZERO frames. The
 * lane `<select>` is driven ONLY by the pure `peer-lane-source` state (no
 * literal fallback), Dispatch is disabled until seat + admitted lane + brief,
 * and every row affordance maps onto the seat's own `PEER_CONTROL_COMMAND_KINDS`
 * table through `performPeerControl`.
 *
 * Rendered with react-dom/server `renderToStaticMarkup` — the repo convention
 * (PeerControlPanel.test.tsx:1). apps/web has NO jsdom, so a click cannot be
 * simulated: markup assertions are static and the "exactly one frame" contract
 * is asserted over the PURE activation seam with a spy leaf.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  peerControlRefusalLabel,
  type PeerControlFence,
  type PeerControlLeaf,
  type PeerControlRequest,
  type PeerControlTarget,
} from "./peer-control-commands.ts";
import { performPeerControl } from "./peer-control-activation.ts";
import type { PeerLanePickerState } from "./peer-lane-source.ts";
import type { DriverInventoryDisclosureBinding } from "../session/driver-discovery.ts";
import {
  PEER_CONTROLLER_ROW_ACTIONS,
  PeerControllerPanel,
  buildRowControlCommand,
  peerControllerDispatchAdmitted,
  type PeerControllerPanelState,
  type PeerControllerRosterRow,
} from "./PeerControllerPanel.tsx";

const CANARY = "CANARY-2840-raw-server-detail";
const TURN = "11111111-1111-1111-1111-111111111111";

const FENCE: PeerControlFence = {
  driverId: "drv-1",
  epoch: 7,
  controlToken: "tok-secret",
};

const TARGET: PeerControlTarget = {
  controlOperationId: "ctl-op-1",
  targetOperationId: "dispatch-op-1",
  expectedTurnId: TURN,
};

const BINDING: DriverInventoryDisclosureBinding = {
  driverId: "drv-1",
  epoch: 7,
  revision: 12,
  leaseExpiresAtMs: 1_700_000_000_000,
};

const ROW: PeerControllerRosterRow = {
  slug: "peer-abc",
  operationId: "dispatch-op-1",
  turnId: TURN,
  // P2p (task 3530 §2): the row's activity axis, projected from the manager's
  // own `PeerActivity`. A started peer streaming its turn is `live`.
  activity: "live",
};

function caps(
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 1,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

const ADMITTED = caps(
  [EXTERNAL_DRIVER_METHODS.PEER_CONTROL, EXTERNAL_DRIVER_METHODS.PEER_DISPATCH],
  [EXTERNAL_DRIVER_V1_FEATURE],
);

const READY: PeerLanePickerState = {
  kind: "ready",
  keys: ["lane-primary", "lane-review"],
};
const DISABLED: PeerLanePickerState = { kind: "disabled" };

function leafSpy() {
  const peerControl = vi.fn(async (_request: PeerControlRequest) => ({
    operationId: TARGET.controlOperationId,
    state: "accepted" as const,
    targetOperationId: TARGET.targetOperationId,
    expectedTurnId: TURN,
    targetSessionId: "dev:local:tui#peer-abc",
    slug: "peer-abc",
    acceptedAtMs: 1,
    payloadDigest: "digest",
    duplicate: false,
  }));
  const leaf: PeerControlLeaf = { peerControl };
  return { leaf, peerControl };
}

type PanelProps = Parameters<typeof PeerControllerPanel>[0];

function render(over: Partial<PanelProps> = {}): string {
  return renderToStaticMarkup(
    <PeerControllerPanel
      capabilities={ADMITTED}
      lanePicker={READY}
      seatHeld={true}
      binding={BINDING}
      roster={[ROW]}
      state={{ kind: "idle" }}
      {...over}
    />,
  );
}

describe("PeerControllerPanel — fail-closed capability gate", () => {
  it("renders nothing without a capability block", () => {
    expect(render({ capabilities: undefined })).toBe("");
  });

  it("renders nothing when only peer/control is advertised", () => {
    expect(
      render({
        capabilities: caps(
          [EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
          [EXTERNAL_DRIVER_V1_FEATURE],
        ),
      }),
    ).toBe("");
  });

  it("renders nothing when peer/dispatch is advertised without external_driver_v1", () => {
    expect(
      render({
        capabilities: caps([EXTERNAL_DRIVER_METHODS.PEER_DISPATCH]),
      }),
    ).toBe("");
  });

  it("never discloses the control token in markup", () => {
    expect(render()).not.toContain(FENCE.controlToken);
  });
});

describe("PeerControllerPanel — lane picker is the ONLY lane source", () => {
  it("renders every advertised key in advertised order", () => {
    const html = render();
    expect(html).toContain('data-lane-picker="ready"');
    expect(html).toContain('value="lane-primary"');
    expect(html).toContain('value="lane-review"');
  });

  it("is DISABLED with the pure disabled state and invents no fallback option", () => {
    const html = render({ lanePicker: DISABLED });
    expect(html).toContain('data-lane-picker="disabled"');
    expect(html).not.toContain("<option");
  });

  it("starts with NO lane selected: the placeholder is the only selected option", () => {
    const html = render();
    // P2b: the picker is CONTROLLED and starts empty, so the browser can never
    // present the first advertised key as an implicit operator choice.
    expect(html).toContain('<option value="" hidden="" selected=""');
    expect(html).not.toContain('value="lane-primary" selected');
  });

  it("never carries the OUP boundary literal or a fixture lane", () => {
    const html = render();
    expect(html).not.toContain("external-master");
    expect(html).not.toContain("glm-5.3");
  });
});

describe("peerControllerDispatchAdmitted — seat + lane + brief", () => {
  it("requires a held seat, an ADMITTED lane and a non-empty brief", () => {
    expect(
      peerControllerDispatchAdmitted({
        seatHeld: true,
        lanePicker: READY,
        lane: "lane-primary",
        brief: "Review this",
      }),
    ).toBe(true);
  });

  it("refuses each half: no seat, a disabled picker, a blank brief, an unknown lane", () => {
    const base = {
      seatHeld: true,
      lanePicker: READY,
      lane: "lane-primary",
      brief: "Review this",
    };
    expect(peerControllerDispatchAdmitted({ ...base, seatHeld: false })).toBe(
      false,
    );
    expect(
      peerControllerDispatchAdmitted({ ...base, lanePicker: DISABLED }),
    ).toBe(false);
    expect(peerControllerDispatchAdmitted({ ...base, brief: "   " })).toBe(
      false,
    );
    expect(peerControllerDispatchAdmitted({ ...base, lane: "glm-5.3" })).toBe(
      false,
    );
  });

  it("starts DISABLED and stays disabled with no held seat", () => {
    // P2b: the console OWNS the staging inputs, and they start EMPTY, so an
    // untouched console can never dispatch — the caller has no way to pre-seed
    // a lane/brief (they are no longer props).
    const fresh = render();
    expect(fresh).toContain('data-control-action="dispatch"');
    expect(
      fresh.match(/data-control-action="dispatch"[^>]*disabled/),
    ).not.toBeNull();
    expect(
      render({ seatHeld: false }).match(
        /data-control-action="dispatch"[^>]*disabled/,
      ),
    ).not.toBeNull();
  });

  it("is NOT propped with caller-held lane/brief/title (console-owned state)", () => {
    const source = readFileSync(
      new URL("./PeerControllerPanel.tsx", import.meta.url),
      "utf8",
    );
    // The staging inputs are React-controlled state, never props. (The doc
    // comment above legitimately names the removed props, so the assertions
    // target the JSX usage, not the word.)
    expect(source).toContain("useState<PeerControllerStaging>");
    expect(source).not.toMatch(/readOnly=\{/);
    expect(source).not.toMatch(/defaultValue=\{/);
  });

  it("disables Release seat exactly when no seat is held", () => {
    expect(render({ seatHeld: false })).toMatch(
      /data-control-action="release-seat"[^>]*disabled/,
    );
    expect(render({ seatHeld: true })).not.toMatch(
      /data-control-action="release-seat"[^>]*disabled/,
    );
  });

  it("offers NO Acquire seat until the operator has parked the seat", () => {
    // P3 (grant 3120 §b): a Release must LATCH. The re-offer exists ONLY in the
    // released state; a held seat never shows a second acquire affordance.
    expect(render()).not.toContain('data-control-action="acquire-seat"');
    expect(render({ seatReleased: false })).not.toContain(
      'data-control-action="acquire-seat"',
    );
  });

  it("parks the console when released: controls closed, Acquire seat offered", () => {
    const parked = render({ seatHeld: false, seatReleased: true });
    // Dispatch and Release are BOTH closed (seatHeld is false once parked)...
    expect(parked).toMatch(/data-control-action="dispatch"[^>]*disabled/);
    expect(parked).toMatch(/data-control-action="release-seat"[^>]*disabled/);
    // ...and the ONLY live affordance is the explicit re-acquire.
    expect(parked).toContain('data-control-action="acquire-seat"');
    expect(parked).toContain('aria-label="Acquire seat"');
  });
});

describe("PeerControllerPanel — binding badge", () => {
  it("renders the observed driver id and epoch", () => {
    const html = render();
    expect(html).toContain('data-driver-binding="drv-1"');
    expect(html).toContain('data-binding-epoch="7"');
  });

  it("renders no badge when nothing is bound", () => {
    expect(render({ binding: null })).not.toContain("data-driver-binding=");
  });
});

describe("PeerControllerPanel — per-roster-row affordances", () => {
  it("renders Steer/Interrupt/Approve/Deny for each row, keyboard reachable", () => {
    const html = render();
    expect(html).toContain('data-peer-row="peer-abc"');
    for (const action of PEER_CONTROLLER_ROW_ACTIONS)
      expect(html).toContain(`data-row-action="${action}"`);
    // Native <button>, so Tab/Enter/Space work without a key handler.
    expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("routes EVERY row action through the seat's own command kinds", async () => {
    for (const action of PEER_CONTROLLER_ROW_ACTIONS) {
      const { leaf, peerControl } = leafSpy();
      const state = await performPeerControl({
        leaf,
        fence: FENCE,
        target: TARGET,
        command: buildRowControlCommand(action),
      });
      expect(peerControl).toHaveBeenCalledTimes(1);
      expect(state.kind).toBe("receipt");
    }
  });

  it("maps approve/deny onto the approval decision, steer/interrupt onto their kinds", () => {
    expect(buildRowControlCommand("approve")).toMatchObject({
      kind: "approval_respond",
      decision: "approve",
    });
    expect(buildRowControlCommand("deny")).toMatchObject({
      kind: "approval_respond",
      decision: "deny",
    });
    expect(buildRowControlCommand("steer").kind).toBe("steer");
    expect(buildRowControlCommand("interrupt")).toEqual({ kind: "interrupt" });
  });

  it("emits exactly ONE frame per row action and renders a stale fence from the typed refusal (2920 (c))", async () => {
    // The console's row sink routes through the SAME `performPeerControl` seam
    // the seat's Steer uses (use-octos-session.ts `sendPeerRowControl`), so a
    // stale fence must surface the Core's OWN typed `driver_fence_stale` — one
    // frame, never a retry, never raw copy.
    const peerControl = vi.fn(async () => {
      throw Object.assign(new Error("refused"), {
        name: "ExternalDriverRefusalError",
        refusalKind: "driver_fence_stale",
      });
    });
    const leaf: PeerControlLeaf = { peerControl };
    const state = await performPeerControl({
      leaf,
      fence: FENCE,
      target: TARGET,
      command: buildRowControlCommand("steer"),
    });
    expect(peerControl).toHaveBeenCalledTimes(1);
    expect(state).toEqual({
      kind: "refused",
      refusalKind: "driver_fence_stale",
    });
    const html = render({
      state: {
        kind: "refused",
        source: "control",
        refusalKind: "driver_fence_stale",
      },
    });
    expect(html).toContain('data-controller-state="refused"');
    expect(html).toContain('data-refusal-kind="driver_fence_stale"');
    expect(html).toContain(peerControlRefusalLabel("driver_fence_stale"));
  });
});

describe("PeerControllerPanel — bounded receipts and refusals", () => {
  it("renders a typed refusal through the bounded label, never raw copy", () => {
    const state: PeerControllerPanelState = {
      kind: "refused",
      source: "dispatch",
      refusalKind: "driver_model_unavailable",
      detail: CANARY,
    };
    const html = render({ state });
    expect(html).toContain('data-controller-state="refused"');
    expect(html).toContain('data-refusal-kind="driver_model_unavailable"');
    expect(html).toContain(peerControlRefusalLabel("driver_model_unavailable"));
    expect(html).not.toContain(CANARY);
  });

  it("degrades an unknown kind to the generic control copy", () => {
    const html = render({
      state: {
        kind: "refused",
        source: "control",
        refusalKind: "something_else",
      },
    });
    expect(html).toContain("That action was refused.");
  });

  it("announces receipts and refusals in a polite live region", () => {
    const html = render({
      state: { kind: "receipt", slug: "peer-abc", duplicate: true },
    });
    expect(html).toContain('role="status"');
    expect(html).toContain('data-controller-state="receipt"');
    expect(html).toContain('data-receipt-duplicate="true"');
  });

  it("renders a NOT-CONFIRMED dispatch as a bounded unknown row, never silence (P2g)", () => {
    // A null manager / module mismatch / kind-less rejection must be VISIBLE:
    // the row is announced (role=alert) with bounded copy, never raw detail.
    const html = render({ state: { kind: "unknown", source: "dispatch" } });
    expect(html).toContain('data-controller-state="unknown"');
    expect(html).toContain('data-unknown-source="dispatch"');
    expect(html).toContain("The dispatch could not be confirmed.");
    expect(html).not.toContain(CANARY);
  });

  it("carries the BOUNDED branch marker for a not-confirmed dispatch (P2L 3220)", () => {
    // P2L: run 2850f rendered ONE opaque sentence for 90 s with zero wire frames,
    // so the live diagnostic could not read WHICH precondition fired. The row now
    // exposes the branch as an attribute plus an sr-only companion.
    const html = render({
      state: { kind: "unknown", source: "dispatch", reason: "no-engine" },
    });
    expect(html).toContain('data-unknown-reason="no-engine"');
    expect(html).toContain(
      "The Session record engine was not available for adoption.",
    );
    // A non-dispatch (control) unknown carries NO reason and stays unchanged.
    const control = render({ state: { kind: "unknown", source: "control" } });
    expect(control).not.toContain("data-unknown-reason");
  });
});

describe("PeerControllerPanel source — one staging writer, no literals", () => {
  const source = readFileSync(
    new URL("./PeerControllerPanel.tsx", import.meta.url),
    "utf8",
  );

  it("derives its row table from the seat's PEER_CONTROL_COMMAND_KINDS", () => {
    expect(source).toContain("PeerControlCommandKind");
    expect(source).toContain("buildPeerControlCommand");
  });

  it("never hardcodes a lane literal", () => {
    expect(source).not.toContain("external-master");
    expect(source).not.toContain("glm-5.3");
  });
});
