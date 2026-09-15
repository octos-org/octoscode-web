import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  isRecord,
  parseProjectionEnvelope,
  type SessionHydrateResult,
  type SessionOpened,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { PromptTurnQueue } from "../composer/turn-queue.ts";
import {
  createQueueBackedTurnController,
  type QueueBackedTurnController,
  type TurnControllerDependencies,
} from "../composer/use-turn-controller.ts";
import {
  ActiveSessionRuntime,
  prepareRetainedCandidateSession,
  type ActiveSessionRuntimeEvent,
  type ActiveSessionAuthority,
  type ActiveSessionClient,
} from "./active-session-runtime.ts";
import {
  foldNotification,
  addOptimisticUser,
  terminalTurnId,
  terminalTurnOutcome,
  timelineFromHydrate,
  type TimelineEntry,
} from "../timeline/model.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import {
  SessionInteractionLedger,
  type SessionInteractionClient,
} from "./session-interaction-ledger.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";
import { sessionRuntimeScopeKey } from "./session-scope.ts";
import {
  DRIVER_DISCOVERY_LIMITS,
  raceWithDeadline,
  walkDriverInventoryChain,
  type DriverInventoryDisclosureBinding,
  type DriverInventoryState,
} from "./driver-discovery.ts";
import {
  ExternalDriverProtocolError,
  type ExternalDriverReadCommands,
  type DriverGetOptions,
} from "@octos-org/octoscode-client/external-driver";

const LEGACY_PROJECTION_METHODS = new Set<string>([
  CORE_UI_METHODS.MESSAGE_DELTA,
  CORE_UI_METHODS.MESSAGE_REASONING_DELTA,
  CORE_UI_METHODS.TOOL_STARTED,
  CORE_UI_METHODS.TOOL_PROGRESS,
  CORE_UI_METHODS.TOOL_COMPLETED,
  CORE_UI_METHODS.TURN_COMPLETED,
  CORE_UI_METHODS.TURN_ERROR,
]);

/**
 * Derived, FAIL-CLOSED control-readiness projection for one record (0550
 * audit, widened for COLD start by P2d). `ready` is claimed when the authority's
 * negotiated capabilities advertise BOTH `peer/control` AND
 * `external_driver_v1` AND the driver inventory is KNOWN (a `complete` walk —
 * ANY mode, binding present or absent). Readiness deliberately does NOT require
 * an already-observed EXTERNAL binding: a cold real Core reports `internal`
 * with no binding, so demanding one made the seat unreachable forever. Every
 * other combination — unknown caps, a missing half, an unavailable/loading/
 * failed walk — projects `unavailable`; nothing here grants authority by
 * default, and acquiring it still requires the CAS in `peerControlAcquireInput`.
 */
export { deriveControlReadiness } from "./control-readiness.ts";
export type { SessionControlReadiness } from "./control-readiness.ts";
import { deriveControlReadiness, type SessionControlReadiness } from "./control-readiness.ts";

/**
 * The binding the server OBSERVED for this record, or null when there is none
 * to CAS against (unknown walk, or a COLD `internal` mode with no binding). The
 * seat pairs this with `observedDriverRevision` so an unbound session CASes
 * `expected_revision = 0` instead of never acquiring at all.
 */
export function observedDriverBinding(
  inventory: DriverInventoryState,
): DriverInventoryDisclosureBinding | null {
  if (inventory.kind !== "complete") return null;
  return inventory.disclosure.binding;
}

/**
 * One persistent Session record: a managed runtime (pooled transport), its
 * own live queue + executable turn controller, and its interaction state.
 * Constructed ONCE per Session scope; switching sessions selects a different
 * record, never resets this one.
 */
export interface SessionRecord<Client extends ActiveSessionClient> {
  readonly scope: SessionRuntimeScope;
  readonly runtime: ActiveSessionRuntime<Client>;
  readonly queue: PromptTurnQueue;
  readonly controller: QueueBackedTurnController;
  /** Per-record blocking approvals/questions; resolution re-checks generation. */
  readonly interactions: SessionInteractionLedger;
  /** Selected-record marker; the pool/registry never resets the record. */
  selected: boolean;
  unread: boolean;
  /** Closed peers retain their transcript but cannot resume or accept turns. */
  closed: boolean;
  /**
   * Retained presentation payload: the record's last authoritative hydrate.
   * Used to install the destination's canonical transcript + interactions on
   * selection, even though its hydrate/ready emitted BEFORE it was selected.
   */
  payload: {
    opened: SessionOpened;
    hydrated: SessionHydrateResult;
    capabilities: UiProtocolCapabilities | undefined;
  } | null;
  /**
   * The record's OWN timeline reducer state. Background records fold their
   * optimistic prompts and turn events here; the selected UI only MIRRORS the
   * selected record's timeline. A background A2 must never mutate B's view.
   */
  timeline: TimelineEntry[];
  /**
   * Read-only driver-inventory observation for THIS record. Presentation
   * of server facts only — never execution ownership, scheduling or
   * control authority. Refreshed only by session-ready/ explicit refresh;
   * selection never initiates or resets it.
   */
  driverInventory: DriverInventoryState;
  /**
   * Derived (not owned) control readiness: `ready` when the LIVE authority
   * advertises `peer/control` + `external_driver_v1` AND the driver inventory is
   * KNOWN (`complete`, ANY mode — a cold `internal` walk with no binding still
   * admits); otherwise `unavailable`. Recomputed on read, never cached.
   */
  readonly controlReadiness: SessionControlReadiness;
  /**
   * The binding the server OBSERVED for this record, or null when there is none
   * to CAS against (unknown walk, or a cold `internal` mode with no binding).
   * Presentation ONLY — the seat still acquires through the server's CAS.
   */
  readonly observedDriverBinding: DriverInventoryDisclosureBinding | null;
  /**
   * The observed binding's PUBLIC CAS revision, or null when unbound/unknown —
   * the seat CASes `expected_revision = observedDriverRevision ?? 0`.
   */
  readonly observedDriverRevision: number | null;
  /** Manager-internal refresh token (latest wins; invalidates late work). */
  driverInventoryRefresh: number;
  /**
   * In-flight walk promise for the LATEST token (manager-internal). Walks
   * never reject; resolved state is applied only when the token still wins.
   */
  driverInventoryWalk: Promise<DriverInventoryState> | null;
  /** Manager-internal resolver firing the in-flight walk's cancel signal. */
  driverInventoryCancel: (() => void) | null;
}

/** Recovery decision for one record after the pooled transport reconnects. */
export interface SessionRecordRecoveryResult {
  sessionId: string;
  state: "rehydrated" | "failed";
  hydrated?: SessionHydrateResult;
  error?: string;
}

export interface SessionHistoryMutationLease {
  isCurrent(): boolean;
  release(): void;
}

export interface SessionRecordManagerOptions<
  Client extends ActiveSessionClient,
> {
  /** The pool's CURRENT shared transport for the authenticated scope. */
  pooledClient(): Client | null;
  /** Opaque authority epoch (bumped on endpoint OR auth change). */
  authorityEpoch(): number;
  /** Product callbacks for the SELECTED record only. */
  onSelectedEvent(event: ActiveSessionRuntimeEvent<Client>): void;
  onSelectedSnapshot(): void;
  /** A background record's queue/waiting state changed (republish the list). */
  onBackgroundActivity(): void;
  /** Authority-admitted lifecycle events, including buffered first-open replay. */
  onRecordNotification?(
    record: SessionRecord<Client>,
    authority: import("./active-session-runtime.ts").ActiveSessionAuthority<Client>,
    notification: import("@octos-org/octoscode-client/protocol").RpcNotification,
  ): void;
  /** Session-scoped dependencies for a record's turn controller. */
  controllerDependencies(
    scope: SessionRuntimeScope,
    client: () => Client | null,
  ): Omit<TurnControllerDependencies, "setTimeline">;
  /** The durable cursor for a record's projection (resume marker). */
  cursorFor(
    scope: SessionRuntimeScope,
  ): import("@octos-org/octoscode-client/protocol").UiCursor | undefined;
  validateServerCapabilities(
    capabilities: UiProtocolCapabilities | undefined,
  ): void;
  validateSessionCapabilities(
    capabilities: UiProtocolCapabilities | undefined,
  ): void;
  isFatalSessionError?(reason: unknown): boolean;
}

/**
 * Owns every Session record on one pooled transport. The pool reconnects the
 * socket ONCE; each record's managed runtime re-opens + re-hydrates against
 * it. A record's queue/controller/interactions survive selection changes and
 * reconnects; only an explicit disconnect or auth change retires them.
 */
export class SessionRecordManager<Client extends ActiveSessionClient> {
  readonly #options: SessionRecordManagerOptions<Client>;
  readonly #records = new Map<string, SessionRecord<Client>>();
  readonly #listeners = new Set<() => void>();
  #selectedKey: string | null = null;
  #recoveryEpoch = 0;
  readonly #historyLeases = new Map<
    SessionHistoryMutationLease,
    {
      scope: SessionRuntimeScope;
      record: SessionRecord<Client>;
      workspaceWide: boolean;
    }
  >();

  constructor(options: SessionRecordManagerOptions<Client>) {
    this.#options = options;
  }

  keyOf(scope: SessionRuntimeScope): string {
    return sessionRuntimeScopeKey(scope);
  }

  /**
   * Subscribe to any record activity (selection change, queue churn, terminal,
   * background activity). Used by the React mirror of the selected record's
   * controller state. Returns an unsubscribe.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  get(scope: SessionRuntimeScope): SessionRecord<Client> | null {
    return this.#records.get(sessionRuntimeScopeKey(scope)) ?? null;
  }

  selected(): SessionRecord<Client> | null {
    return this.#selectedKey
      ? (this.#records.get(this.#selectedKey) ?? null)
      : null;
  }

  /**
   * Create (or return) the persistent record for a confirmed scope. The
   * queue/controller/runtime are built ONCE and never rebuilt on reselect.
   */
  ensure(scope: SessionRuntimeScope): SessionRecord<Client> {
    scope = Object.freeze({ ...scope });
    const key = sessionRuntimeScopeKey(scope);
    const existing = this.#records.get(key);
    if (existing) return existing;
    const pooled = this.#options.pooledClient;
    const runtime = new ActiveSessionRuntime<Client>({
      managedTransport: true,
      // Managed mode never creates a client; this is only a typed stub.
      createClient: () => {
        const client = pooled();
        if (!client) throw new Error("The pooled transport is not connected");
        return client;
      },
      validateServerCapabilities: this.#options.validateServerCapabilities,
      validateSessionCapabilities: this.#options.validateSessionCapabilities,
      ...(this.#options.isFatalSessionError
        ? { isFatalSessionError: this.#options.isFatalSessionError }
        : {}),
    });
    const queue = new PromptTurnQueue();
    const dependencies = this.#options.controllerDependencies(
      scope,
      () => this.#records.get(key)?.runtime.currentAuthority()?.client ?? null,
    );
    const ready = () => {
      const authority = runtime.currentAuthority();
      const snapshot = runtime.getSnapshot();
      return (
        !record.closed &&
        this.#options.authorityEpoch() === scope.authorityEpoch &&
        authority?.client === pooled() &&
        authority?.client.status === "connected" &&
        snapshot.phase === "ready" &&
        snapshot.status === "connected"
      );
    };
    const controller = createQueueBackedTurnController({
      dependenciesRef: {
        current: {
          ...dependencies,
          canEnqueue: () =>
            ready() &&
            !this.#historyBlocked(scope) &&
            dependencies.canEnqueue(),
          canStart: () =>
            !this.#historyBlocked(scope) && ready() && dependencies.canStart(),
          canInterrupt: () => ready() && dependencies.canInterrupt(),
          setTimeline: (update) => {
            record.timeline =
              typeof update === "function" ? update(record.timeline) : update;
            this.#recordChanged(record);
          },
        },
      },
      queueRef: { current: queue },
      // Queue churn (enqueue/settle/reconcile) republishes the selected view.
      sync: () => this.#notify(),
      setDispatchingTurnId: () => this.#notify(),
      setInterruptingTurnId: () => this.#notify(),
    });
    const interactions = new SessionInteractionLedger({
      authorityFor: () => {
        const authority = runtime.currentAuthority();
        if (!authority || authority.sessionId !== scope.sessionId) return null;
        return {
          generation: authority.generation,
          client: authority.client as unknown as SessionInteractionClient,
          sessionId: authority.sessionId,
          capabilities: authority.capabilities,
          ready:
            runtime.getSnapshot().phase === "ready" &&
            runtime.getSnapshot().status === "connected",
        };
      },
    });
    // Publish a background record's Waiting state IMMEDIATELY when its ledger
    // changes, so a blocked background Session surfaces without selection.
    interactions.subscribe(() => {
      const waiting = interactions.current(scope);
      controller.setAcceptedOwnerInteraction(Boolean(waiting), waiting?.turnId);
      this.#recordChanged(record);
    });
    const record: SessionRecord<Client> = {
      scope,
      runtime,
      queue,
      controller,
      interactions,
      selected: false,
      unread: false,
      closed: false,
      payload: null,
      timeline: [],
      driverInventory: { kind: "unavailable" },
      get controlReadiness(): SessionControlReadiness {
        return deriveControlReadiness({
          capabilities: runtime.currentAuthority()?.capabilities,
          driverInventory: record.driverInventory,
        });
      },
      get observedDriverBinding(): DriverInventoryDisclosureBinding | null {
        return observedDriverBinding(record.driverInventory);
      },
      get observedDriverRevision(): number | null {
        const binding = observedDriverBinding(record.driverInventory);
        return binding === null ? null : binding.revision;
      },
      driverInventoryRefresh: 0,
      driverInventoryWalk: null,
      driverInventoryCancel: null,
    };
    this.#records.set(key, record);
    let observedAuthority = runtime.currentAuthority();
    runtime.subscribe(() => {
      if (observedAuthority && !runtime.isCurrent(observedAuthority)) {
        controller.suspendTransport();
        interactions.suspendTransport();
      }
      observedAuthority = runtime.currentAuthority();
      const snapshot = runtime.getSnapshot();
      if (snapshot.status !== "connected" && runtime.currentAuthority()) {
        this.suspendRecords();
      }
      this.#notify();
    });
    // ONE unconditional reducer per record: timeline/context, hydrate
    // reconcile, pending interactions, exact terminal outcome and FIFO drain
    // run regardless of selection. The selected record's event is forwarded
    // for presentation AFTER its own reducer has run.
    runtime.subscribeEvents((event) => {
      if (
        "authority" in event &&
        (this.get(record.scope) !== record ||
          record.closed ||
          this.#options.authorityEpoch() !== record.scope.authorityEpoch ||
          this.#options.pooledClient() !== event.authority.client ||
          !runtime.isCurrent(event.authority) ||
          event.authority.sessionId !== record.scope.sessionId ||
          event.authority.profileId !== record.scope.profileId ||
          event.authority.cwd !== record.scope.workspaceRoot ||
          event.authority.config.endpoint !== record.scope.endpoint)
      )
        return;
      this.#reduceRecordEvent(record, event);
      if (
        event.type === "notification" &&
        this.get(record.scope) === record &&
        runtime.isCurrent(event.authority)
      ) {
        this.#options.onRecordNotification?.(
          record,
          event.authority,
          event.notification,
        );
      }
      if (record.selected) this.#options.onSelectedEvent(event);
    });
    return record;
  }

  /**
   * Switch the selected record. The previous record keeps running in the
   * background — no reset, no handoff, no socket close, no queue guard.
   */
  select(scope: SessionRuntimeScope): SessionRecord<Client> {
    const next = this.ensure(scope);
    const key = sessionRuntimeScopeKey(scope);
    this.#selectedKey = key;
    for (const record of this.#records.values()) {
      const was = record.selected;
      record.selected = record === next;
      if (record === next) record.unread = false;
      if (was !== record.selected) {
        this.#options.onSelectedSnapshot();
        this.#notify();
      }
    }
    next.interactions.markRead(scope);
    return next;
  }

  /**
   * Prepare a candidate on the POOLED transport (borrowed, never a new
   * socket) and install it into the DESTINATION record's managed runtime.
   * Failure releases only the staging listeners; the source record's queue
   * and transport are untouched, so a failed candidate cannot interrupt the
   * current Session.
   */
  async openOnRecord(
    config: SessionConnectionInput,
    pooledClient: Client,
    signal: AbortSignal,
    authorizeCommit: () => boolean = () => true,
  ): Promise<SessionRecord<Client>> {
    config = { ...config };
    // Capture the pool's CURRENT socket and authority epoch BEFORE any await.
    // An auth/endpoint change swaps both; a stale result must never install
    // under the new epoch.
    const startEpoch = this.#options.authorityEpoch();
    const startClient = pooledClient;
    if (!startClient || startClient.status !== "connected") {
      throw new Error("The pooled transport is not connected");
    }
    const assertPoolCurrent = () => {
      if (signal.aborted || !authorizeCommit())
        throw new Error("Session opening authority changed");
      if (this.#options.authorityEpoch() !== startEpoch) {
        throw new Error(
          "The authenticated authority changed while the Session was opening",
        );
      }
      const pooled = this.#options.pooledClient();
      if (!pooled || pooled !== startClient || pooled.status !== "connected") {
        throw new Error(
          "The pooled transport changed while the Session was opening",
        );
      }
    };
    assertPoolCurrent();
    const requested = this.get({
      endpoint: config.endpoint,
      workspaceRoot: config.cwd,
      profileId: config.profileId,
      sessionId: config.sessionId,
      authorityEpoch: startEpoch,
    });
    if (requested?.closed) throw new Error("This Session is closed");
    const prepared = await prepareRetainedCandidateSession({
      client: startClient,
      config,
      signal,
      validateOpened: (nextOpened) => {
        this.#options.validateSessionCapabilities(nextOpened.capabilities);
        if (nextOpened.session_id !== config.sessionId) {
          throw new Error("session/open returned another Session id");
        }
        if (
          config.profileId &&
          nextOpened.active_profile_id !== config.profileId
        ) {
          throw new Error("session/open returned another Profile");
        }
        // The confirmed workspace must equal the requested cwd; a session that
        // resolved elsewhere is not the one the user asked to open.
        const confirmedRoot = nextOpened.workspace_root?.trim();
        if (config.cwd && confirmedRoot !== config.cwd.trim()) {
          throw new Error("session/open returned another workspace root");
        }
      },
    });
    // Verify the pool and epoch again after the async prepare, before commit.
    let candidate;
    try {
      assertPoolCurrent();
      candidate = prepared.release();
    } finally {
      prepared.dispose();
    }
    // Confirmed scope comes from session/open (workspace_root +
    // active_profile_id), never sessionId alone. The epoch is the one captured
    // at the START of the open, so an auth change mid-open is rejected above.
    const opened = candidate.opened;
    const scope: SessionRuntimeScope = {
      endpoint: config.endpoint,
      workspaceRoot: opened.workspace_root?.trim() || config.cwd.trim(),
      profileId: opened.active_profile_id?.trim() || config.profileId.trim(),
      sessionId: opened.session_id.trim(),
      authorityEpoch: startEpoch,
    };
    const record = this.ensure(scope);
    if (record.closed) throw new Error("This Session is closed");
    const current = record.runtime.currentAuthority();
    record.runtime.installPreparedSession({
      ...(current ? { expected: current } : {}),
      config,
      candidate,
      // Final synchronous gate: the pool and epoch must STILL be current at
      // the commit boundary.
      authorizeCommit: () => {
        try {
          assertPoolCurrent();
          return true;
        } catch {
          return false;
        }
      },
    });
    return record;
  }

  /**
   * Install a Session the SERVER adopted (a `peer/dispatch` receipt's
   * `adopted_session_id`) as this manager's record.
   *
   * `openOnRecord` cannot do this. It is `session/open`-based and its
   * `validateOpened` asserts the returned id equals the locally REQUESTED
   * staging id, so a server-minted peer id can never pass. Here the ADOPTED id
   * IS the request: the config is built from it, so the open confirms the id
   * the receipt declared rather than a staging key this client invented.
   *
   * The declared scope must name that same adopted Session — a scope naming
   * another Session is refused before any RPC. The confirmed workspace and
   * profile come from the server's open, exactly as `openOnRecord` derives
   * them (the peer workspace is server-REPORTED, disclosed not fenced). A
   * replayed acceptance resolves the SAME record: no second open, hydrate or
   * row. The adopted turn is installed as the record's LIVE turn, never as a
   * queue head, so the ready drain cannot resend a turn Core already started.
   */
  async adoptOnRecord(input: {
    adoptedSessionId: string;
    adoptedTurnId: string;
    scope: SessionRuntimeScope;
  }): Promise<SessionRecord<Client>> {
    const adoptedSessionId = input.adoptedSessionId.trim();
    const declared = input.scope;
    if (!adoptedSessionId) throw new Error("An adopted Session id is required");
    if (declared.sessionId.trim() !== adoptedSessionId) {
      throw new Error(
        "The adopted scope names another Session; refusing to install it",
      );
    }
    const startEpoch = this.#options.authorityEpoch();
    const endpoint = declared.endpoint.trim();
    // IDEMPOTENT: a replayed accepted receipt (or a second delivery of the same
    // adoption) resolves the record already installed for this adopted Session
    // and endpoint on this authority epoch — never a second row or open.
    const existing = this.#recordForAdoptedSession(
      adoptedSessionId,
      endpoint,
      startEpoch,
    );
    if (existing) {
      if (existing.closed) throw new Error("This Session is closed");
      this.#markAdoptedLiveTurn(existing, input.adoptedTurnId);
      return existing;
    }
    const startClient = this.#options.pooledClient();
    if (!startClient || startClient.status !== "connected") {
      throw new Error("The pooled transport is not connected");
    }
    const assertPoolCurrent = () => {
      if (this.#options.authorityEpoch() !== startEpoch) {
        throw new Error(
          "The authenticated authority changed while the adopted Session was opening",
        );
      }
      const pooled = this.#options.pooledClient();
      if (!pooled || pooled !== startClient || pooled.status !== "connected") {
        throw new Error(
          "The pooled transport changed while the adopted Session was opening",
        );
      }
    };
    assertPoolCurrent();
    const abort = new AbortController();
    const config: SessionConnectionInput = {
      endpoint,
      token: "", // credentials never cross the record boundary
      sessionId: adoptedSessionId,
      profileId: declared.profileId.trim(),
      cwd: declared.workspaceRoot.trim(),
    };
    const prepared = await prepareRetainedCandidateSession({
      client: startClient,
      config,
      signal: abort.signal,
      validateOpened: (nextOpened) => {
        this.#options.validateSessionCapabilities(nextOpened.capabilities);
        // NOT the staging-id equality `openOnRecord` enforces: the adopted id
        // is authoritative here. What must hold is that the server opened the
        // very id the receipt adopted.
        if (nextOpened.session_id.trim() !== adoptedSessionId) {
          throw new Error("session/open returned another Session id");
        }
      },
    });
    // Verify the pool and epoch again after the async prepare, before commit.
    let candidate;
    try {
      assertPoolCurrent();
      candidate = prepared.release();
    } finally {
      prepared.dispose();
    }
    // The confirmed scope comes from the server's open (workspace_root +
    // active_profile_id), never the declared fields alone.
    const opened = candidate.opened;
    const scope: SessionRuntimeScope = {
      endpoint,
      workspaceRoot: opened.workspace_root?.trim() || config.cwd,
      profileId: opened.active_profile_id?.trim() || config.profileId,
      sessionId: opened.session_id.trim(),
      authorityEpoch: startEpoch,
    };
    const record = this.ensure(scope);
    if (record.closed) throw new Error("This Session is closed");
    const current = record.runtime.currentAuthority();
    record.runtime.installPreparedSession({
      ...(current ? { expected: current } : {}),
      config,
      candidate,
      // Final synchronous gate: the pool and epoch must STILL be current at
      // the commit boundary.
      authorizeCommit: () => {
        try {
          assertPoolCurrent();
          return true;
        } catch {
          return false;
        }
      },
    });
    this.#markAdoptedLiveTurn(record, input.adoptedTurnId);
    return record;
  }

  /** The record already installed for one adopted Session identity, if any. */
  #recordForAdoptedSession(
    sessionId: string,
    endpoint: string,
    authorityEpoch: number,
  ): SessionRecord<Client> | null {
    for (const record of this.#records.values()) {
      if (
        record.scope.sessionId === sessionId &&
        record.scope.endpoint === endpoint &&
        record.scope.authorityEpoch === authorityEpoch
      )
        return record;
    }
    return null;
  }

  /**
   * Core started the adopted turn BEFORE this client opened its record, so it
   * is recorded as the ACCEPTED owner — the live turn — never as a queue head.
   * The queue therefore stays empty and the ready drain cannot resend a turn
   * the server already owns; the lifecycle still reports one live turn.
   */
  #markAdoptedLiveTurn(
    record: SessionRecord<Client>,
    adoptedTurnId: string,
  ): void {
    if (!record.runtime.currentAuthority()) return;
    if (
      record.controller.restoreTransportOwnership({
        turnId: adoptedTurnId,
        state: "running",
      })
    )
      this.#recordChanged(record);
  }

  /**
   * ONE unconditional reducer per record. Timeline/context folding, hydrate
   * reconcile, pending interactions, exact terminal outcome, and FIFO drain
   * run for the record whether or not it is selected. Only the reducer's
   * Explicit read-only inventory refresh for an existing retained record.
   * Latest-wins: a newer refresh (or session-ready walk) invalidates older
   * in-flight work. Never touches queues, selection or other records.
   */
  async refreshDriverInventory(
    scope: SessionRuntimeScope,
  ): Promise<DriverInventoryState> {
    const record = this.get(scope);
    if (!record || record.closed) {
      return { kind: "error", reason: "stale" } as DriverInventoryState;
    }
    const authority = record.runtime.currentAuthority();
    if (authority === null) {
      return { kind: "error", reason: "stale" } as DriverInventoryState;
    }
    // SAME entry gate as session-ready: a manual refresh can never bypass
    // the capability/method/client-method admission check.
    if (!this.#driverDiscoveryAdmitted(record, authority)) {
      return record.driverInventory;
    }
    return await this.#startDriverInventoryWalk(record, authority);
  }

  /**
   * session-ready gate: BOTH the driver/get method AND external_driver_v1
   * feature advertised by THIS authority's captured capabilities AND the
   * client exposing the optional commands method; otherwise ZERO discovery
   * RPCs and explicit unavailable.
   */
  async #maybeRefreshDriverInventory(
    record: SessionRecord<Client>,
    authority: ActiveSessionAuthority<Client>,
  ): Promise<void> {
    if (!this.#driverDiscoveryAdmitted(record, authority)) return;
    this.#startDriverInventoryWalk(record, authority);
  }

  /** Shared admission gate for session-ready AND manual refresh. */
  #driverDiscoveryAdmitted(
    record: SessionRecord<Client>,
    authority: ActiveSessionAuthority<Client>,
  ): boolean {
    const caps = authority.capabilities;
    const methodAdvertised =
      caps?.supported_methods?.includes("session/driver/get");
    const featureAdvertised =
      caps?.supported_features?.includes("external_driver_v1");
    const clientHasMethod =
      typeof authority.client.externalDriverCommands === "function";
    if (!caps || !methodAdvertised || !featureAdvertised || !clientHasMethod) {
      if (
        record.driverInventory.kind === "loading" ||
        record.driverInventory.kind === "unavailable"
      ) {
        record.driverInventory = { kind: "unavailable" };
        this.#recordChanged(record);
      }
      return false;
    }
    return true;
  }

  /**
   * ONE fenced walk. A SINGLE starting authority is CAPTURED and required
   * via runtime.isCurrent(CAPTURED) for the whole walk — never a re-fetched
   * "current" authority (that would be tautological). Record identity,
   * scope agreement, pooled-client identity and manager authority epoch are
   * fenced too, BEFORE and AFTER every await: the wrapper fences each
   * driverGet, and the walk/load race ONE total deadline. Latest-wins
   * token; late work settles explicitly without clearing a newer view;
   * timers are always cleared; the pooled client is never closed/reset;
   * no unhandled rejections.
   */
  #startDriverInventoryWalk(
    record: SessionRecord<Client>,
    captured: ActiveSessionAuthority<Client>,
  ): Promise<DriverInventoryState> {
    // Latest-wins OWNERSHIP: allocate the token here and expose the walk
    // promise on the record so callers can await settlement. The stored
    // promise never rejects (defensive catch settles a scrubbed unknown
    // failure through the token gate) — no unhandled rejections.
    // Invalidate any PRIOR walk's observation before minting the new one.
    if (record.driverInventoryWalk !== null) {
      this.#cancelDriverInventoryWalk(record);
    }
    const token = record.driverInventoryRefresh + 1;
    record.driverInventoryRefresh = token;
    // Task-owned CANCELLATION SIGNAL: firing it settles every deadline
    // race inside this walk (loader, each page, and the outer walk race)
    // as an immediate timeout — the captured walk promise therefore
    // RESOLVES promptly even when the underlying RPC never settles.
    let fireCancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      fireCancel = resolve;
    });
    record.driverInventoryCancel = fireCancel;
    const walk = this.#doDriverInventoryWalk(
      record,
      captured,
      token,
      cancelled,
    ).catch((): DriverInventoryState =>
      this.#settleWalk(record, token, { kind: "error", reason: "unknown" }),
    );
    record.driverInventoryWalk = walk;
    return walk;
  }

  async #doDriverInventoryWalk(
    record: SessionRecord<Client>,
    captured: ActiveSessionAuthority<Client>,
    token: number,
    cancelled: Promise<void>,
  ): Promise<DriverInventoryState> {
    const pooledAtStart = this.#options.pooledClient();
    const epochAtStart = this.#options.authorityEpoch();
    const stale: DriverInventoryState = { kind: "error", reason: "stale" };
    const unknown: DriverInventoryState = { kind: "error", reason: "unknown" };
    const fence = (): boolean =>
      Boolean(
        !record.closed &&
        captured !== null &&
        this.get(record.scope) === record &&
        record.runtime.isCurrent(captured) &&
        captured.sessionId === record.scope.sessionId &&
        captured.profileId === record.scope.profileId &&
        captured.cwd === record.scope.workspaceRoot &&
        captured.config.endpoint === record.scope.endpoint &&
        captured.client === pooledAtStart &&
        this.#options.pooledClient() === pooledAtStart &&
        pooledAtStart?.status === "connected" &&
        this.#options.authorityEpoch() === epochAtStart &&
        record.scope.authorityEpoch === epochAtStart &&
        record.driverInventoryRefresh === token,
      );
    if (!fence()) return stale;
    // P2m (grant 3310): `loading` means "we have NOTHING to show yet". A refresh
    // of a record whose inventory is ALREADY settled (`complete`) must NOT blank
    // it: `deriveControlReadiness` projects `loading` as `unavailable`, so the
    // console/seat gate (`SessionControlBar.tsx:853/865`) tore the seats DOWN
    // for the duration of the re-walk. Run 15 (:538): Release -> P2i refresh ->
    // readiness dip -> the console UNMOUNTED and its own `useState` staging was
    // destroyed -> the explicit re-acquire restored the SEAT but the staged
    // lane/brief/title were gone, so Dispatch stayed disabled. Keep the LAST
    // KNOWN disclosure visible until the new walk lands; a record that has never
    // settled still goes `loading` (the cold-start contract is unchanged).
    if (record.driverInventory.kind !== "complete") {
      record.driverInventory = { kind: "loading" };
      this.#recordChanged(record);
    }
    const deadline = Date.now() + DRIVER_DISCOVERY_LIMITS.timeoutMs;
    const loader = captured.client.externalDriverCommands;
    if (loader === undefined) return this.#settleWalk(record, token, stale);
    // Receiver-preserving invocation: the dynamic command loader MUST run
    // with the client as `this` — a detached `loader(...)` loses the
    // client's own `this.request` transport and rejects spuriously.
    const loadRace = await raceWithDeadline(
      loader.call(
        captured.client,
        captured.sessionId,
        captured.profileId,
        captured.capabilities as NonNullable<
          ActiveSessionAuthority<Client>["capabilities"]
        >,
      ),
      deadline,
      Date.now,
      cancelled,
    );
    if (!fence()) return this.#settleWalk(record, token, stale);
    if (loadRace.kind === "timeout") {
      return this.#settleWalk(record, token, stale);
    }
    if (loadRace.kind === "rejected") {
      return this.#settleWalk(record, token, unknown);
    }
    const loaded = loadRace.value;
    // Fenced commands wrapper: fence checked BEFORE and AFTER every
    // driverGet the walker awaits. A broken fence throws the client's own
    // typed protocol error, which the walker maps to a chain failure.
    const fenced: ExternalDriverReadCommands = {
      driverGet: async (options?: DriverGetOptions) => {
        if (!fence()) {
          throw new ExternalDriverProtocolError(
            "session/driver/get",
            "record authority changed during discovery",
          );
        }
        // Post-RPC fence even on rejection: a settled failure must not
        // bypass the authority check, and its rejection is consumed by the
        // caller's deadline race (never unhandled).
        try {
          const result = await loaded.driverGet(options);
          if (!fence()) {
            throw new ExternalDriverProtocolError(
              "session/driver/get",
              "record authority changed during discovery",
            );
          }
          return result;
        } catch (error) {
          if (!fence()) {
            throw new ExternalDriverProtocolError(
              "session/driver/get",
              "record authority changed during discovery",
            );
          }
          throw error;
        }
      },
      nextExpectedRevision: loaded.nextExpectedRevision,
    };
    const walkRace = await raceWithDeadline(
      walkDriverInventoryChain(
        fenced,
        Date.now,
        deadline - Date.now(),
        cancelled,
      ),
      deadline,
      Date.now,
      cancelled,
    );
    if (!fence()) return this.#settleWalk(record, token, stale);
    if (walkRace.kind === "timeout") {
      return this.#settleWalk(record, token, stale);
    }
    if (walkRace.kind === "rejected") {
      return this.#settleWalk(record, token, unknown);
    }
    return this.#settleWalk(record, token, walkRace.value);
  }

  /** Apply the walk's outcome ONLY if its token still wins AND the record
   * is still retained with its captured authority current — a numeric
   * token alone is not a lifecycle fence. Clears the stored promise once
   * settled. Never notifies for a retired record. */
  #settleWalk(
    record: SessionRecord<Client>,
    token: number,
    outcome: DriverInventoryState,
  ): DriverInventoryState {
    if (record.driverInventoryRefresh !== token) {
      if (record.driverInventoryWalk !== null) {
        void record.driverInventoryWalk.catch(() => undefined);
      }
      return this.#staleOutcome();
    }
    if (this.get(record.scope) !== record || record.closed) {
      record.driverInventoryWalk = null;
      record.driverInventoryCancel = null;
      return this.#staleOutcome();
    }
    record.driverInventoryWalk = null;
    record.driverInventoryCancel = null;
    record.driverInventory = outcome;
    this.#recordChanged(record);
    return outcome;
  }

  /** CANCEL one record's in-flight driver walk (lifecycle actions and
   * latest-wins replacement): invalidates the token, settles any loading
   * state to stale WITHOUT waiting for the hung RPC, and drops the stored
   * promise. Observation-only — never closes the pooled transport or
   * touches accepted server work or other records. */
  #cancelDriverInventoryWalk(
    record: SessionRecord<Client>,
    outcome: DriverInventoryState = { kind: "error", reason: "stale" },
  ): void {
    record.driverInventoryRefresh += 1; // invalidate outstanding token(s)
    // FIRE the captured walk's cancel signal: its deadline races settle
    // immediately, so the walk promise resolves promptly (stale) without
    // waiting for a hung RPC; its timers are cleared by the races.
    record.driverInventoryCancel?.();
    record.driverInventoryCancel = null;
    if (record.driverInventoryWalk !== null) {
      const walk = record.driverInventoryWalk;
      record.driverInventoryWalk = null;
      void walk.catch(() => undefined); // consume any late rejection
    }
    if (
      record.driverInventory.kind === "loading" &&
      this.get(record.scope) === record
    ) {
      record.driverInventory = outcome;
      if (!record.closed) this.#recordChanged(record);
    }
  }

  #staleOutcome(): DriverInventoryState {
    return { kind: "error", reason: "stale" };
  }

  /**
   * RESULT differs by selection (presentation is forwarded separately).
   */
  #reduceRecordEvent(
    record: SessionRecord<Client>,
    event: ActiveSessionRuntimeEvent<Client>,
  ): void {
    if (event.type === "session-hydrate") {
      // Retain the authoritative presentation payload so selection can install
      // this Session's canonical transcript + interactions even though its
      // hydrate/ready emitted BEFORE it was selected.
      record.payload = {
        opened:
          event.authority.opened ?? (record.payload?.opened as SessionOpened),
        hydrated: event.hydrated,
        capabilities: event.authority.capabilities,
      };
      // The record is the timeline authority: rebuild its transcript from the
      // authoritative hydrate so selection restores the FULL history (not just
      // an optimistic local prompt).
      const previousTimeline = record.timeline;
      // Core stamps user/assistant thread_id with the turn UUID, but hydrate
      // currently omits message.turn_id. Restore that explicit relationship
      // only when the thread matches a known turn; never correlate by prose.
      const turnByThread = new Map<string, string | null>();
      const ownThread = (threadId: string, turnId: string) => {
        turnByThread.set(
          threadId,
          turnByThread.has(threadId) && turnByThread.get(threadId) !== turnId
            ? null
            : turnId,
        );
      };
      for (const turn of event.hydrated.turns ?? [])
        ownThread(turn.thread_id ?? turn.turn_id, turn.turn_id);
      for (const turn of [
        record.queue.snapshot().active,
        ...record.queue.snapshot().pending,
      ]) {
        if (turn) ownThread(turn.turnId, turn.turnId);
      }
      record.timeline = timelineFromHydrate(
        {
          ...event.hydrated,
          messages: (event.hydrated.messages ?? []).map((message) => {
            const turnId =
              message.turn_id ??
              (message.thread_id
                ? turnByThread.get(message.thread_id)
                : undefined);
            return turnId ? { ...message, turn_id: turnId } : message;
          }),
        },
        {
          previous: previousTimeline,
          assistantIdentities: event.assistantIdentities ?? [],
        },
      );
      // A sent-but-unconfirmed prompt may be absent from a racing hydrate.
      // Keep its local presentation without replaying its ambiguous start.
      const active = record.queue.snapshot().active;
      const optimistic =
        active &&
        previousTimeline.find(
          (entry) => entry.kind === "user" && entry.turnId === active.turnId,
        );
      if (
        active &&
        optimistic &&
        !record.timeline.some(
          (entry) => entry.kind === "user" && entry.turnId === active.turnId,
        )
      ) {
        record.timeline = addOptimisticUser(
          record.timeline,
          active.turnId,
          optimistic.body,
        );
      }
      // Restore the record's blocking approvals/questions from the hydrate at
      // the CURRENT authority generation, so a later resolve re-checks the
      // live transport. Clears stale records first.
      record.interactions.restoreFromHydrate(
        record.scope,
        event.authority.generation,
        event.hydrated,
        { background: !record.selected },
      );
      // Hydrate reconciles the queue; ready drains only its never-sent head.
      record.controller.reconcileFromHydrate(
        event.hydrated,
        event.reason === "recovery",
      );
      this.#recordChanged(record);
      return;
    }
    if (event.type === "session-ready") {
      // The ONE controller drain, deferred until the record is actually ready
      // (canStart true). Fires exactly once per hydrate cycle.
      record.controller.resumePendingTurn();
      this.#recordChanged(record);
      // Read-only driver discovery: fired by session-ready only, gated on
      // the ACTUAL captured capabilities of THIS authority. Zero discovery
      // RPCs when the method/feature is absent. No selection involvement.
      void this.#maybeRefreshDriverInventory(record, event.authority);
      return;
    }
    if (event.type !== "notification") return;
    const notification = event.notification;
    const authority = event.authority;
    record.controller.observeSteerDropped(notification);
    if (
      supportsFeature(
        authority.capabilities,
        CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
      ) &&
      LEGACY_PROJECTION_METHODS.has(notification.method)
    )
      return;
    // Pending approvals/questions are recorded synchronously (never via stale
    // React state) so the first interaction is never missed.
    record.interactions.observeNotification(
      record.scope,
      authority.generation,
      notification,
      { background: !record.selected },
    );
    // Fold the live notification into the record's OWN timeline so background
    // activity is preserved and the selected UI mirrors this record.
    record.timeline = foldNotification(record.timeline, notification);
    if (notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE) {
      const envelope = parseProjectionEnvelope(notification.params);
      const data = envelope?.payload.data;
      if (
        envelope?.payload.type === "assistant_persisted" &&
        isRecord(data) &&
        isRecord(data.meta) &&
        typeof data.meta.message_id === "string"
      ) {
        const messageId = data.meta.message_id;
        const persisted = record.timeline.find(
          (entry) => entry.messageId === messageId,
        );
        const transientId = `assistant:${envelope.turn_id}:${String(data.assistant_segment_id ?? "default")}`;
        if (persisted && persisted.id !== transientId) {
          const hydratedReasoning = record.timeline.some(
            (entry) => entry.id === `reasoning:${messageId}`,
          );
          record.timeline = record.timeline.filter(
            (entry) =>
              entry.id !== transientId &&
              !(
                hydratedReasoning &&
                entry.id === `reasoning:${envelope.turn_id}`
              ),
          );
        }
      }
    }
    // Exact terminal outcome drives the record's own FIFO; the next queued
    // turn starts on THIS record even while another Session is selected.
    const terminal = terminalTurnId(notification);
    if (terminal) {
      const outcome = terminalTurnOutcome(notification) ?? "failed";
      record.interactions.settleTurn(record.scope, terminal);
      record.controller.settleTurn(terminal, outcome);
    }
    this.#recordChanged(record);
  }

  #recordChanged(record: SessionRecord<Client>): void {
    if (record.selected) this.#options.onSelectedSnapshot();
    else {
      record.unread = true;
      this.#options.onBackgroundActivity();
    }
    this.#notify();
  }

  #historyScopeMatches(
    source: SessionRuntimeScope,
    target: SessionRuntimeScope,
    workspaceWide: boolean,
  ): boolean {
    return workspaceWide
      ? source.endpoint === target.endpoint &&
          source.authorityEpoch === target.authorityEpoch &&
          source.workspaceRoot === target.workspaceRoot
      : this.keyOf(source) === this.keyOf(target);
  }

  #historyBlocked(scope: SessionRuntimeScope): boolean {
    return [...this.#historyLeases].some(
      ([lease, held]) =>
        lease.isCurrent() &&
        this.#historyScopeMatches(held.scope, scope, held.workspaceWide),
    );
  }

  /** Acquire an idle Session/workspace mutation reservation before its first RPC. */
  acquireHistoryMutation(
    record: SessionRecord<Client>,
    expected: ActiveSessionAuthority<Client>,
    options: { workspaceWide: boolean },
  ): SessionHistoryMutationLease | null {
    const scope = record.scope;
    const owned = () =>
      this.get(scope) === record &&
      !record.closed &&
      record.runtime.isCurrent(expected) &&
      this.#options.authorityEpoch() === scope.authorityEpoch &&
      this.#options.pooledClient() === expected.client &&
      expected.client.status === "connected" &&
      expected.config.endpoint === scope.endpoint &&
      expected.sessionId === scope.sessionId &&
      expected.profileId === scope.profileId &&
      expected.cwd === scope.workspaceRoot;
    if (!owned()) return null;
    const affected = [...this.#records.values()].filter(
      (candidate) =>
        !candidate.closed &&
        this.#historyScopeMatches(
          scope,
          candidate.scope,
          options.workspaceWide,
        ),
    );
    if (
      affected.some((candidate) => {
        const queue = candidate.queue.snapshot();
        const snapshot = candidate.runtime.getSnapshot();
        return (
          queue.active ||
          queue.pending.length > 0 ||
          candidate.interactions.current(candidate.scope) ||
          this.#historyBlocked(candidate.scope) ||
          snapshot.phase !== "ready" ||
          snapshot.status !== "connected"
        );
      })
    )
      return null;
    const lease: SessionHistoryMutationLease = {
      isCurrent: () => this.#historyLeases.has(lease) && owned(),
      release: () => {
        if (this.#historyLeases.delete(lease)) this.#notify();
      },
    };
    this.#historyLeases.set(lease, {
      scope,
      record,
      workspaceWide: options.workspaceWide,
    });
    this.#notify();
    return lease;
  }

  /** Hydrate through the same record reducers after a captured history mutation. */
  async rehydrateRecord(
    record: SessionRecord<Client>,
    expected: ActiveSessionAuthority<Client>,
    lease: SessionHistoryMutationLease,
  ): Promise<void> {
    if (
      this.#historyLeases.get(lease)?.record !== record ||
      !lease.isCurrent() ||
      !record.runtime.isCurrent(expected)
    )
      throw new Error("History mutation authority changed");
    await record.runtime.rehydrateSession(expected, () => lease.isCurrent());
    if (!lease.isCurrent() || record.runtime.getSnapshot().phase !== "ready") {
      throw new Error("History mutation refresh did not become ready");
    }
  }

  /** Freeze all records synchronously at socket loss, before any async reopen. */
  suspendRecords(): void {
    this.#recoveryEpoch += 1;
    this.#historyLeases.clear();
    for (const record of this.#records.values()) {
      this.#cancelDriverInventoryWalk(record);
      record.controller.suspendTransport();
      record.interactions.suspendTransport();
      const authority = record.runtime.currentAuthority();
      if (authority) record.runtime.suspendTransport(authority);
    }
    this.#notify();
  }

  /** Retire every record (explicit disconnect or auth change). */
  retireAll(): void {
    this.#recoveryEpoch += 1;
    this.#historyLeases.clear();
    for (const record of this.#records.values()) {
      this.#cancelDriverInventoryWalk(record);
      record.controller.reset();
      record.interactions.clear();
    }
    for (const record of this.#records.values()) record.runtime.disconnect();
    this.#records.clear();
    this.#selectedKey = null;
  }

  /** Keep a selected closed peer visible without allowing reconnect to revive it. */
  closeRetainedRecord(
    record: SessionRecord<Client>,
    message = "This peer Session is closed.",
  ): boolean {
    if (this.get(record.scope) !== record || record.closed) return false;
    record.closed = true;
    for (const [lease, held] of this.#historyLeases) {
      if (held.record === record) this.#historyLeases.delete(lease);
    }
    this.#cancelDriverInventoryWalk(record);
    record.controller.reset();
    record.interactions.clear();
    record.runtime.disconnect();
    record.runtime.reportError(message);
    this.#recordChanged(record);
    return true;
  }

  /**
   * Remove ONE record (explicit close/delete of that Session). Only this
   * record's runtime is disconnected; every other record and the pooled
   * transport are untouched. Explicit only — a reconnect or switch never evicts.
   */
  evict(scope: SessionRuntimeScope): void {
    const key = sessionRuntimeScopeKey(scope);
    const record = this.#records.get(key);
    if (!record) return;
    for (const [lease, held] of this.#historyLeases) {
      if (held.record === record) this.#historyLeases.delete(lease);
    }
    this.#cancelDriverInventoryWalk(record);
    record.controller.reset();
    record.interactions.clear();
    record.runtime.disconnect();
    this.#records.delete(key);
    if (this.#selectedKey === key) this.#selectedKey = null;
    // Reset/disconnect can notify while the record still exists. Publish the
    // FINAL deletion too, so subscribers do not retain a ghost sidebar record.
    this.#notify();
  }

  /** All records, selected first. */
  records(): ReadonlyArray<SessionRecord<Client>> {
    const all = [...this.#records.values()];
    return all.sort((a, b) => Number(b.selected) - Number(a.selected));
  }

  /**
   * ONE reconnect recovery for every record after the pooled transport
   * reconnects. Each record is suspended (authority leases invalidated),
   * re-opened + re-hydrated on the SAME shared socket, and its controller
   * reconciles the exact accepted turn then drains its unsent FIFO exactly
   * once — never a direct concurrent start loop over the backlog.
   */
  async recoverRecords(
    signal: AbortSignal,
  ): Promise<ReadonlyArray<SessionRecordRecoveryResult>> {
    this.suspendRecords();
    const recoveryEpoch = this.#recoveryEpoch;
    const authorityEpoch = this.#options.authorityEpoch();
    const pooled = this.#options.pooledClient();
    const results: SessionRecordRecoveryResult[] = [];
    for (const record of [...this.#records.values()].filter(
      (record) => !record.closed,
    )) {
      if (!pooled || pooled.status !== "connected") {
        results.push({
          sessionId: record.scope.sessionId,
          state: "failed",
          error: "The pooled transport is not connected",
        });
        continue;
      }
      // Build the resume config from the record's confirmed scope + the durable
      // cursor it held before the socket dropped (so replay resumes, not skips).
      const config: SessionConnectionInput = {
        endpoint: record.scope.endpoint,
        token: "", // credentials never cross the record boundary
        sessionId: record.scope.sessionId,
        profileId: record.scope.profileId,
        cwd: record.scope.workspaceRoot,
      };
      try {
        const isCurrent = () =>
          !signal.aborted &&
          this.#recoveryEpoch === recoveryEpoch &&
          this.#options.authorityEpoch() === authorityEpoch &&
          record.scope.authorityEpoch === authorityEpoch &&
          this.#options.pooledClient() === pooled &&
          pooled.status === "connected" &&
          this.get(record.scope) === record;
        if (!isCurrent()) throw new Error("Session recovery was superseded");
        // Resume replay from the record's durable cursor, never from scratch.
        const resumeCursor = this.#options.cursorFor(record.scope);
        const prepared = await prepareRetainedCandidateSession({
          client: pooled,
          config,
          signal,
          ...(resumeCursor !== undefined ? { after: resumeCursor } : {}),
          validateOpened: (nextOpened) => {
            this.#options.validateSessionCapabilities(nextOpened.capabilities);
            // Validate the FULL requested binding, not just the session id: a
            // wrong-profile or wrong-workspace open must not rebind the record.
            if (nextOpened.session_id !== record.scope.sessionId) {
              throw new Error("session/open returned another Session id");
            }
            if (
              record.scope.profileId &&
              nextOpened.active_profile_id !== record.scope.profileId
            ) {
              throw new Error("session/open returned another Profile");
            }
            if (
              record.scope.workspaceRoot &&
              nextOpened.workspace_root !== record.scope.workspaceRoot
            ) {
              throw new Error("session/open returned another workspace root");
            }
          },
        });
        let candidate;
        try {
          if (!isCurrent()) throw new Error("Session recovery was superseded");
          candidate = prepared.release();
        } finally {
          prepared.dispose();
        }
        // Resume: re-bind the record's runtime to the pooled transport and
        // project the fresh hydrate. The record reducer reconciles the queue
        // against the authoritative hydrate (settling the exact interrupted
        // accepted turn) and drains the unsent FIFO exactly once — deferred to
        // the session-ready event. No manual settle/start here: that would
        // race the reducer and bypass the ready gate. The commit gate re-checks
        // BOTH the authority epoch AND the captured pooled client.
        const resumed = record.runtime.resumePreparedSession({
          config,
          candidate,
          authorizeCommit: isCurrent,
        });
        if (
          !isCurrent() ||
          !record.runtime.isCurrent(resumed) ||
          record.runtime.getSnapshot().phase !== "ready"
        ) {
          throw new Error(
            record.runtime.getSnapshot().error ??
              "Session recovery did not become ready",
          );
        }
        results.push({
          sessionId: record.scope.sessionId,
          state: "rehydrated",
          hydrated: candidate.hydrated,
        });
      } catch (reason) {
        results.push({
          sessionId: record.scope.sessionId,
          state: "failed",
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
    return results;
  }
}
