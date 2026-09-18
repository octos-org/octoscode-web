/**
 * Behavioral contract for the extracted driver-inventory snapshot adapter.
 *
 * These tests exercise the SAME exported `createDriverInventorySnapshot` the
 * real hook wires into `useSyncExternalStore`. They assert the DESIRED final
 * contract (captured identity). Several cases are EXPECTED TO FAIL against the
 * baseline extraction — that is the behavioral RED; the adapter body is not
 * fixed here.
 *
 * Fixture boundary (disclosed): the fixtures are narrow STRUCTURAL doubles for
 * the exact surfaces the predicate reads (authority/scope/runtime/record/manager).
 * The real `ActiveSessionAuthority` / `SessionRecord` / `SessionRecordManager`
 * are structurally assignable to those interfaces, so no cast is used and no
 * whole-fake algorithm is reimplemented. No browser/React renderer is involved.
 */

import { describe, expect, it } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  createDriverInventorySnapshot,
  UNAVAILABLE_DRIVER_INVENTORY,
  type DriverInventorySnapshotAuthority,
  type DriverInventorySnapshotManager,
  type DriverInventorySnapshotRecord,
  type DriverInventorySnapshotRuntime,
  type DriverInventorySnapshotScope,
  type DriverInventorySnapshotSources,
} from "./driver-inventory-snapshot.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";

const METHOD = "session/driver/get";
const FEATURE = "external_driver_v1";

const CAPS: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/open", METHOD, "session/hydrate"],
  supported_notifications: [],
  supported_features: [FEATURE],
};

/** Caps that advertise the feature but NOT the driver method. */
const CAPS_NO_METHOD: UiProtocolCapabilities = {
  ...CAPS,
  supported_methods: ["session/open", "session/hydrate"],
};

/** Caps that advertise the method but NOT the driver feature. */
const CAPS_NO_FEATURE: UiProtocolCapabilities = {
  ...CAPS,
  supported_features: [],
};

function admissionClient(): {
  readonly externalDriverCommands: () => undefined;
} {
  return { externalDriverCommands: () => undefined };
}

function complete(snapshot: string): DriverInventoryState {
  return {
    kind: "complete",
    snapshot,
    observedRevision: "3",
    rows: [{ operationId: "op-1", slug: "peer-pane", lifecycle: "open" }],
    completedAtMs: 1_700_000_000_000,
    disclosure: { mode: "external", recovery: "none", binding: null },
  };
}

function scope(
  sessionId: string,
  authorityEpoch: number,
): DriverInventorySnapshotScope {
  return {
    endpoint: "ws://127.0.0.1:1",
    workspaceRoot: "/srv/project",
    profileId: "coding",
    sessionId,
    authorityEpoch,
  };
}

function authority(
  overrides: Partial<DriverInventorySnapshotAuthority> = {},
): DriverInventorySnapshotAuthority {
  return {
    generation: 1,
    capabilities: CAPS,
    sessionId: "s1",
    profileId: "coding",
    cwd: "/srv/project",
    config: { endpoint: "ws://127.0.0.1:1" },
    client: admissionClient(),
    ...overrides,
  };
}

class FakeRuntime implements DriverInventorySnapshotRuntime {
  authority: DriverInventorySnapshotAuthority | null = null;
  phase = "ready";
  status = "connected";
  health = "healthy";
  currentAuthority(): DriverInventorySnapshotAuthority | null {
    return this.authority;
  }
  isCurrent(target: DriverInventorySnapshotAuthority): boolean {
    const current = this.authority;
    // Mirrors ActiveSessionRuntime.isCurrent: generation + client identity.
    return (
      current !== null &&
      current.generation === target.generation &&
      current.client === target.client
    );
  }
  getSnapshot(): {
    readonly phase: string;
    readonly status: string;
    readonly recovery: { readonly phase: string };
  } {
    return {
      phase: this.phase,
      status: this.status,
      recovery: { phase: this.health },
    };
  }
}

class FakeRecord implements DriverInventorySnapshotRecord {
  closed = false;
  driverInventory: DriverInventoryState = UNAVAILABLE_DRIVER_INVENTORY;
  readonly scope: DriverInventorySnapshotScope;
  readonly runtime: FakeRuntime;
  constructor(scopeValue: DriverInventorySnapshotScope) {
    this.scope = scopeValue;
    this.runtime = new FakeRuntime();
  }
}

class FakeManager implements DriverInventorySnapshotManager {
  selectedValue: DriverInventorySnapshotRecord | null = null;
  readonly records = new Map<string, DriverInventorySnapshotRecord>();
  #key(scopeValue: DriverInventorySnapshotScope): string {
    return [
      scopeValue.endpoint,
      scopeValue.workspaceRoot,
      scopeValue.profileId,
      scopeValue.sessionId,
      String(scopeValue.authorityEpoch),
    ].join("|");
  }
  put(record: DriverInventorySnapshotRecord): void {
    this.records.set(this.#key(record.scope), record);
  }
  remove(record: DriverInventorySnapshotRecord): void {
    this.records.delete(this.#key(record.scope));
  }
  selected(): DriverInventorySnapshotRecord | null {
    return this.selectedValue;
  }
  get(
    scopeValue: DriverInventorySnapshotScope,
  ): DriverInventorySnapshotRecord | null {
    return this.records.get(this.#key(scopeValue)) ?? null;
  }
}

function view(args: {
  manager: FakeManager;
  record: FakeRecord | null;
  authority: DriverInventorySnapshotAuthority | null;
  epoch?: number;
  epochOf?: () => number;
  pooled?: () => unknown;
}): DriverInventorySnapshotSources {
  const epoch = args.epoch ?? args.record?.scope.authorityEpoch ?? 0;
  return {
    viewRecord: args.record,
    viewAuthority: args.authority,
    viewEpoch: epoch,
    manager: args.manager,
    currentAuthorityEpoch: args.epochOf ?? (() => epoch),
    // Default pooled identity is the CAPTURED authority's own client: a strict
    // identity gate must not reject an otherwise healthy positive fixture.
    pooledClient: args.pooled ?? (() => args.authority?.client ?? null),
  };
}

/** A selected, healthy record that admits driver inventory. */
function healthySelected(
  sessionId: string,
  snapshot: string,
): {
  manager: FakeManager;
  record: FakeRecord;
  auth: DriverInventorySnapshotAuthority;
} {
  const manager = new FakeManager();
  const record = new FakeRecord(scope(sessionId, 1));
  const auth = authority({ sessionId });
  record.runtime.authority = auth;
  record.driverInventory = complete(snapshot);
  manager.put(record);
  manager.selectedValue = record;
  return { manager, record, auth };
}

describe("driver-inventory snapshot adapter", () => {
  // ---- Baseline positive (must hold even before the fix) -------------------

  it("returns the selected record's own complete inventory with stable identity", () => {
    const { manager, record, auth } = healthySelected("s1", "snap-a");
    const get = createDriverInventorySnapshot(
      view({ manager, record, authority: auth, epoch: 1 }),
    );
    expect(get()).toBe(record.driverInventory);
    expect(get()).toBe(get());
    expect(get()).toBe(record.driverInventory);
  });

  it("returns the shared frozen unavailable snapshot when nothing is selected", () => {
    const manager = new FakeManager();
    const get = createDriverInventorySnapshot(
      view({ manager, record: null, authority: null }),
    );
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
    expect(Object.isFrozen(get())).toBe(true);
    expect(get()).toBe(get());
  });

  // ---- Captured-identity RED ----------------------------------------------

  it("a getter captured for A never returns a later reselected B", () => {
    const a = healthySelected("s1", "snap-a");
    const getA = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(getA()).toBe(a.record.driverInventory);

    // B becomes healthy and is selected on the SAME manager. A and B share the
    // ONE physical pooled client so the ONLY changed fence is the selection
    // identity, never the transport.
    const bAuth = authority({ sessionId: "s2", client: a.auth.client });
    const bRecord = new FakeRecord(scope("s2", 1));
    bRecord.runtime.authority = bAuth;
    bRecord.driverInventory = complete("snap-b");
    a.manager.put(bRecord);
    a.manager.selectedValue = bRecord;

    // EXPECTED FAIL against baseline: the getter re-resolves selected() and
    // would hand back B's complete inventory.
    expect(getA()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // A fresh capture for the CURRENT selection B is fully valid and succeeds.
    const getB = createDriverInventorySnapshot(
      view({ manager: a.manager, record: bRecord, authority: bAuth, epoch: 1 }),
    );
    expect(getB()).toBe(bRecord.driverInventory);
  });

  it("a getter captured for A goes unavailable after the record adopts A2 authority", () => {
    const a = healthySelected("s1", "snap-a");
    const getA1 = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(getA1()).toBe(a.record.driverInventory);

    // Generation-only change on the SAME physical client: isolates the
    // generation fence from any transport/identity change.
    const a2 = authority({
      generation: 2,
      sessionId: "s1",
      client: a.auth.client,
    });
    a.record.runtime.authority = a2;

    // EXPECTED FAIL against baseline: isCurrent(currentAuthority()) is true by
    // construction, so the stale A1 getter returns the cached complete.
    expect(getA1()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the same generation swaps the physical client", () => {
    const a = healthySelected("s1", "snap-a");
    const getA = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(getA()).toBe(a.record.driverInventory);

    // SAME generation, DIFFERENT physical client: isolates the client identity
    // fence from any generation change.
    a.record.runtime.authority = authority({
      generation: a.auth.generation,
      sessionId: "s1",
      client: admissionClient(),
    });

    // EXPECTED FAIL against baseline: the self-referential isCurrent check never
    // notices the client pointer changed behind the same generation.
    expect(getA()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the captured record is replaced at the same scope", () => {
    const a = healthySelected("s1", "snap-a");
    const getA = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(getA()).toBe(a.record.driverInventory);

    // A new record object occupies the SAME scope key, still on the shared
    // physical client, so the ONLY changed fence is the retained record identity.
    const replacement = new FakeRecord(scope("s1", 1));
    replacement.runtime.authority = authority({
      sessionId: "s1",
      client: a.auth.client,
    });
    replacement.driverInventory = complete("snap-a2");
    a.manager.put(replacement);
    a.manager.selectedValue = replacement;

    // EXPECTED FAIL against baseline: latest selected() is a retained record.
    expect(getA()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the selected record is removed or closed", () => {
    const a = healthySelected("s1", "snap-a");
    const getA = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );

    a.manager.selectedValue = null;
    a.manager.remove(a.record);
    expect(getA()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    a.manager.selectedValue = a.record;
    a.manager.put(a.record);
    a.record.closed = true;
    expect(getA()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the auth epoch no longer matches the record scope", () => {
    const a = healthySelected("s1", "snap-a");
    let epoch = 1;
    const get = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
        epochOf: () => epoch,
      }),
    );
    expect(get()).toBe(a.record.driverInventory);
    epoch = 2;
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the CAPTURED epoch is stale even if scope and current agree", () => {
    const a = healthySelected("s1", "snap-a");
    // scope.authorityEpoch (1) and currentAuthorityEpoch (1) BOTH agree; only the
    // captured render epoch (0) is stale, isolating the captured-epoch fence.
    const stale = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 0,
        epochOf: () => 1,
      }),
    );
    // EXPECTED FAIL against baseline: the baseline never reads the captured
    // viewEpoch, so it returns the cached complete.
    expect(stale()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // Control: the same capture with a CURRENT epoch is valid and holds.
    const fresh = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
        epochOf: () => 1,
      }),
    );
    expect(fresh()).toBe(a.record.driverInventory);
  });

  // ---- Health / capability gates ------------------------------------------

  it("hides a cached complete whenever the runtime is not ready/connected/healthy", () => {
    const a = healthySelected("s1", "snap-a");
    const get = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(get()).toBe(a.record.driverInventory);

    a.record.runtime.status = "disconnected";
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
    a.record.runtime.status = "connected";

    a.record.runtime.phase = "recovering";
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
    a.record.runtime.phase = "ready";

    a.record.runtime.health = "recovery_required";
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
    a.record.runtime.health = "healthy";
    expect(get()).toBe(a.record.driverInventory);
  });

  it("requires the driver method AND feature AND the optional client method", () => {
    const a = healthySelected("s1", "snap-a");

    // Always capture the ACTUAL current authority (and match its pooled client)
    // so each case isolates the capability gate rather than a stale identity.
    const getFor = (current: DriverInventorySnapshotAuthority) =>
      createDriverInventorySnapshot(
        view({
          manager: a.manager,
          record: a.record,
          authority: current,
          epoch: 1,
          pooled: () => current.client,
        }),
      );

    const noMethod = authority({
      sessionId: "s1",
      capabilities: CAPS_NO_METHOD,
    });
    a.record.runtime.authority = noMethod;
    expect(getFor(noMethod)()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    const noFeature = authority({
      sessionId: "s1",
      capabilities: CAPS_NO_FEATURE,
    });
    a.record.runtime.authority = noFeature;
    expect(getFor(noFeature)()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // Advertised caps but the client no longer exposes the read method.
    const noClientMethod = authority({ sessionId: "s1", client: {} });
    a.record.runtime.authority = noClientMethod;
    expect(getFor(noClientMethod)()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // Restored on a FRESH, fully-current authority: valid and must succeed.
    const restored = authority({ sessionId: "s1" });
    a.record.runtime.authority = restored;
    expect(getFor(restored)()).toBe(a.record.driverInventory);
  });

  it("re-gates CURRENT capabilities on the same generation and client after capture", () => {
    const a = healthySelected("s1", "snap-a");
    const get = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
      }),
    );
    expect(get()).toBe(a.record.driverInventory);

    // Same generation, SAME physical client, capabilities withdrawn: the record's
    // cached complete must not survive. isCurrent() compares generation+client,
    // so the gate must re-read the CURRENT authority's capabilities.
    a.record.runtime.authority = authority({
      sessionId: "s1",
      capabilities: CAPS_NO_METHOD,
      client: a.auth.client,
    });
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // Restore on the same generation/client: valid again.
    a.record.runtime.authority = authority({
      sessionId: "s1",
      client: a.auth.client,
    });
    expect(get()).toBe(a.record.driverInventory);
  });

  // ---- Pooled client / scope agreement ------------------------------------

  it("goes unavailable when the pooled client is replaced", () => {
    const a = healthySelected("s1", "snap-a");
    // Start from the captured authority's ACTUAL client, then swap the pool.
    let pooled: unknown = a.auth.client;
    const get = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: a.auth,
        epoch: 1,
        pooled: () => pooled,
      }),
    );
    expect(get()).toBe(a.record.driverInventory);

    pooled = { tag: "pool-2" };
    // EXPECTED FAIL against baseline: the baseline never reads pooledClient().
    expect(get()).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  it("goes unavailable when the record scope disagrees with the authority", () => {
    const a = healthySelected("s1", "snap-a");

    // Each case captures the ACTUAL mismatching current authority and matches its
    // pooled client, so rejection can only come from the scope agreement gate.
    const getFor = (mismatch: DriverInventorySnapshotAuthority) => {
      a.record.runtime.authority = mismatch;
      return createDriverInventorySnapshot(
        view({
          manager: a.manager,
          record: a.record,
          authority: mismatch,
          epoch: 1,
          pooled: () => mismatch.client,
        }),
      );
    };

    // sessionId disagreement.
    expect(
      getFor(authority({ sessionId: "other", client: a.auth.client }))(),
    ).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // profileId disagreement.
    expect(
      getFor(
        authority({
          sessionId: "s1",
          profileId: "other-profile",
          client: a.auth.client,
        }),
      )(),
    ).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // cwd / workspaceRoot disagreement.
    expect(
      getFor(
        authority({
          sessionId: "s1",
          cwd: "/srv/other",
          client: a.auth.client,
        }),
      )(),
    ).toBe(UNAVAILABLE_DRIVER_INVENTORY);

    // endpoint disagreement.
    expect(
      getFor(
        authority({
          sessionId: "s1",
          config: { endpoint: "ws://127.0.0.1:9" },
          client: a.auth.client,
        }),
      )(),
    ).toBe(UNAVAILABLE_DRIVER_INVENTORY);
  });

  // ---- Purity --------------------------------------------------------------

  it("performs no mutation or RPC while reading", () => {
    const a = healthySelected("s1", "snap-a");
    let factoryCalls = 0;
    const current = authority({
      sessionId: "s1",
      client: {
        externalDriverCommands: () => {
          factoryCalls += 1;
          return undefined;
        },
      },
    });
    a.record.runtime.authority = current;
    const before = a.record.driverInventory;
    const get = createDriverInventorySnapshot(
      view({
        manager: a.manager,
        record: a.record,
        authority: current,
        epoch: 1,
        pooled: () => current.client,
      }),
    );
    expect(get()).toBe(a.record.driverInventory);
    expect(get()).toBe(a.record.driverInventory);
    expect(get()).toBe(a.record.driverInventory);
    expect(factoryCalls).toBe(0);
    expect(a.record.driverInventory).toBe(before);
  });
});
