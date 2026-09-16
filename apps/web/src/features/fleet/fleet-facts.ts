/**
 * fleet-facts — the typed FleetFacts projection the Fleet view renders
 * (design WEB-UX-DESIGN-4000 §4.3 reconstruction; round-2 judge item #3;
 * owner web-ux-data-05).
 *
 * PURE aggregation over the driver-inventory states this tab already holds —
 * no I/O, no React, no new store. `session/driver/get`'s operations page is
 * the authoritative source; every acceptance field (operation id,
 * `adopted_session_id`, `adopted_turn_id`, `workspace_root`, `model`,
 * `model_lane`, `scoped_goal`, `accepted_at_ms`, lifecycle) is preserved
 * verbatim. Identity is NEVER rebuilt from a slug — rows are keyed by the
 * server's operation id and carry the server's exact adopted ids.
 *
 * Aggregation contract (§4.3 "re-walk for each session in the tree"):
 *  - rows merge ACROSS sessions (every inventoried session contributes);
 *  - the operation id is the merge key, so two peers sharing a slug stay
 *    two rows and one operation reported by two sessions stays ONE row
 *    (last report wins — a refresh supersedes an older walk);
 *  - non-complete inventories contribute nothing (rows are never derived
 *    from absence);
 *  - `restorations` is CALLER-held hydration state (per-operation
 *    Restoring / restore-failed), defaulted empty; the projection itself
 *    never fabricates a hydration outcome.
 */
import type {
  DriverInventoryOperation,
  DriverInventoryState,
} from "../session/driver-discovery.ts";

/** §4.3 row words: "Restoring…" until hydrated; a failed hydrate keeps the
 * acceptance fields visible with Retry. */
export const FLEET_FACTS_RESTORING = "restoring" as const;
export const FLEET_FACTS_RESTORE_FAILED = "failed" as const;

export type FleetFactRestoration =
  | { readonly state: typeof FLEET_FACTS_RESTORING }
  | { readonly state: typeof FLEET_FACTS_RESTORE_FAILED };

/** The typed facts ONE fleet row renders (every §4.3 acceptance field). */
export interface FleetOperationFact {
  /** The server's operation id — the row's identity key, never the slug. */
  readonly operationId: string;
  /** The acceptance's own slug (display name derivation only). */
  readonly slug: string;
  /** EXACT adopted session id from session/driver/get (never slug-derived). */
  readonly adoptedSessionId: string;
  /** EXACT adopted turn id from session/driver/get. */
  readonly adoptedTurnId: string;
  readonly workspaceRoot: string;
  /** The accepted dispatch's resolved model (§4.3 row label). */
  readonly model: string;
  /** The requested lane key — shown muted only when it differs from model. */
  readonly modelLane: string;
  /** The dispatch's goal id when the acceptance carried one, else null. */
  readonly goalId: string | null;
  /** Wall-clock acceptance; elapsed starts here (§4.3). */
  readonly acceptedAtMs: number;
  readonly lifecycle: string;
}

/** One inventoried session's contribution to the aggregate. */
export interface FleetFactsSessionInput {
  /** The session whose tree the inventory walked (any stable id). */
  readonly sessionId: string;
  readonly inventory: DriverInventoryState;
}

/** The aggregated, typed FleetFacts seam (pure value; frozen rows). */
export interface FleetFacts {
  /** Operation id → facts. Keyed by the SERVER's id — never a slug. */
  readonly operations: ReadonlyMap<string, FleetOperationFact>;
  /** Sessions that reported at least one accepted operation, in input order. */
  readonly sessionIdsWithOperations: readonly string[];
  /**
   * Caller-held per-operation hydration state (§4.3 "Restoring…" /
   * "Couldn't restore this peer" + Retry). Empty until a hydrate runs.
   */
  readonly restorations: ReadonlyMap<string, FleetFactRestoration>;
}

/** Project one walked operation row into the typed fact (pure copy). */
function factOf(operation: DriverInventoryOperation): FleetOperationFact {
  return Object.freeze({
    operationId: operation.operationId,
    slug: operation.slug,
    adoptedSessionId: operation.acceptance.adoptedSessionId,
    adoptedTurnId: operation.acceptance.adoptedTurnId,
    workspaceRoot: operation.acceptance.workspaceRoot,
    model: operation.acceptance.model,
    modelLane: operation.acceptance.modelLane,
    goalId: operation.acceptance.scopedGoal?.goalId ?? null,
    acceptedAtMs: operation.acceptance.acceptedAtMs,
    lifecycle: operation.lifecycle,
  });
}

/**
 * Aggregate every session's walked inventory into ONE FleetFacts value.
 * Later reports for the same operation id supersede earlier ones (a refresh
 * replaces the older walk's facts); ordering is otherwise input-stable.
 */
export function aggregateFleetFacts(
  sessions: readonly FleetFactsSessionInput[],
  options: {
    readonly restorations?: ReadonlyMap<string, FleetFactRestoration>;
  } = {},
): FleetFacts {
  const operations = new Map<string, FleetOperationFact>();
  const sessionIds: string[] = [];
  for (const session of sessions) {
    const { inventory } = session;
    // Older complete states may lack `operations` (compat); absence
    // contributes nothing — facts are never derived from `rows` alone.
    if (inventory.kind !== "complete" || inventory.operations === undefined)
      continue;
    if (
      inventory.operations.length > 0 &&
      !sessionIds.includes(session.sessionId)
    )
      sessionIds.push(session.sessionId);
    for (const operation of inventory.operations) {
      operations.set(operation.operationId, factOf(operation));
    }
  }
  return Object.freeze({
    operations,
    sessionIdsWithOperations: Object.freeze(sessionIds),
    restorations:
      options.restorations ?? new Map<string, FleetFactRestoration>(),
  });
}

/**
 * Fail-closed read of ONE operation's facts: null when no inventoried session
 * reported it (fleet-02 renders the restoration copy, never a fabricated row).
 */
export function fleetFactsForOperation(
  facts: FleetFacts,
  operationId: string,
): FleetOperationFact | null {
  return facts.operations.get(operationId) ?? null;
}

/**
 * Union 4240: the LIVE axis of one roster peer — a structural slice of
 * `PeerRosterEntry` (peer-manager.ts) so the hook can thread the real manager
 * snapshot with no casts. Optional fields stay optional for fixtures.
 */
export interface FleetRosterPeerInput {
  /** The manager's row key: `<profile>:local:tui#peer-<slug>`. */
  readonly identity: string;
  readonly slug: string;
  /** The peer/dispatch operation id once a receipt confirmed the start. */
  readonly operationId?: string | null;
  readonly status?: "opening" | "started" | "failed" | "unknown" | "closed";
  readonly activity?: "idle" | "live" | "blocked" | "done";
  readonly outcome?: "finished" | "stopped" | "failed" | null;
  readonly outputTokens?: number;
}

/** One roster source: the session whose peer manager holds these rows. */
export interface FleetRosterSessionInput {
  readonly sessionId: string;
  readonly peers: readonly FleetRosterPeerInput[];
}

/**
 * The projected terminal/status word for a roster row (the row's OWN axis,
 * never re-derived): outcome when present, else lifecycle status, else the
 * live activity. `started` stays "started" — a running row is not terminal.
 */
export type FleetUnionStatus =
  | "opening"
  | "started"
  | "failed"
  | "unknown"
  | "closed"
  | "finished"
  | "stopped";

function rosterStatusOf(peer: FleetRosterPeerInput): FleetUnionStatus {
  if (peer.outcome) return peer.outcome;
  return (peer.status ?? "unknown") as FleetUnionStatus;
}

/** One UNION row: inventory acceptance facts ∪ roster live axis. */
export interface FleetUnionRow {
  /** The union key: the EXACT adopted session id (roster identity fallback). */
  readonly adoptedSessionId: string;
  /** The inventory's operation id when known, else the roster's, else null. */
  readonly operationId: string | null;
  readonly slug: string;
  /** Where the row's facts came from — drives the Fleet's copy per source. */
  readonly source: "inventory" | "roster" | "both";
  /** Inventory acceptance facts (null for prepare-only roster peers). */
  readonly fact: FleetOperationFact | null;
  /** Roster live axis (null for inventory-only rows). */
  readonly status: FleetUnionStatus | null;
  readonly activity: FleetRosterPeerInput["activity"] | null;
  readonly tokens: number | null;
  /** "Peer N · model" or "Peer N" — assigned in stable row order, never a slug. */
  readonly label: string;
  readonly model: string | null;
  readonly goalId: string | null;
  readonly acceptedAtMs: number | null;
}

/** The union seam fleet-02 renders (pure value; frozen rows, stable order). */
export interface FleetUnionFacts {
  /** Rows in (inventory-then-roster) first-seen order. */
  readonly rows: readonly FleetUnionRow[];
  /** adopted session id → row. */
  readonly byAdoptedSession: ReadonlyMap<string, FleetUnionRow>;
  /** The aggregated inventory facts this union was built from (unchanged). */
  readonly inventory: FleetFacts;
}

function unionLabel(number: number, model: string | null): string {
  return model && model !== "" ? `Peer ${number} · ${model}` : `Peer ${number}`;
}

/**
 * UNION the aggregated inventory acceptance rows with the peer manager's
 * roster rows (Union 4240; design §3/§4.3 — the dock is the per-session slice
 * of Fleet, so both surfaces must agree).
 *
 * Keying: the EXACT adopted session id from the inventory acceptance; a
 * roster row matches it when its `identity` (the manager's row key, the
 * adopted `<profile>:local:tui#peer-<slug>`) is that same id. A roster row
 * with no matching acceptance (prepare-only, or a staged peer whose receipt
 * has not landed) keeps its OWN identity as the key — the fallback root
 * explicitly allows prepare-only peers into the union.
 *
 * Merge precedence: acceptance fields come from the INVENTORY (server
 * authority); the live axis (status/activity/outcome/tokens) comes from the
 * ROSTER when present, else null. Labels are assigned AFTER the union in
 * first-seen order: "Peer N · model" or "Peer N" — never the raw slug.
 */
export function unionFleetFacts(
  inventory: FleetFacts,
  options: { readonly rosters?: readonly FleetRosterSessionInput[] } = {},
): FleetUnionFacts {
  const rosters = options.rosters ?? [];
  // 1) Index roster rows by identity (the manager's adopted-session key).
  const rosterBySession = new Map<string, FleetRosterPeerInput>();
  for (const roster of rosters) {
    for (const peer of roster.peers) {
      if (!rosterBySession.has(peer.identity)) {
        rosterBySession.set(peer.identity, peer);
      }
    }
  }
  // 2) Walk the inventory facts first (stable first-seen order)…
  const rows: FleetUnionRow[] = [];
  const byAdoptedSession = new Map<string, FleetUnionRow>();
  const claimed = new Set<string>();
  for (const fact of inventory.operations.values()) {
    const roster = rosterBySession.get(fact.adoptedSessionId) ?? null;
    if (roster) claimed.add(roster.identity);
    const row: FleetUnionRow = Object.freeze({
      adoptedSessionId: fact.adoptedSessionId,
      operationId: roster?.operationId ?? fact.operationId,
      slug: fact.slug,
      source: roster === null ? "inventory" : "both",
      fact,
      status: roster === null ? null : rosterStatusOf(roster),
      activity: roster?.activity ?? null,
      tokens: roster?.outputTokens ?? null,
      // Label assigned below, once the full order is known.
      label: "",
      model: fact.model,
      goalId: fact.goalId,
      acceptedAtMs: fact.acceptedAtMs,
    });
    rows.push(row);
    byAdoptedSession.set(row.adoptedSessionId, row);
  }
  // 3) …then every roster row the inventory did not claim (roster-only).
  for (const roster of rosterBySession.values()) {
    if (claimed.has(roster.identity)) continue;
    const row: FleetUnionRow = Object.freeze({
      adoptedSessionId: roster.identity,
      operationId: roster.operationId ?? null,
      slug: roster.slug,
      source: "roster",
      fact: null,
      status: rosterStatusOf(roster),
      activity: roster.activity ?? null,
      tokens: roster.outputTokens ?? null,
      label: "",
      model: null,
      goalId: null,
      acceptedAtMs: null,
    });
    rows.push(row);
    byAdoptedSession.set(row.adoptedSessionId, row);
  }
  // 4) Assign labels in final order — "Peer N · model" / "Peer N", no slugs.
  const numbered = rows.map((row, index) =>
    Object.freeze({
      ...row,
      label: unionLabel(index + 1, row.model),
    }),
  );
  return Object.freeze({
    rows: Object.freeze(numbered),
    byAdoptedSession: new Map(
      numbered.map((row) => [row.adoptedSessionId, row]),
    ),
    inventory,
  });
}
