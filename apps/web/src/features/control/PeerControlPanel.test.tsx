/**
 * PeerControlPanel unit tests (plan 0630, build grant 0700).
 *
 * Rendered with react-dom/server `renderToStaticMarkup` — the repo convention
 * (PeerDock.test.tsx:1, ProductSidebar.test.tsx:1). apps/web has NO jsdom /
 * @testing-library, so an interactive click cannot be simulated; every render
 * assertion is over static markup, and the "exactly one frame" contract is
 * asserted over the PURE command seam (`sendPeerControl`) with a spy leaf. No
 * sleeps, no timeout-as-success, no test-only product export.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  PEER_CONTROL_COMMAND_KINDS,
  buildPeerControlParams,
  peerControlAdmitted,
  peerControlRefusalLabel,
  sendPeerControl,
  type PeerControlLeaf,
  type PeerControlRequest,
  type PeerControlTarget,
  type PeerControlFence,
} from "./peer-control-commands.ts";
import {
  PeerControlPanel,
  type PeerControlPanelState,
} from "./PeerControlPanel.tsx";

const CANARY = "CANARY-0700-raw-server-detail";
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

function caps(over: Partial<UiProtocolCapabilities> = {}): UiProtocolCapabilities {
  return {
    version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
    capabilities_schema_version: 1,
    supported_methods: [],
    supported_notifications: [],
    supported_features: [],
    ...over,
  };
}

const ADMITTED = caps({
  supported_methods: [EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
});

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

describe("peerControlAdmitted — fail-closed capability gate", () => {
  it("admits only when method AND feature are both advertised", () => {
    expect(peerControlAdmitted(ADMITTED)).toBe(true);
  });

  it("rejects an absent capability block", () => {
    expect(peerControlAdmitted(undefined)).toBe(false);
  });

  it("rejects a missing feature, a missing method, or an empty block", () => {
    expect(
      peerControlAdmitted(
        caps({ supported_methods: [EXTERNAL_DRIVER_METHODS.PEER_CONTROL] }),
      ),
    ).toBe(false);
    expect(
      peerControlAdmitted(
        caps({ supported_features: [EXTERNAL_DRIVER_V1_FEATURE] }),
      ),
    ).toBe(false);
    expect(peerControlAdmitted(caps())).toBe(false);
  });
});

describe("sendPeerControl — exactly one frame per command", () => {
  it.each(PEER_CONTROL_COMMAND_KINDS)(
    "emits exactly ONE peer/control frame for %s",
    async (kind) => {
      const { leaf, peerControl } = leafSpy();
      const command = commandFor(kind);
      const receipt = await sendPeerControl(leaf, FENCE, TARGET, command);
      expect(peerControl).toHaveBeenCalledTimes(1);
      const args = peerControl.mock.calls[0]?.[0];
      expect(args).toEqual({
        driverId: FENCE.driverId,
        epoch: FENCE.epoch,
        controlToken: FENCE.controlToken,
        operationId: TARGET.controlOperationId,
        targetOperationId: TARGET.targetOperationId,
        expectedTurnId: TURN,
        command,
      });
      expect(receipt.duplicate).toBe(false);
    },
  );

  it("does not retry when the leaf rejects", async () => {
    const peerControl = vi.fn(async () => {
      throw new Error("boom");
    });
    const leaf: PeerControlLeaf = { peerControl };
    await expect(
      sendPeerControl(leaf, FENCE, TARGET, { kind: "interrupt" }),
    ).rejects.toThrow("boom");
    expect(peerControl).toHaveBeenCalledTimes(1);
  });

  it("builds the exact leaf argument shape (no wire/snake casing at this seam)", () => {
    expect(
      buildPeerControlParams(FENCE, TARGET, { kind: "interrupt" }),
    ).toEqual({
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

describe("PeerControlPanel — hidden without caps", () => {
  it("renders nothing and sends ZERO frames when the gate fails", () => {
    const { leaf, peerControl } = leafSpy();
    const html = renderToStaticMarkup(
      <PeerControlPanel
        capabilities={caps()}
        leaf={leaf}
        fence={FENCE}
        target={TARGET}
        state={{ kind: "idle" }}
      />,
    );
    expect(html).toBe("");
    expect(peerControl).not.toHaveBeenCalled();
  });

  it("renders nothing when capabilities or leaf is absent", () => {
    expect(
      renderToStaticMarkup(
        <PeerControlPanel
          capabilities={undefined}
          leaf={null}
          fence={FENCE}
          target={TARGET}
          state={{ kind: "idle" }}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <PeerControlPanel
          capabilities={ADMITTED}
          leaf={null}
          fence={FENCE}
          target={TARGET}
          state={{ kind: "idle" }}
        />,
      ),
    ).toBe("");
  });

  it("renders the seat with all four commands when admitted", () => {
    const { leaf, peerControl } = leafSpy();
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
    for (const kind of PEER_CONTROL_COMMAND_KINDS) {
      expect(html).toContain(`data-control-command="${kind}"`);
    }
    // Rendering the seat is inert: no frame until an explicit activation.
    expect(peerControl).not.toHaveBeenCalled();
    // The control token is never disclosed in markup.
    expect(html).not.toContain(FENCE.controlToken);
  });
});

describe("PeerControlPanel — typed refusal and receipt rendering", () => {
  it("renders the typed refusal kind, never raw server detail", () => {
    const { leaf } = leafSpy();
    const state: PeerControlPanelState = {
      kind: "refused",
      refusalKind: "driver_operation_conflict",
      detail: CANARY,
    };
    const html = renderToStaticMarkup(
      <PeerControlPanel
        capabilities={ADMITTED}
        leaf={leaf}
        fence={FENCE}
        target={TARGET}
        state={state}
      />,
    );
    expect(html).toContain('data-refusal-kind="driver_operation_conflict"');
    expect(html).toContain(peerControlRefusalLabel("driver_operation_conflict"));
    expect(html).not.toContain(CANARY);
  });

  it("renders the receipt duplicate flag", () => {
    const { leaf } = leafSpy();
    const receipt = {
      operationId: TARGET.controlOperationId,
      state: "accepted" as const,
      targetOperationId: TARGET.targetOperationId,
      expectedTurnId: TURN,
      targetSessionId: "dev:local:tui#peer-abc",
      slug: "peer-abc",
      acceptedAtMs: 1,
      payloadDigest: "digest",
      duplicate: true,
    };
    const html = renderToStaticMarkup(
      <PeerControlPanel
        capabilities={ADMITTED}
        leaf={leaf}
        fence={FENCE}
        target={TARGET}
        state={{ kind: "receipt", receipt }}
      />,
    );
    expect(html).toContain('data-receipt-duplicate="true"');
    expect(html).toContain("peer-abc");
  });
});

function commandFor(kind: (typeof PEER_CONTROL_COMMAND_KINDS)[number]) {
  switch (kind) {
    case "approval_respond":
      return {
        kind,
        approvalId: "app-1",
        decision: "approve" as const,
      };
    case "question_respond":
      return { kind, questionId: "q-1", answers: [{ freeText: "yes" }] };
    case "steer":
      return { kind, input: [{ kind: "text" as const, text: "go left" }] };
    case "interrupt":
      return { kind };
  }
}
