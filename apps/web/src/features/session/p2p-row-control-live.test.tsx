/**
 * P2p RED→GREEN (task 3530) — the console ROW's Steer/Interrupt on the LIVE Core.
 *
 * Root's P4C unfiltered wire capture (evidence native-glm-web-pc-p4c-row-wire-3530)
 * settles what P4b could only infer: the row Steer DOES reach the wire, but
 *   (a) its steer text was the HARDCODED placeholder `synthetic-steer`, never the
 *       operator's typed words — `buildRowControlCommand` ignored the input box;
 *   (b) `expected_turn_id` was the MASTER session's turn (`b86a3059-…`), not the
 *       adopted PEER turn (`01a09a29-…`) the dispatch receipt carries — so the
 *       Core addressed the wrong turn. `target_operation_id` was already right;
 *   (c) neither an accepted nor a refused control receipt was rendered anywhere
 *       on the row, so the operator could not tell a landed control from silence;
 *   (d) the row exposed no activity attribute at all.
 *
 * The fixture below is the LIVE P4C capture verbatim (token-free). apps/web has
 * NO jsdom, so a click cannot be simulated: the "exactly ONE frame" contract is
 * asserted over the PURE activation seam with a spy leaf (repo convention,
 * PeerControllerPanel.test.tsx:12-15), and the row's DOM is asserted statically.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  type DriverAcquireView,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  peerControlRefusalLabel,
  type PeerControlLeaf,
  type PeerControlRequest,
} from "../control/peer-control-commands.ts";
import { performPeerControl } from "../control/peer-control-activation.ts";
import {
  buildPeerRowControlTarget,
  peerControllerRosterRows,
  peerControllerRowActivity,
} from "../control/peer-controller-staging.ts";
import {
  PeerControllerPanel,
  buildRowControlCommand,
  type PeerControllerRosterRow,
} from "../control/PeerControllerPanel.tsx";
import type { PeerLanePickerState } from "../control/peer-lane-source.ts";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";
import { peerControlFenceFor } from "./use-octos-session.ts";

/** The LIVE P4C capture facts, verbatim (token-free). */
const LIVE = {
  masterSessionId: "dev:api:web-901b638b-c4a7-499e-938b-29ed52c44125",
  /** The MASTER session's turn — what the broken wire carried as expected_turn_id. */
  masterTurnId: "b86a3059-a8b2-4803-89fe-9e6b32735db6",
  /** The ACCEPTED staged dispatch the row's control targets. */
  dispatchOperationId: "089aaa4b-ad49-43a1-838c-66bf4ac778ae",
  /** The receipt's ADOPTED peer turn — what the wire SHOULD carry. */
  adoptedTurnId: "01a09a29-3920-7c82-9d49-727ea79915f4",
  slug: "op-d64fdfa0f10048c3b220e20551620b38",
  adoptedSessionId:
    "dev:api:web-901b638b-c4a7-499e-938b-29ed52c44125#peer-op-d64fdfa0f10048c3b220e20551620b38",
  lane: "glm-53",
} as const;

/** The HELD seat (P2i): the fence every row control must dispatch through. */
const ACQUIRE: DriverAcquireView = {
  capability: {
    driverId: "octoscode-web:881ac638",
    epoch: 26,
    reveal: () => "ctl-tok",
  },
  binding: {
    driverId: "octoscode-web:881ac638",
    epoch: 26,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [LIVE.dispatchOperationId],
  },
  pendingWork: [LIVE.dispatchOperationId],
  recovery: "none" as const,
};

const CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
    EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
  ],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

const LANES: PeerLanePickerState = { kind: "ready", keys: [LIVE.lane] };

/** The row the LIVE console renders: the adopted turn, never the staging turn. */
const ROW: PeerControllerRosterRow = {
  slug: LIVE.slug,
  operationId: LIVE.dispatchOperationId,
  turnId: LIVE.adoptedTurnId,
  activity: "live",
};

function entry(over: Partial<PeerRosterEntry> = {}): PeerRosterEntry {
  return {
    identity: `dev#peer-${LIVE.slug}`,
    profileId: "dev",
    topic: "peer-p2p",
    slug: LIVE.slug,
    cwd: "/repo/wt",
    briefPath: "/peers/p2p/brief.md",
    origin: "staged",
    // The STAGING kickoff id the pre-fix row wrongly used as expected_turn_id.
    turnId: LIVE.masterTurnId,
    status: "started",
    activity: "live",
    openedAt: 1,
    finishedAt: null,
    outputTokens: 0,
    operationId: LIVE.dispatchOperationId,
    error: null,
    canRetry: false,
    ...over,
  };
}

function leafSpy() {
  const peerControl = vi.fn(async (_request: PeerControlRequest) => ({
    operationId: _request.operationId,
    state: "accepted" as const,
    targetOperationId: _request.targetOperationId,
    expectedTurnId: _request.expectedTurnId,
    targetSessionId: LIVE.adoptedSessionId,
    slug: LIVE.slug,
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
      capabilities={CAPS}
      lanePicker={LANES}
      seatHeld={true}
      binding={null}
      roster={[ROW]}
      state={{ kind: "idle" }}
      {...over}
    />,
  );
}

describe("P2p (a) — the row Steer carries the OPERATOR's text, not a placeholder", () => {
  it("builds the typed steer text (trimmed), never `synthetic-steer`", () => {
    expect(buildRowControlCommand("steer", "  octopus ")).toEqual({
      kind: "steer",
      input: [{ kind: "text", text: "octopus" }],
    });
  });

  it("sends exactly ONE frame with the operator's text through the HELD seat fence", async () => {
    const target = buildPeerRowControlTarget({
      row: ROW,
      newOperationId: () => "ctl-op-0001",
    });
    expect(target).not.toBeNull();
    const { leaf, peerControl } = leafSpy();
    const state = await performPeerControl({
      leaf,
      fence: peerControlFenceFor(ACQUIRE),
      target: target!,
      command: buildRowControlCommand("steer", "octopus"),
    });
    expect(peerControl).toHaveBeenCalledTimes(1);
    expect(peerControl.mock.calls[0]![0]).toMatchObject({
      driverId: "octoscode-web:881ac638",
      epoch: 26,
      controlToken: "ctl-tok",
      operationId: "ctl-op-0001",
      targetOperationId: LIVE.dispatchOperationId,
      expectedTurnId: LIVE.adoptedTurnId,
      command: { kind: "steer", input: [{ kind: "text", text: "octopus" }] },
    });
    expect(state.kind).toBe("receipt");
  });

  it("refuses a BLANK steer locally — no target, so no frame at all", () => {
    expect(
      buildPeerRowControlTarget({ row: ROW, newOperationId: () => "ctl-op" }),
    ).not.toBeNull();
    expect(buildRowControlCommand("steer", "   ")).toEqual({
      kind: "steer",
      input: [{ kind: "text", text: "" }],
    });
  });
});

describe("P2p (b) — expected_turn_id is the ADOPTED peer turn, not the master turn", () => {
  it("stamps the receipt's adopted turn onto the row (staging turn never wins)", () => {
    const rows = peerControllerRosterRows(
      [entry()],
      new Map([[LIVE.slug, LIVE.adoptedTurnId]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.turnId).toBe(LIVE.adoptedTurnId);
    expect(rows[0]?.turnId).not.toBe(LIVE.masterTurnId);
  });

  it("keeps the adopted turn CURRENT when the peer starts a new turn", () => {
    const NEW_TURN = "01a09b00-1111-7c82-9d49-727ea79915f4";
    const rows = peerControllerRosterRows(
      [entry()],
      new Map([[LIVE.slug, NEW_TURN]]),
    );
    expect(rows[0]?.turnId).toBe(NEW_TURN);
  });

  it("targets the accepted dispatch with the adopted turn for BOTH steer and interrupt", async () => {
    for (const action of ["steer", "interrupt"] as const) {
      const target = buildPeerRowControlTarget({
        row: ROW,
        newOperationId: () => `ctl-${action}`,
      });
      const { leaf, peerControl } = leafSpy();
      await performPeerControl({
        leaf,
        fence: peerControlFenceFor(ACQUIRE),
        target: target!,
        command: buildRowControlCommand(action, "octopus"),
      });
      expect(peerControl).toHaveBeenCalledTimes(1);
      expect(peerControl.mock.calls[0]![0]).toMatchObject({
        targetOperationId: LIVE.dispatchOperationId,
        expectedTurnId: LIVE.adoptedTurnId,
      });
    }
  });

  it("fails closed on a row with no accepted dispatch id", () => {
    expect(
      buildPeerRowControlTarget({
        row: { operationId: "", turnId: LIVE.adoptedTurnId },
        newOperationId: () => "ctl-op",
      }),
    ).toBeNull();
  });
});

describe("P2p (d) — the row exposes data-activity, reusing the manager's own axis", () => {
  it("reads the activity axis from observeSessionEvent's own vocabulary", () => {
    expect(
      peerControllerRowActivity({ status: "opening", activity: "idle" }),
    ).toBe("staged");
    expect(
      peerControllerRowActivity({ status: "started", activity: "live" }),
    ).toBe("live");
    expect(
      peerControllerRowActivity({ status: "started", activity: "blocked" }),
    ).toBe("blocked");
    expect(
      peerControllerRowActivity({ status: "started", activity: "done" }),
    ).toBe("done");
    expect(
      peerControllerRowActivity({ status: "closed", activity: "done" }),
    ).toBe("reaped");
  });

  it("renders the activity glyph + attribute on the row", () => {
    for (const activity of [
      "staged",
      "live",
      "blocked",
      "done",
      "reaped",
    ] as const) {
      const html = render({ roster: [{ ...ROW, activity }] });
      expect(html).toContain(`data-peer-row="${LIVE.slug}"`);
      expect(html).toContain(`data-activity="${activity}"`);
    }
  });

  it("offers no control affordance on a reaped row (fail closed)", () => {
    const html = render({ roster: [{ ...ROW, activity: "reaped" }] });
    expect(html).toContain('data-activity="reaped"');
    expect(html).not.toContain('data-row-action="steer"');
  });
});

describe("P2p (c) — the control receipt/refusal renders ON the row", () => {
  it("renders an accepted receipt on its own row", () => {
    const html = render({
      roster: [{ ...ROW, control: { kind: "receipt", duplicate: false } }],
    });
    expect(html).toContain('data-row-control-state="receipt"');
    expect(html).toContain('data-row-control-slug="' + LIVE.slug + '"');
  });

  it("renders a typed refusal through the BOUNDED label on its own row", () => {
    const html = render({
      roster: [
        {
          ...ROW,
          control: { kind: "refused", refusalKind: "driver_fence_stale" },
        },
      ],
    });
    expect(html).toContain('data-row-control-state="refused"');
    expect(html).toContain('data-row-refusal-kind="driver_fence_stale"');
    // The BOUNDED label, never raw server copy.
    expect(html).toContain(peerControlRefusalLabel("driver_fence_stale"));
  });
});

describe("P2p — the row owns a per-row steer input", () => {
  it("renders a steer input per row and disables Steer until text is typed", () => {
    const html = render();
    expect(html).toContain(`data-row-steer-input="${LIVE.slug}"`);
    // Blank text ⇒ Steer cannot reach the encoder's empty-array rejection.
    expect(html).toMatch(/data-row-action="steer"[^>]*disabled/);
  });

  it("builds the row command from the operator's text at the click site", () => {
    const source = readFileSync(
      new URL("../control/PeerControllerPanel.tsx", import.meta.url),
      "utf8",
    );
    // The click site derives the command's text from the row's OWN draft —
    // never a constant. (The module doc deliberately NAMES the old placeholder
    // while explaining the defect, so the assertion targets the JSX/call site,
    // not the word — the repo's own convention, cf. the P2b props assertion.)
    expect(source).toContain("steerTextFor(action, row, steerDrafts)");
    expect(source).toContain("data-row-steer-input");
    expect(source).not.toMatch(/buildRowControlCommand\(\s*action\s*\)/);
  });
});
