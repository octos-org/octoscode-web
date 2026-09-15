import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import {
  SessionControlBar,
  type RuntimeModelControlProps,
  type SessionControlBarProps,
} from "./SessionControlBar.tsx";
import type {
  PeerControllerPanelProps,
  PeerControllerPanelState,
} from "../control/PeerControllerPanel.tsx";
import type {
  DriverInventoryDisclosure,
  DriverInventoryState,
} from "../session/driver-discovery.ts";
import type { SessionControlReadiness } from "../session/session-record-manager.ts";
import zh from "../preferences/zh.ts";

/**
 * Mount contract for the peer CONTROLLER console (grant 2840; program 2800 §3).
 * The bar must render the console as a SIBLING section of the control seat,
 * gated exactly like the seat PLUS `peer/dispatch` — and must NOT render it (nor
 * emit a frame) when the gate fails. apps/web has NO jsdom, so markup
 * assertions are static. `peerController` does not exist on the shipped bar
 * yet; the probe cast keeps this file running as the RED, exactly like
 * SessionControlBar.control-seat.test.tsx.
 */
type Seat = PeerControllerPanelProps & { readiness: SessionControlReadiness };
type ProbeProps = SessionControlBarProps & {
  peerController?: Seat | undefined;
};
const Bar = SessionControlBar as unknown as (
  props: ProbeProps,
) => ReactElement | null;

function caps(
  methods: string[],
  features: string[] = [EXTERNAL_DRIVER_V1_FEATURE],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

const ADMITTING = caps([
  "session/open",
  EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
  EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
]);

const external = (): DriverInventoryState => ({
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "7",
  rows: [],
  completedAtMs: 1,
  disclosure: {
    mode: "external",
    recovery: "none",
    binding: null,
  } as DriverInventoryDisclosure,
});

const runtime = (): RuntimeModelControlProps => ({
  label: "Fixture runtime",
  onOpenSettings: vi.fn(),
});

function seat(over: Partial<Seat> = {}): Seat {
  return {
    readiness: "ready",
    capabilities: ADMITTING,
    lanePicker: { kind: "ready", keys: ["lane-primary"] },
    seatHeld: true,
    binding: null,
    roster: [],
    state: { kind: "idle" } as PeerControllerPanelState,
    ...over,
  };
}

const render = (peerController: Seat | undefined): string =>
  renderToStaticMarkup(
    <Bar
      ariaLabel="Session controls"
      permission={null}
      model={null}
      runtimeModel={runtime()}
      driverInventory={external()}
      peerController={peerController}
    />,
  );

describe("SessionControlBar peer controller — mount gate", () => {
  it("omits the console entirely when no seat prop is supplied", () => {
    expect(render(undefined)).not.toContain(
      'data-control-seat="peer-controller"',
    );
  });

  it("hides the console when readiness is unavailable", () => {
    expect(render(seat({ readiness: "unavailable" }))).not.toContain(
      'data-control-seat="peer-controller"',
    );
  });

  it("hides the console when peer/dispatch is not advertised", () => {
    const html = render(
      seat({
        capabilities: caps([EXTERNAL_DRIVER_METHODS.PEER_CONTROL]),
      }),
    );
    // The wrapper mounts on readiness alone (exactly like the seat); the PANEL
    // re-gates on peer/control + peer/dispatch and renders nothing without it.
    expect(html).toContain('data-control-seat="peer-controller"');
    expect(html).not.toContain('data-control-panel="peer-controller"');
  });

  it("hides the console when external_driver_v1 is not advertised", () => {
    const html = render(
      seat({
        capabilities: caps(
          [
            EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
            EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
          ],
          [],
        ),
      }),
    );
    expect(html).not.toContain('data-control-panel="peer-controller"');
  });

  it("renders the console as a sibling section when ready and admitted", () => {
    const html = render(seat());
    expect(html).toContain('data-control-seat="peer-controller"');
    expect(html).toContain('data-control-panel="peer-controller"');
  });

  it("keeps the picker DISABLED without an admitted lane read", () => {
    const html = render(seat({ lanePicker: { kind: "disabled" } }));
    expect(html).toContain('data-lane-picker="disabled"');
    expect(html).not.toContain("<option");
  });
});

describe("SessionControlBar peer controller — parked seat (P2k)", () => {
  it("THREADS the parked latch: the released console offers Acquire seat", () => {
    // P2k (grant 3210): the mount hunk forwarded every other console prop but
    // SILENTLY DROPPED `seatReleased`/`onAcquireSeat`, so a parked seat
    // rendered Dispatch+Release closed with NO way back — the operator's only
    // re-entry was unreachable and run 14 (:554) failed on a correct panel.
    const html = render(
      seat({ seatHeld: false, seatReleased: true, onAcquireSeat: vi.fn() }),
    );
    expect(html).toMatch(/data-control-action="dispatch"[^>]*disabled/);
    expect(html).toMatch(/data-control-action="release-seat"[^>]*disabled/);
    expect(html).toContain('data-control-action="acquire-seat"');
    expect(html).toContain('aria-label="Acquire seat"');
  });

  it("keeps the latch: a held seat never renders a second acquire", () => {
    expect(render(seat())).not.toContain('data-control-action="acquire-seat"');
    expect(render(seat({ seatReleased: false }))).not.toContain(
      'data-control-action="acquire-seat"',
    );
  });
});

describe("peer controller Chinese catalog", () => {
  it("covers every controller label with matching placeholders", () => {
    for (const key of [
      "Peer controller",
      "Model lane",
      "Brief",
      "Title",
      "Dispatch",
      "Dispatch peer",
      "Release seat",
      "Staging",
      "Approve",
      "Deny",
      "Steer",
      "Interrupt",
      "Worker",
      "Duplicate",
      "Already applied",
      "Newly applied",
      "Bound to {value0} @ epoch {value1}",
      "Approve {value0}",
      "Deny {value0}",
      "Steer {value0}",
      "Interrupt {value0}",
    ]) {
      expect(zh[key], key).toBeTruthy();
      expect(zh[key]?.match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(
        key.match(/\{\w+\}/g)?.sort() ?? [],
      );
    }
  });
});
