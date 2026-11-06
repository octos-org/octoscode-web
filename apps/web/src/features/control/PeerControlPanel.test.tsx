/**
 * PeerControlPanel holds the seat's control token (the `fence` prop) while it
 * renders. The caps gate, one frame per command, receipts and typed refusals
 * run end to end in e2e/peer-control.spec.ts; no e2e reads the page for the
 * token, so this keeps that boundary.
 *
 * Rendered with react-dom/server `renderToStaticMarkup` (apps/web has no
 * jsdom).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import type {
  PeerControlFence,
  PeerControlLeaf,
  PeerControlTarget,
} from "./peer-control-commands.ts";
import { PeerControlPanel } from "./PeerControlPanel.tsx";

const ADMITTED: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: [EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

const FENCE: PeerControlFence = {
  driverId: "drv-1",
  epoch: 7,
  controlToken: "tok-secret",
};

const TARGET: PeerControlTarget = {
  controlOperationId: "ctl-op-1",
  targetOperationId: "dispatch-op-1",
  expectedTurnId: "11111111-1111-1111-1111-111111111111",
};

describe("PeerControlPanel — the control token stays out of the page", () => {
  it("renders the admitted seat without sending a frame or disclosing the token", () => {
    const peerControl = vi.fn();
    const leaf = { peerControl } as unknown as PeerControlLeaf;
    const html = renderToStaticMarkup(
      <PeerControlPanel
        capabilities={ADMITTED}
        leaf={leaf}
        fence={FENCE}
        target={TARGET}
        state={{ kind: "idle" }}
      />,
    );
    expect(html).toContain('data-control-panel="peer"');
    // Rendering the seat is inert: no frame until an explicit activation.
    expect(peerControl).not.toHaveBeenCalled();
    expect(html).not.toContain(FENCE.controlToken);
  });
});
