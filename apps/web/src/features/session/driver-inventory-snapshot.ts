/**
 * Read-only driver-inventory snapshot adapter.
 *
 * Extracted from the hook's former `currentDriverInventory()` predicate and then
 * FIXED for the captured-render identity contract (1908 extraction → 2022 native
 * behavioral RED → 2025 adapter fix). The real hook wires the getter returned by
 * `createDriverInventorySnapshot` into `useSyncExternalStore`; the values
 * captured at render time (`viewRecord` / `viewAuthority` / `viewEpoch`) are the
 * identity under which the snapshot was produced, and a read may only succeed
 * while that captured identity is still the live one.
 *
 * Contract (truthful current behavior):
 *  - the getter never re-resolves a LATEST selection; it reads the CAPTURED
 *    `viewRecord` and requires `manager.selected() === viewRecord`, the retained
 *    `manager.get(record.scope) === record`, and `record.closed === false`;
 *  - the captured epoch must agree with BOTH the record scope's own
 *    `authorityEpoch` and the live current auth epoch;
 *  - the runtime's real `isCurrent(CAPTURED viewAuthority)` must hold
 *    (generation + physical client), the CURRENT authority must exist, and the
 *    pooled transport client must be that same physical client;
 *  - the record scope must agree with the captured AND current authority on
 *    sessionId / profileId / cwd↔workspaceRoot / endpoint;
 *  - every read still re-gates CURRENT readiness/connected/healthy and CURRENT
 *    capabilities (method + feature + optional client method), because a
 *    same-generation authority can replace its capabilities without a new
 *    generation — a cached `complete` must never survive that.
 * A same-generation capability swap changes only `capabilities`, so whole
 * authority POINTER equality is deliberately NOT required. Pure sync read: no
 * mutation, command-factory call, RPC, poll, new store or eager import.
 *
 * Type-only imports only: no eager `external-driver` runtime import.
 */

import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import type { DriverInventoryState } from "./driver-discovery.ts";

/**
 * The two literal admission keys the record manager uses for driver discovery.
 * Kept local (no new eager `external-driver` import); the manager remains the
 * sole authority that opens the discovery walk.
 */
const DRIVER_INVENTORY_METHOD = "session/driver/get";
const DRIVER_INVENTORY_FEATURE = "external_driver_v1";

/**
 * Stable non-owner snapshot: shared identity, so React never sees a new object.
 * Exported so the hook's SSR/server getter hands back the exact same value.
 */
export const UNAVAILABLE_DRIVER_INVENTORY: DriverInventoryState = Object.freeze(
  { kind: "unavailable" },
);

/**
 * Structural read surfaces the adapter depends on. These are the SMALLEST
 * shapes the predicate actually reads; the real `ActiveSessionAuthority` /
 * `SessionRecord` / `SessionRecordManager` are all structurally assignable, so
 * the hook wires them with no casts and the contract test can build narrow
 * fixtures with no casts either.
 */
export interface DriverInventorySnapshotAuthority {
  readonly generation: number;
  readonly capabilities: UiProtocolCapabilities | undefined;
  readonly sessionId: string;
  readonly profileId: string;
  readonly cwd: string;
  readonly config: { readonly endpoint: string };
  /** Optional read-only external-driver commands; absence is explicit. */
  readonly client: { readonly externalDriverCommands?: unknown };
}

export interface DriverInventorySnapshotScope {
  readonly endpoint: string;
  readonly workspaceRoot: string;
  readonly profileId: string;
  readonly sessionId: string;
  readonly authorityEpoch: number;
}

export interface DriverInventorySnapshotRuntime {
  currentAuthority(): DriverInventorySnapshotAuthority | null;
  isCurrent(authority: DriverInventorySnapshotAuthority): boolean;
  getSnapshot(): {
    readonly phase: string;
    readonly status: string;
    readonly recovery: { readonly phase: string };
  };
}

export interface DriverInventorySnapshotRecord {
  readonly closed: boolean;
  readonly scope: DriverInventorySnapshotScope;
  readonly runtime: DriverInventorySnapshotRuntime;
  readonly driverInventory: DriverInventoryState;
}

/** Read-only slice of the selected-record manager the adapter depends on. */
export interface DriverInventorySnapshotManager {
  selected(): DriverInventorySnapshotRecord | null;
  get(
    scope: DriverInventorySnapshotScope,
  ): DriverInventorySnapshotRecord | null;
}

/**
 * Everything the snapshot getter is built from. The captured view values
 * (`viewRecord` / `viewAuthority` / `viewEpoch`) are the render-time identity of
 * the snapshot; the live accessors (`manager` / `currentAuthorityEpoch` /
 * `pooledClient`) are re-read on every call so a captured identity that is no
 * longer current reads as unavailable.
 */
export interface DriverInventorySnapshotSources {
  /** Captured render-time selected record. */
  readonly viewRecord: DriverInventorySnapshotRecord | null;
  /** Captured render-time authority for `viewRecord` (absent when unselected). */
  readonly viewAuthority: DriverInventorySnapshotAuthority | null | undefined;
  /** Captured render-time authority epoch. */
  readonly viewEpoch: number;
  /** Live manager accessors (selected/get), read on every call. */
  readonly manager: DriverInventorySnapshotManager;
  /** Current auth-epoch accessor (the ref, never a captured copy). */
  readonly currentAuthorityEpoch: () => number;
  /** Pooled-transport client accessor (the shared physical socket). */
  readonly pooledClient: () => unknown;
}

/**
 * Re-gate the CURRENT authority on every read. A record's cached `complete`
 * inventory must NOT survive a capability/transport change (the manager resets
 * only loading/unavailable), so the display layer never trusts an old complete
 * on its own. Sync only: no RPC, no poll, no command factory.
 */
function authorityAdmitsDriverInventory(
  authority: DriverInventorySnapshotAuthority,
): boolean {
  const caps = authority.capabilities;
  if (!caps || !Array.isArray(caps.supported_methods)) return false;
  if (!caps.supported_methods.includes(DRIVER_INVENTORY_METHOD)) return false;
  if (!(caps.supported_features ?? []).includes(DRIVER_INVENTORY_FEATURE))
    return false;
  return typeof authority.client.externalDriverCommands === "function";
}

/**
 * True when the record scope agrees with an authority on every identity fact
 * (sessionId / profileId / cwd↔workspaceRoot / endpoint). Compares real identity
 * facts only — never arbitrary display strings and never object pointers.
 */
function scopeAgreesWithAuthority(
  scope: DriverInventorySnapshotScope,
  authority: DriverInventorySnapshotAuthority,
): boolean {
  return (
    scope.sessionId === authority.sessionId &&
    scope.profileId === authority.profileId &&
    scope.workspaceRoot === authority.cwd &&
    scope.endpoint === authority.config.endpoint
  );
}

/**
 * The fixed captured-identity predicate. It reads only the render-captured owner
 * and refuses to substitute a later selection or a later authority generation;
 * see the module header for the full contract. Always returns the captured
 * record's existing inventory object or the shared frozen unavailable singleton
 * — never a new object, mutation, command factory call or RPC.
 */
function readCapturedDriverInventory(
  sources: DriverInventorySnapshotSources,
): DriverInventoryState {
  const record = sources.viewRecord;
  const capturedAuthority = sources.viewAuthority;
  if (!record || record.closed) return UNAVAILABLE_DRIVER_INVENTORY;
  // Same CURRENT selection AND the retained record at its own scope. A later
  // reselection or a same-scope replacement both fail here, so a getter captured
  // for A can never hand back B's inventory.
  if (sources.manager.selected() !== record)
    return UNAVAILABLE_DRIVER_INVENTORY;
  if (sources.manager.get(record.scope) !== record)
    return UNAVAILABLE_DRIVER_INVENTORY;
  if (!capturedAuthority) return UNAVAILABLE_DRIVER_INVENTORY;
  // Captured-epoch fence: the render epoch must still be the live epoch AND it
  // must match the record's own scope epoch.
  const liveEpoch = sources.currentAuthorityEpoch();
  if (sources.viewEpoch !== liveEpoch) return UNAVAILABLE_DRIVER_INVENTORY;
  if (record.scope.authorityEpoch !== liveEpoch)
    return UNAVAILABLE_DRIVER_INVENTORY;
  // The CAPTURED authority must still be current for the record runtime
  // (generation + physical client), and a CURRENT authority must exist.
  const current = record.runtime.currentAuthority();
  if (current === null) return UNAVAILABLE_DRIVER_INVENTORY;
  if (!record.runtime.isCurrent(capturedAuthority))
    return UNAVAILABLE_DRIVER_INVENTORY;
  // The pooled transport must still be the CURRENT authority's physical client.
  if (sources.pooledClient() !== current.client)
    return UNAVAILABLE_DRIVER_INVENTORY;
  // Scope agreement on captured AND current identity facts.
  if (!scopeAgreesWithAuthority(record.scope, capturedAuthority))
    return UNAVAILABLE_DRIVER_INVENTORY;
  if (!scopeAgreesWithAuthority(record.scope, current))
    return UNAVAILABLE_DRIVER_INVENTORY;
  // Re-gate CURRENT readiness/health, then CURRENT capabilities (never a stale
  // captured capability set).
  const snapshot = record.runtime.getSnapshot();
  if (
    snapshot.phase !== "ready" ||
    snapshot.status !== "connected" ||
    snapshot.recovery.phase !== "healthy"
  )
    return UNAVAILABLE_DRIVER_INVENTORY;
  if (!authorityAdmitsDriverInventory(current))
    return UNAVAILABLE_DRIVER_INVENTORY;
  return record.driverInventory;
}

/**
 * Build the `useSyncExternalStore` getter from the captured render values plus
 * the live accessors. The factory may be recreated every render; the getter it
 * returns always yields the captured record's existing inventory object or the
 * shared frozen unavailable snapshot, so repeated calls keep identity.
 */
export function createDriverInventorySnapshot(
  sources: DriverInventorySnapshotSources,
): () => DriverInventoryState {
  return () => readCapturedDriverInventory(sources);
}
