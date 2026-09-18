/**
 * Fleet view model — GLM-WEB-UX2-FLEET-VIEW-4010 RED tests (design
 * WEB-UX-DESIGN-4000 §3, §4.3; program WEB-UX-PROGRAM-4000 goal 3).
 *
 * Pure node tests: grouping, ordering, finished collapse, retention, return
 * state, the status-word projection and the start-form gating are all PURE
 * functions of the coordinator's roster facts, so every acceptance case here
 * runs under vitest with no DOM. These tests are written FIRST (TDD RED) —
 * fleet-model.ts does not exist yet, so this file must fail to import until
 * the implementation lands.
 */
import { describe, expect, it } from "vitest";
import {
  FLEET_STATUS_ORDER,
  fleetActionAvailability,
  fleetAltDActivates,
  fleetAnnouncement,
  fleetGroupPeers,
  fleetModelName,
  fleetModelOptions,
  fleetPhaseFromActivity,
  fleetRosterFromController,
  fleetRowTitle,
  fleetStartAdmitted,
  fleetStatusWord,
  type FleetRosterPeer,
} from "./fleet-model.ts";

function peer(overrides: Partial<FleetRosterPeer> = {}): FleetRosterPeer {
  return {
    slug: "peer-1",
    label: "Peer 1 · glm-5.3",
    title: "Review the diff",
    statusWord: "Working",
    sessionId: "coding:local:tui",
    sessionName: "octoscode-web",
    goalId: null,
    elapsedMs: 60_000,
    tokens: 120,
    controlSupported: true,
    ...overrides,
  };
}

describe("§3 grouping — goal groups when a goal id is known, else one flat group", () => {
  it("groups by goal when dispatches carried a goal id", () => {
    const groups = fleetGroupPeers([
      peer({ slug: "a", goalId: "goal-1" }),
      peer({ slug: "b", goalId: "goal-2" }),
      peer({ slug: "c", goalId: "goal-1" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.goalId)).toEqual(["goal-1", "goal-2"]);
    expect(groups[0]!.peers.map((p) => p.slug)).toEqual(["a", "c"]);
    expect(groups[1]!.peers.map((p) => p.slug)).toEqual(["b"]);
  });

  it("uses one flat 'Peers' group when no goal id is known", () => {
    const groups = fleetGroupPeers([peer({ slug: "a" }), peer({ slug: "b" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.goalId).toBeNull();
    expect(groups[0]!.peers.map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("keeps a goalless peer in its own flat group beside goal groups", () => {
    const groups = fleetGroupPeers([
      peer({ slug: "a", goalId: "goal-1" }),
      peer({ slug: "flat" }),
    ]);
    expect(groups.map((g) => g.goalId)).toEqual(["goal-1", null]);
    expect(groups[1]!.peers.map((p) => p.slug)).toEqual(["flat"]);
  });
});

describe("§3 ordering — waiting for you first, then working, then starting, then finished", () => {
  it("orders a mixed group by the design's status rank, stable within a rank", () => {
    const groups = fleetGroupPeers([
      peer({ slug: "finished", statusWord: "Finished" }),
      peer({ slug: "starting", statusWord: "Starting" }),
      peer({ slug: "waiting", statusWord: "Waiting for your approval" }),
      peer({ slug: "working", statusWord: "Working" }),
      peer({ slug: "waiting2", statusWord: "Waiting for your answer" }),
      peer({ slug: "stopped", statusWord: "Stopped" }),
      peer({ slug: "failed", statusWord: "Failed" }),
    ]);
    expect(groups[0]!.peers.map((p) => p.slug)).toEqual([
      "waiting",
      "waiting2",
      "working",
      "starting",
    ]);
    expect(groups[0]!.finished.map((p) => p.slug)).toEqual([
      "finished",
      "stopped",
      "failed",
    ]);
    // The design's full ordering reads across the active rows then the
    // collapsed Finished bucket (finished last).
    expect(
      [...groups[0]!.peers, ...groups[0]!.finished].map((p) => p.slug),
    ).toEqual([
      "waiting",
      "waiting2",
      "working",
      "starting",
      "finished",
      "stopped",
      "failed",
    ]);
  });

  it("exposes the rank order so the view cannot invent one", () => {
    expect(FLEET_STATUS_ORDER).toEqual([
      "Waiting for your approval",
      "Waiting for your answer",
      "Working",
      "Starting",
      "Finished",
      "Stopped",
      "Failed",
    ]);
  });
});

describe("§3 finished collapse and retention", () => {
  it("splits terminal rows into a collapsed 'Finished (n)' bucket per group", () => {
    const groups = fleetGroupPeers([
      peer({ slug: "live", statusWord: "Working" }),
      peer({ slug: "done1", statusWord: "Finished" }),
      peer({ slug: "done2", statusWord: "Stopped" }),
    ]);
    expect(groups[0]!.peers.map((p) => p.slug)).toEqual(["live"]);
    expect(groups[0]!.finished.map((p) => p.slug)).toEqual(["done1", "done2"]);
    expect(groups[0]!.finishedCount).toBe(2);
  });
});

describe("§4.3 status words and their producing events", () => {
  it("maps the design's event-to-word table one-to-one", () => {
    expect(fleetStatusWord({ phase: "requested" })).toBe("Requested");
    expect(fleetStatusWord({ phase: "starting" })).toBe("Starting");
    expect(fleetStatusWord({ phase: "working" })).toBe("Working");
    expect(fleetStatusWord({ phase: "awaiting", kind: "approval" })).toBe(
      "Waiting for your approval",
    );
    expect(fleetStatusWord({ phase: "awaiting", kind: "question" })).toBe(
      "Waiting for your answer",
    );
    expect(fleetStatusWord({ phase: "finished" })).toBe("Finished");
    expect(fleetStatusWord({ phase: "stopped" })).toBe("Stopped");
    expect(fleetStatusWord({ phase: "failed" })).toBe("Failed");
    expect(fleetStatusWord({ phase: "unknown-outcome" })).toBe(
      "Outcome unknown",
    );
  });

  it("marks a Starting row older than 15 s as a slow start", () => {
    expect(fleetStatusWord({ phase: "starting", startedMs: 0 }, 20_000)).toBe(
      "Still starting…",
    );
    expect(
      fleetStatusWord({ phase: "starting", startedMs: 10_000 }, 20_000),
    ).toBe("Starting");
  });
});

describe("§4.3 Start form gating", () => {
  it("admits a start only with an admitted lane and a non-blank brief", () => {
    expect(
      fleetStartAdmitted({
        lanePicker: { kind: "ready", keys: ["glm-5.3"] },
        lane: "glm-5.3",
        brief: "Review the diff",
        controlSupported: true,
      }),
    ).toBe(true);
    expect(
      fleetStartAdmitted({
        lanePicker: { kind: "disabled" },
        lane: "",
        brief: "Review the diff",
        controlSupported: true,
      }),
    ).toBe(false);
    expect(
      fleetStartAdmitted({
        lanePicker: { kind: "ready", keys: ["glm-5.3"] },
        lane: "glm-5.3",
        brief: "   ",
        controlSupported: true,
      }),
    ).toBe(false);
  });

  it("admits Start WITHOUT a pre-held seat — Start acquires implicitly (Fixes 4210)", () => {
    // Design §4.3: Start is the ONLY implicit acquisition; a pre-held seat is
    // NOT a precondition (walkthrough 4200 step 8 / mock run 20: 8 reds).
    expect(
      fleetStartAdmitted({
        lanePicker: { kind: "ready", keys: ["glm-5.3"] },
        lane: "glm-5.3",
        brief: "Review the diff",
        controlSupported: true,
      }),
    ).toBe(true);
  });

  it("keeps Start closed when the server cannot control peers (case 6)", () => {
    expect(
      fleetStartAdmitted({
        lanePicker: { kind: "ready", keys: ["glm-5.3"] },
        lane: "glm-5.3",
        brief: "Review the diff",
        controlSupported: false,
      }),
    ).toBe(false);
  });
});

describe("§4.3 model NAMES, not lane keys (Fixes 4210)", () => {
  it("shows the configured model name when the caller supplies it", () => {
    expect(fleetModelName("glm-53", { "glm-53": "glm-5.3" })).toBe("glm-5.3");
  });

  it("derives the display name from a compacted two-digit tail otherwise", () => {
    expect(fleetModelName("glm-53")).toBe("glm-5.3");
    expect(fleetModelName("deepseek-flash")).toBe("deepseek-flash");
    expect(fleetModelName("kimi-k3")).toBe("kimi-k3");
    expect(fleetModelName("qwen-235")).toBe("qwen-235");
  });

  it("adds the lane key suffix ONLY when two lanes share a model name", () => {
    expect(
      fleetModelOptions(["lane-a", "lane-b"], {
        "lane-a": "glm-5.3",
        "lane-b": "glm-5.3",
      }).map((option) => option.label),
    ).toEqual(["glm-5.3 (lane-a)", "glm-5.3 (lane-b)"]);
    expect(
      fleetModelOptions(["glm-53"], { "glm-53": "glm-5.3" }).map(
        (option) => option.label,
      ),
    ).toEqual(["glm-5.3"]);
  });
});

describe("§4.3 row title — the brief's first line, 60 chars", () => {
  it("takes the first line and truncates to 60 characters", () => {
    expect(fleetRowTitle("First line\nSecond line")).toBe("First line");
    expect(fleetRowTitle("x".repeat(80))).toHaveLength(60);
    expect(fleetRowTitle("   ")).toBe("Peer started");
  });
});

describe("§4.3 row actions and availability", () => {
  it("offers Approve/Deny only while waiting for your approval", () => {
    const waiting = fleetActionAvailability({
      statusWord: "Waiting for your approval",
    });
    expect(waiting).toMatchObject({ approve: true, deny: true, stop: true });
    const working = fleetActionAvailability({ statusWord: "Working" });
    expect(working).toMatchObject({ approve: false, deny: false });
  });

  it("Steer is enabled only while Working AND the text is non-blank", () => {
    expect(
      fleetActionAvailability({ statusWord: "Working", steerText: "octopus" })
        .steer,
    ).toBe(true);
    expect(
      fleetActionAvailability({ statusWord: "Working", steerText: "   " })
        .steer,
    ).toBe(false);
    expect(
      fleetActionAvailability({
        statusWord: "Waiting for your approval",
        steerText: "octopus",
      }).steer,
    ).toBe(false);
  });

  it("Stop covers Starting, Working and both waiting states", () => {
    for (const statusWord of [
      "Starting",
      "Still starting…",
      "Working",
      "Waiting for your approval",
      "Waiting for your answer",
    ] as const)
      expect(fleetActionAvailability({ statusWord }).stop, statusWord).toBe(
        true,
      );
    for (const statusWord of ["Finished", "Stopped", "Failed"] as const)
      expect(fleetActionAvailability({ statusWord }).stop, statusWord).toBe(
        false,
      );
  });
});

describe("§4.3 roster projection — the controller roster becomes fleet rows", () => {
  it("labels a row 'Peer N · <model>' and projects the status word", () => {
    const [row] = fleetRosterFromController({
      roster: [
        {
          slug: "op-d32a",
          operationId: "op-d32a",
          turnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
          activity: "live",
        },
      ],
      facts: {
        "op-d32a": {
          number: 3,
          model: "glm-5.3",
          title: "Review the diff",
          sessionName: "octoscode-web",
          goalId: "goal-1",
          elapsedMs: 60_000,
          tokens: 120,
        },
      },
    });
    expect(row!.label).toBe("Peer 3 · glm-5.3");
    expect(row!.title).toBe("Review the diff");
    expect(row!.statusWord).toBe("Working");
    expect(row!.sessionId).toBe("coding:local:tui#op-d32a");
    expect(row!.sessionName).toBe("octoscode-web");
    expect(row!.goalId).toBe("goal-1");
    expect(row!.elapsedMs).toBe(60_000);
    expect(row!.tokens).toBe(120);
    expect(row!.controlSupported).toBe(true);
  });

  it("numbers peers by roster order and keeps a blank model out of the label", () => {
    const rows = fleetRosterFromController({
      roster: [
        {
          slug: "a",
          operationId: "a",
          turnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
          activity: "blocked",
        },
        {
          slug: "b",
          operationId: "b",
          turnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d02",
          activity: "staged",
        },
      ],
    });
    expect(rows.map((row) => row.label)).toEqual(["Peer 1", "Peer 2"]);
    expect(rows.map((row) => row.statusWord)).toEqual([
      "Waiting for your approval",
      "Starting",
    ]);
  });

  it("maps every controller activity onto the design's status words", () => {
    expect(fleetPhaseFromActivity("staged")).toBe("starting");
    expect(fleetPhaseFromActivity("live")).toBe("working");
    expect(fleetPhaseFromActivity("blocked")).toBe("awaiting");
    expect(fleetPhaseFromActivity("done")).toBe("finished");
    expect(fleetPhaseFromActivity("reaped")).toBe("finished");
  });

  it("drops control for a reaped row (no accepted operation id)", () => {
    const [row] = fleetRosterFromController({
      roster: [{ slug: "z", operationId: "", turnId: "", activity: "reaped" }],
    });
    expect(row!.controlSupported).toBe(false);
  });
});

describe("§8 live region announcements", () => {
  const base = peer({ slug: "p1", label: "Peer 1 · glm-5.3" });

  it("announces a peer that starts waiting for your approval", () => {
    expect(
      fleetAnnouncement(
        [base],
        [{ ...base, statusWord: "Waiting for your approval" }],
      ),
    ).toBe("Peer 1 · glm-5.3 is waiting for your approval");
  });

  it("announces a finished peer", () => {
    expect(
      fleetAnnouncement(
        [{ ...base, statusWord: "Working" }],
        [{ ...base, statusWord: "Finished" }],
      ),
    ).toBe("Peer 1 · glm-5.3 finished");
  });

  it("stays silent when nothing changed", () => {
    expect(fleetAnnouncement([base], [base])).toBeNull();
    expect(fleetAnnouncement(null, [base])).toBeNull();
  });
});

describe("§8 Alt+D navigates to Fleet and focuses the Brief field", () => {
  it("activates only on Alt+D outside text inputs and dialogs", () => {
    expect(fleetAltDActivates({ altKey: true, key: "d" })).toBe(true);
    expect(fleetAltDActivates({ altKey: true, key: "D", code: "KeyD" })).toBe(
      true,
    );
    expect(fleetAltDActivates({ altKey: false, key: "d" })).toBe(false);
    expect(fleetAltDActivates({ altKey: true, key: "s" })).toBe(false);
    expect(
      fleetAltDActivates({
        altKey: true,
        key: "d",
        target: { tagName: "INPUT" },
      }),
    ).toBe(false);
    expect(
      fleetAltDActivates({
        altKey: true,
        key: "d",
        target: { tagName: "TEXTAREA" },
      }),
    ).toBe(false);
    expect(
      fleetAltDActivates({
        altKey: true,
        key: "d",
        target: { tagName: "SPAN", insideDialog: true },
      }),
    ).toBe(false);
    expect(
      fleetAltDActivates({
        altKey: true,
        key: "d",
        target: { tagName: "SPAN" },
      }),
    ).toBe(true);
  });
});
