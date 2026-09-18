import { describe, expect, it } from "vitest";
import type { DriverInventoryState } from "../session/driver-discovery.ts";
import {
  FLEET_FACTS_RESTORE_FAILED,
  FLEET_FACTS_RESTORING,
  aggregateFleetFacts,
  fleetFactsForOperation,
  unionFleetFacts,
} from "./fleet-facts.ts";

const BASE = "coding:local:tui";

function inventoryOperation(over: {
  operationId: string;
  slug: string;
  adoptedSessionId?: string;
  model?: string;
  modelLane?: string;
  workspaceRoot?: string;
  goalId?: string;
  acceptedAtMs?: number;
  lifecycle?: string;
}) {
  return {
    operationId: over.operationId,
    slug: over.slug,
    lifecycle: over.lifecycle ?? "started",
    acceptance: {
      model: over.model ?? "glm-5.3",
      modelLane: over.modelLane ?? "external-master",
      workspaceRoot: over.workspaceRoot ?? "/srv/project",
      scopedGoal: over.goalId === undefined ? null : { goalId: over.goalId },
      adoptedSessionId: over.adoptedSessionId ?? `${BASE}#peer-${over.slug}`,
      adoptedTurnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
      slug: over.slug,
      acceptedAtMs: over.acceptedAtMs ?? 1_000,
      payloadDigest: "d".repeat(64),
    },
  };
}

function completeInventory(
  operations: readonly ReturnType<typeof inventoryOperation>[],
): DriverInventoryState {
  return {
    kind: "complete",
    snapshot: "snap-1",
    observedRevision: "7",
    rows: Object.freeze(
      operations.map((operation) => ({
        operationId: operation.operationId,
        slug: operation.slug,
        lifecycle: operation.lifecycle,
      })),
    ),
    operations: Object.freeze(operations),
    completedAtMs: 5_000,
    disclosure: Object.freeze({
      mode: "internal",
      recovery: "none",
      binding: null,
    }),
  };
}

describe("aggregateFleetFacts — judge #3 cross-session aggregation", () => {
  it("aggregates rows across sessions keyed by operation id (never the slug)", () => {
    const facts = aggregateFleetFacts([
      {
        sessionId: "coding:local:tui",
        inventory: completeInventory([
          inventoryOperation({ operationId: "op-a", slug: "zed" }),
        ]),
      },
      {
        sessionId: "coding:local:tui#other-master",
        inventory: completeInventory([
          inventoryOperation({
            operationId: "op-b",
            slug: "zed", // SAME slug, DIFFERENT operation — two rows, no clash
            adoptedSessionId: "coding:local:tui#other-master#peer-zed",
          }),
        ]),
      },
    ]);
    expect(facts.operations.size).toBe(2);
    expect(facts.operations.get("op-a")!.slug).toBe("zed");
    expect(facts.operations.get("op-b")!.slug).toBe("zed");
    expect(facts.operations.get("op-b")!.adoptedSessionId).toBe(
      "coding:local:tui#other-master#peer-zed",
    );
  });

  it("keeps the LAST write per operation id across refreshes", () => {
    const first = aggregateFleetFacts([
      {
        sessionId: BASE,
        inventory: completeInventory([
          inventoryOperation({
            operationId: "op-a",
            slug: "zed",
            model: "glm-5.3",
            lifecycle: "started",
          }),
        ]),
      },
    ]);
    const merged = aggregateFleetFacts([
      {
        sessionId: BASE,
        inventory: completeInventory([
          inventoryOperation({
            operationId: "op-a",
            slug: "zed",
            model: "kimi-k3",
            lifecycle: "terminal",
          }),
        ]),
      },
    ]);
    expect(first.operations.get("op-a")!.model).toBe("glm-5.3");
    expect(merged.operations.get("op-a")!.model).toBe("kimi-k3");
    expect(merged.operations.get("op-a")!.lifecycle).toBe("terminal");
  });

  it("ignores non-complete inventories (no rows derived from absence)", () => {
    const facts = aggregateFleetFacts([
      { sessionId: BASE, inventory: { kind: "unavailable" } },
      { sessionId: BASE, inventory: { kind: "loading" } },
      { sessionId: BASE, inventory: { kind: "error", reason: "stale" } },
    ]);
    expect(facts.operations.size).toBe(0);
  });

  it("tracks which sessions reported at least one accepted operation", () => {
    const facts = aggregateFleetFacts([
      {
        sessionId: BASE,
        inventory: completeInventory([
          inventoryOperation({ operationId: "op-a", slug: "zed" }),
        ]),
      },
      { sessionId: "coding:local:tui#empty", inventory: completeInventory([]) },
    ]);
    expect([...facts.sessionIdsWithOperations]).toEqual([BASE]);
  });
});

describe("fleetFactsForOperation — the typed seam fleet-02 renders", () => {
  it("projects every acceptance field without deriving identity from a slug", () => {
    const facts = aggregateFleetFacts([
      {
        sessionId: BASE,
        inventory: completeInventory([
          inventoryOperation({
            operationId: "op-a",
            slug: "zed",
            adoptedSessionId: "coding:local:tui#peer-worker-77",
            model: "glm-5.3",
            modelLane: "lane-strong",
            workspaceRoot: "/srv/peer-work",
            goalId: "goal-9",
            acceptedAtMs: 1_757_900_000_000,
            lifecycle: "started",
          }),
        ]),
      },
    ]);
    const fact = fleetFactsForOperation(facts, "op-a");
    expect(fact).not.toBeNull();
    expect(fact!.operationId).toBe("op-a");
    expect(fact!.slug).toBe("zed");
    expect(fact!.adoptedSessionId).toBe("coding:local:tui#peer-worker-77");
    expect(fact!.adoptedTurnId).toBe("0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01");
    expect(fact!.model).toBe("glm-5.3");
    expect(fact!.modelLane).toBe("lane-strong");
    expect(fact!.workspaceRoot).toBe("/srv/peer-work");
    expect(fact!.goalId).toBe("goal-9");
    expect(fact!.acceptedAtMs).toBe(1_757_900_000_000);
    expect(fact!.lifecycle).toBe("started");
  });

  it("returns null for an operation no session reported (fail closed)", () => {
    const facts = aggregateFleetFacts([]);
    expect(fleetFactsForOperation(facts, "op-missing")).toBeNull();
  });

  it("exposes the restoration states rows render (§4.3 reconstruction)", () => {
    const facts = aggregateFleetFacts([
      {
        sessionId: BASE,
        inventory: completeInventory([
          inventoryOperation({ operationId: "op-a", slug: "zed" }),
        ]),
      },
    ]);
    expect(facts.restorations.get("op-a")).toBeUndefined();
    const restored = aggregateFleetFacts(
      [
        {
          sessionId: BASE,
          inventory: completeInventory([
            inventoryOperation({ operationId: "op-a", slug: "zed" }),
          ]),
        },
      ],
      {
        restorations: new Map([["op-a", { state: "restoring" as const }]]),
      },
    );
    expect(restored.restorations.get("op-a")).toEqual({
      state: FLEET_FACTS_RESTORING,
    });
    const failed = aggregateFleetFacts(
      [
        {
          sessionId: BASE,
          inventory: completeInventory([
            inventoryOperation({ operationId: "op-a", slug: "zed" }),
          ]),
        },
      ],
      {
        restorations: new Map([["op-a", { state: "failed" as const }]]),
      },
    );
    expect(failed.restorations.get("op-a")).toEqual({
      state: FLEET_FACTS_RESTORE_FAILED,
    });
  });
});

/** A peer-manager roster entry, structurally compatible with the real type. */
function rosterEntry(over: {
  identity: string;
  slug: string;
  operationId?: string | null;
  status?: "opening" | "started" | "failed" | "unknown" | "closed";
  activity?: "idle" | "live" | "blocked" | "done";
  outcome?: "finished" | "stopped" | "failed" | null;
  outputTokens?: number;
  topic?: string;
}) {
  return {
    identity: over.identity,
    profileId: "coding",
    topic: over.topic ?? "peer-prepare-only",
    slug: over.slug,
    cwd: "/srv/project",
    briefPath: "/peers/brief.md",
    origin: "staged" as const,
    turnId: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9f99",
    status: over.status ?? "started",
    activity: over.activity ?? "idle",
    openedAt: 1_000,
    finishedAt: null,
    outputTokens: over.outputTokens ?? 0,
    requestId: null,
    requestKind: null,
    operationId: over.operationId ?? null,
    acknowledgment: null,
    outcome: over.outcome ?? null,
    turnChangedSinceAck: false,
    error: null,
    canRetry: false,
  };
}

describe("unionFleetFacts — Union 4240: roster rows ∪ inventory acceptance rows", () => {
  const INVENTORY_OP = inventoryOperation({
    operationId: "op-walked",
    slug: "walked",
    adoptedSessionId: "coding:local:tui#peer-walked",
    model: "glm-5.3",
    acceptedAtMs: 1_000,
  });

  function inventoryFacts() {
    return aggregateFleetFacts([
      {
        sessionId: "coding:local:tui",
        inventory: completeInventory([INVENTORY_OP]),
      },
    ]);
  }

  it("unions a roster-only peer (dock's row) into the facts the Fleet renders", () => {
    // The LIVE defect: the dock showed 'reply-ready-2 · failed' while Fleet
    // said 'No peers yet' — the roster peer never reached the Fleet source.
    const union = unionFleetFacts(inventoryFacts(), {
      rosters: [
        {
          sessionId: "coding:local:tui",
          peers: [
            rosterEntry({
              identity: "coding:local:tui#peer-reply-ready-2",
              slug: "reply-ready-2",
              status: "started",
              activity: "done",
              outcome: "failed",
            }),
          ],
        },
      ],
    });
    const walked = union.byAdoptedSession.get("coding:local:tui#peer-walked");
    const dockOnly = union.byAdoptedSession.get(
      "coding:local:tui#peer-reply-ready-2",
    );
    expect(walked).toBeDefined();
    expect(dockOnly).toBeDefined();
    expect(union.rows).toHaveLength(2);
    expect(dockOnly!.source).toBe("roster");
    expect(dockOnly!.status).toBe("failed");
    expect(dockOnly!.activity).toBe("done");
    expect(dockOnly!.operationId).toBeNull();
  });

  it("keys the union by adopted session id, merging a roster row with its inventory acceptance", () => {
    const union = unionFleetFacts(inventoryFacts(), {
      rosters: [
        {
          sessionId: "coding:local:tui",
          peers: [
            rosterEntry({
              // SAME adopted session the inventory reported: ONE row, merged.
              identity: "coding:local:tui#peer-walked",
              slug: "walked",
              operationId: "op-walked",
              activity: "live",
              outputTokens: 42,
            }),
          ],
        },
      ],
    });
    expect(union.rows).toHaveLength(1);
    const row = union.rows[0]!;
    expect(row.operationId).toBe("op-walked");
    expect(row.source).toBe("both");
    // Inventory acceptance fields survive the merge…
    expect(row.model).toBe("glm-5.3");
    expect(row.acceptedAtMs).toBe(1_000);
    // …and the roster's live axis rides along.
    expect(row.activity).toBe("live");
    expect(row.tokens).toBe(42);
  });

  it("falls back to the roster identity for prepare-only peers (no acceptance yet)", () => {
    const union = unionFleetFacts(aggregateFleetFacts([]), {
      rosters: [
        {
          sessionId: "coding:local:tui",
          peers: [
            rosterEntry({
              identity: "coding:local:tui#peer-prep",
              slug: "prep",
              status: "opening",
              activity: "idle",
              operationId: null,
            }),
          ],
        },
      ],
    });
    expect(union.rows).toHaveLength(1);
    const row = union.rows[0]!;
    expect(row.adoptedSessionId).toBe("coding:local:tui#peer-prep");
    expect(row.source).toBe("roster");
    expect(row.operationId).toBeNull();
    expect(row.model).toBeNull();
  });

  it("exposes an inventory-only row (server knows the peer; the roster does not)", () => {
    const union = unionFleetFacts(inventoryFacts(), { rosters: [] });
    expect(union.rows).toHaveLength(1);
    const row = union.rows[0]!;
    expect(row.source).toBe("inventory");
    expect(row.model).toBe("glm-5.3");
    expect(row.activity).toBeNull();
    expect(row.tokens).toBeNull();
  });

  it("labels every row 'Peer N · model' or 'Peer N' — never the raw slug", () => {
    const union = unionFleetFacts(inventoryFacts(), {
      rosters: [
        {
          sessionId: "coding:local:tui",
          peers: [
            rosterEntry({
              identity: "coding:local:tui#peer-reply-ready-2",
              slug: "reply-ready-2",
              activity: "done",
              outcome: "failed",
            }),
          ],
        },
      ],
    });
    for (const row of union.rows) {
      expect(row.label).toMatch(/^Peer \d+( · .+)?$/);
      expect(row.label).not.toContain("reply-ready-2");
      expect(row.label).not.toContain("walked");
    }
  });
});
