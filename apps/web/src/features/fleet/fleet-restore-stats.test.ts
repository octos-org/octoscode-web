// T-0687 (R8-F02): restored peers never show fabricated zero stats — a
// missing acceptance stamp or usage means "not restored", never 0s/↓0.
import { describe, expect, it } from "vitest";
import { fleetRosterFromUnion } from "./FleetPane.tsx";
import type { FleetUnionFacts, FleetUnionRow } from "./fleet-facts.ts";

const unionWith = (rows: FleetUnionRow[]): FleetUnionFacts =>
  ({
    rows,
    byAdoptedSession: new Map(rows.map((row) => [row.adoptedSessionId, row])),
    inventory: {
      operations: [],
      sessions: [],
      bySession: new Map(),
      sessionIdsWithOperations: new Set(),
      restorations: [],
    },
  }) as unknown as FleetUnionFacts;

const restoredRow: FleetUnionRow = Object.freeze({
  adoptedSessionId: "dev:local:tui#peer-review",
  operationId: null,
  slug: "review",
  source: "roster",
  fact: null,
  status: "started",
  activity: "done",
  requestKind: null,
  tokens: null,
  label: "Peer 1",
  model: null,
  goalId: null,
  acceptedAtMs: null,
});
const rosterOf = (row: FleetUnionRow) => {
  const [peer] = fleetRosterFromUnion(
    unionWith([row]),
    "/repo/wt",
    false,
    new Set(),
  );
  if (!peer) throw new Error("expected one fleet row");
  return peer;
};

describe("fleetRosterFromUnion restored stats", () => {
  it("a restored row (no stamp, no usage) carries unknown stats, not zeros", () => {
    const peer = rosterOf(restoredRow);
    expect(peer.elapsedMs).toBeNull();
    expect(peer.tokens).toBeNull();
  });
  it("a live row keeps its measured stats", () => {
    const accepted = Date.now() - 8_000;
    const peer = rosterOf(
      Object.freeze({ ...restoredRow, acceptedAtMs: accepted, tokens: 296 }),
    );
    expect(peer.elapsedMs).toBeGreaterThanOrEqual(8_000);
    expect(peer.tokens).toBe(296);
  });
});
