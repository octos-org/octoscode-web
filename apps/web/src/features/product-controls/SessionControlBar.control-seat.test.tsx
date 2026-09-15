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
import {
  sendPeerControl,
  type PeerControlFence,
  type PeerControlLeaf,
  type PeerControlRequest,
  type PeerControlTarget,
} from "../control/peer-control-commands.ts";
import type { PeerControlPanelState } from "../control/PeerControlPanel.tsx";
import type {
  DriverInventoryDisclosure,
  DriverInventoryState,
} from "../session/driver-discovery.ts";
import type { SessionControlReadiness } from "../session/session-record-manager.ts";

/**
 * Mount contract for the control seat (grant 0745). The bar must render the
 * peer/control panel NEXT TO the read-only controller disclosure, gated on the
 * record snapshot's `controlReadiness === "ready"` — and must NOT render it (nor
 * emit a frame) when readiness is unavailable. apps/web has NO jsdom, so an
 * interactive click cannot be simulated: markup assertions are static, and the
 * "exactly one frame" contract is asserted over the same seam the panel uses
 * (panel button -> onSend -> sendPeerControl -> leaf.peerControl) with a spy
 * leaf — no sleeps, no test-only export. The `peerControl` prop does not exist
 * on the shipped bar yet; the probe cast keeps this file running as the RED.
 */
type ProbeProps = SessionControlBarProps & {
  peerControl?:
    | {
        readiness: SessionControlReadiness;
        capabilities: UiProtocolCapabilities | undefined;
        leaf: PeerControlLeaf | null;
        fence: PeerControlFence;
        target: PeerControlTarget;
        state: PeerControlPanelState;
        onSend?: (command: PeerControlRequest["command"]) => void;
      }
    | undefined;
};
const Bar = SessionControlBar as unknown as (
  props: ProbeProps,
) => ReactElement | null;

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

const ADMITTING: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/open", EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

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

function seat(
  readiness: SessionControlReadiness,
  leaf: PeerControlLeaf | null,
  onSend?: (command: PeerControlRequest["command"]) => void,
) {
  return {
    readiness,
    capabilities: ADMITTING,
    leaf,
    fence: FENCE,
    target: TARGET,
    state: { kind: "idle" } as PeerControlPanelState,
    ...(onSend ? { onSend } : {}),
  };
}

const render = (peerControl: ReturnType<typeof seat> | undefined): string =>
  renderToStaticMarkup(
    <Bar
      ariaLabel="Session controls"
      permission={null}
      model={null}
      runtimeModel={runtime()}
      driverInventory={external()}
      peerControl={peerControl}
    />,
  );

const spyLeaf = (): { leaf: PeerControlLeaf; calls: PeerControlRequest[] } => {
  const calls: PeerControlRequest[] = [];
  return {
    leaf: {
      peerControl: vi.fn(async (params: PeerControlRequest) => {
        calls.push(params);
        return {} as never;
      }) as PeerControlLeaf["peerControl"],
    },
    calls,
  };
};

describe("SessionControlBar control seat — mount gate", () => {
  it("hides the control seat when readiness is unavailable", () => {
    const html = render(seat("unavailable", spyLeaf().leaf));
    expect(html).not.toContain('data-control-panel="peer"');
  });

  it("omits the control seat entirely when no seat prop is supplied", () => {
    const html = render(undefined);
    expect(html).not.toContain('data-control-panel="peer"');
    expect(html).toContain('data-control-seat="driver"');
  });

  it("renders the control seat next to the disclosure when readiness is ready", () => {
    const html = render(seat("ready", spyLeaf().leaf));
    expect(html).toContain('data-control-panel="peer"');
    expect(html).toContain('data-control-seat="driver"');
  });

  it("stays hidden when ready but the leaf is null (panel fail-closed)", () => {
    const html = render(seat("ready", null));
    expect(html).not.toContain('data-control-panel="peer"');
  });

  it("wires all four command buttons to the seat's single activation sink", () => {
    const html = render(seat("ready", spyLeaf().leaf, vi.fn()));
    for (const kind of [
      "approval_respond",
      "question_respond",
      "steer",
      "interrupt",
    ]) {
      expect(html).toContain(`data-control-command="${kind}"`);
    }
  });

  it("emits exactly ONE peer/control frame per command and never on render", async () => {
    const { leaf, calls } = spyLeaf();
    // Same seam App uses: onSend -> sendPeerControl -> leaf.peerControl.
    const onSend = (command: PeerControlRequest["command"]) =>
      void sendPeerControl(leaf, FENCE, TARGET, command);
    render(seat("ready", leaf, onSend));
    expect(calls).toHaveLength(0); // render never sends
    await sendPeerControl(leaf, FENCE, TARGET, { kind: "interrupt" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      driverId: "drv-1",
      epoch: 7,
      controlToken: "tok-secret",
      operationId: "ctl-op-1",
      targetOperationId: "dispatch-op-1",
      expectedTurnId: TURN,
      command: { kind: "interrupt" },
    });
  });
});
