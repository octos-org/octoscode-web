import {
  CORE_UI_METHODS,
  isRecord,
  parseProjectionEnvelope,
  type ConnectionStatus,
  type RpcNotification,
} from "@octos-org/octoscode-client";
import { terminalTurnId } from "../timeline/model.ts";
import { notificationMatchesSessionScope } from "./scope.ts";

// Core rc.9 has no post-turn quiesced signal, so retained owner sockets cannot
// be evicted safely: even closing a terminal socket may evict a newer turn's
// Session scope. Keep a small, honest live-transport budget. Exact Session
// reclaim makes ordinary A↔B navigation an exchange instead of consuming
// another slot; reaching this bound requires explicit user cleanup.
export const MAX_BACKGROUND_TURN_TRANSPORTS = 8;

export type BackgroundTurnState =
  "running" | "waiting" | "completed" | "failed";

/** Full Session identity inside one endpoint-bound manager instance. */
export interface BackgroundTurnSessionScope {
  workspaceRoot: string;
  profileId: string;
  sessionId: string;
}

export interface BackgroundTurnIdentity extends BackgroundTurnSessionScope {
  turnId: string;
}

export interface BackgroundTurnSnapshot extends BackgroundTurnIdentity {
  state: BackgroundTurnState;
}

/** The transport surface needed to keep one Core foreground turn alive. */
export interface BackgroundTurnClient {
  readonly status: ConnectionStatus;
  disconnect(): void;
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void;
  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void;
}

export interface PrepareBackgroundTurnOptions<
  Client extends BackgroundTurnClient,
> extends BackgroundTurnIdentity {
  client: Client;
  initialState?: BackgroundTurnState;
}

export type BackgroundTurnCommitResult =
  "parked" | "already-owned" | "transport-ended";

/**
 * A two-phase transfer of a foreground turn-owner transport.
 *
 * `prepare()` starts observing the old socket before the candidate Session is
 * opened, so a terminal notification cannot be lost in the prepare/commit
 * window. The manager does not own or disconnect that socket until `commit`:
 * candidate failure must call `rollback`, which only removes the observers.
 */
export interface PreparedBackgroundTurn extends BackgroundTurnIdentity {
  /** Pass this to the active runtime when atomically adopting the candidate. */
  readonly shouldPreserveTransport: boolean;
  commit(): BackgroundTurnCommitResult;
  rollback(): void;
}

export type BackgroundTurnReclaimCommitResult = "reclaimed" | "transport-ended";

/** A reversible checkout of a retained owner for foreground reuse. */
export interface PreparedBackgroundTurnReclaim<
  Client extends BackgroundTurnClient = BackgroundTurnClient,
> extends BackgroundTurnIdentity {
  readonly client: Client;
  /** Read at candidate hydrate time so prepare-window terminals are preserved. */
  snapshot(): BackgroundTurnSnapshot;
  commit(): BackgroundTurnReclaimCommitResult;
  rollback(): void;
}

export class BackgroundTurnLimitError extends Error {
  constructor() {
    super(
      `Octos is already preserving ${MAX_BACKGROUND_TURN_TRANSPORTS} background Session connections so their server-side cleanup is not interrupted. Reopen an existing Session, or explicitly Disconnect and reconnect before opening a new Session.`,
    );
    this.name = "BackgroundTurnLimitError";
  }
}

type OwnerPhase =
  "prepared" | "parked" | "reclaiming" | "rolled-back" | "disposed";

interface BackgroundTurnOwner<Client extends BackgroundTurnClient> {
  readonly key: string;
  readonly client: Client;
  readonly workspaceRoot: string;
  readonly profileId: string;
  readonly sessionId: string;
  readonly turnId: string;
  phase: OwnerPhase;
  state: BackgroundTurnState;
  unsubscribe: Array<() => void>;
  transportEnded: boolean;
}

/**
 * Owns the bounded set of sockets whose server-acknowledged turns continue
 * after another Session becomes the foreground UI authority.
 *
 * A Core terminal event is intentionally *not* a transport-release signal.
 * Core still performs task/goal accounting and other tail work after emitting
 * it, and closing the owner socket at that point can abort that cleanup. The
 * transport remains parked until it closes/errors itself or this manager is
 * explicitly disposed. A future protocol-level quiesced signal can narrow
 * that lifetime without changing this ownership boundary.
 */
export class BackgroundTurnManager<
  Client extends BackgroundTurnClient = BackgroundTurnClient,
> {
  readonly #owners = new Map<string, BackgroundTurnOwner<Client>>();
  readonly #reservations = new Map<string, BackgroundTurnOwner<Client>>();
  readonly #listeners = new Set<() => void>();

  #disposed = false;
  #snapshot: readonly BackgroundTurnSnapshot[] = Object.freeze([]);

  getSnapshot = (): readonly BackgroundTurnSnapshot[] => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  prepare(
    options: PrepareBackgroundTurnOptions<Client>,
  ): PreparedBackgroundTurn {
    this.#assertAvailable();
    assertIdentity(options.workspaceRoot, "Workspace root");
    assertIdentity(options.profileId, "Profile");
    assertIdentity(options.sessionId, "Session");
    assertIdentity(options.turnId, "Turn");

    const key = backgroundTurnIdentityKey(options);
    if (this.#owners.has(key)) {
      return duplicateHandoff(options);
    }
    if (this.#reservations.has(key)) {
      throw new Error("A background turn handoff is already being prepared");
    }
    if (options.client.status !== "connected") {
      throw new Error("Only a connected turn-owner transport can be parked");
    }
    if (
      this.#retainedSlotCount() + this.#reservations.size >=
      MAX_BACKGROUND_TURN_TRANSPORTS
    ) {
      throw new BackgroundTurnLimitError();
    }
    const owner: BackgroundTurnOwner<Client> = {
      key,
      client: options.client,
      workspaceRoot: options.workspaceRoot,
      profileId: options.profileId,
      sessionId: options.sessionId,
      turnId: options.turnId,
      phase: "prepared",
      state: options.initialState ?? "running",
      unsubscribe: [],
      transportEnded: false,
    };
    this.#reservations.set(owner.key, owner);

    try {
      owner.unsubscribe.push(
        owner.client.subscribeNotifications((notification) =>
          this.#observeNotification(owner, notification),
        ),
      );
      owner.unsubscribe.push(
        owner.client.subscribeStatus((status) =>
          this.#observeStatus(owner, status),
        ),
      );
    } catch (reason) {
      this.#rollback(owner);
      throw reason;
    }

    return {
      workspaceRoot: owner.workspaceRoot,
      profileId: owner.profileId,
      sessionId: owner.sessionId,
      turnId: owner.turnId,
      shouldPreserveTransport: true,
      commit: () => this.#commit(owner),
      rollback: () => this.#rollback(owner),
    };
  }

  /**
   * Reserve the newest retained owner for the exact Session scope.
   *
   * A reclaiming owner remains connected and observed, but stops consuming a
   * background slot so the current foreground owner can be parked atomically.
   * Candidate failure must roll this reservation back after rolling back the
   * source handoff.
   */
  prepareReclaim(
    scope: BackgroundTurnSessionScope,
  ): PreparedBackgroundTurnReclaim<Client> | null {
    this.#assertAvailable();
    assertIdentity(scope.workspaceRoot, "Workspace root");
    assertIdentity(scope.profileId, "Profile");
    assertIdentity(scope.sessionId, "Session");
    const scopeKey = backgroundTurnSessionScopeKey(scope);
    const owner = [...this.#owners.values()]
      .reverse()
      .find(
        (candidate) =>
          candidate.phase === "parked" &&
          backgroundTurnSessionScopeKey(candidate) === scopeKey,
      );
    if (!owner) return null;
    if (owner.client.status !== "connected") {
      this.#retire(owner, false);
      return null;
    }
    owner.phase = "reclaiming";
    return {
      client: owner.client,
      workspaceRoot: owner.workspaceRoot,
      profileId: owner.profileId,
      sessionId: owner.sessionId,
      turnId: owner.turnId,
      snapshot: () => ownerSnapshot(owner),
      commit: () => this.#commitReclaim(owner),
      rollback: () => this.#rollbackReclaim(owner),
    };
  }

  /** Update a still-owned exact turn after a foreground interaction resumes. */
  setState(
    identity: BackgroundTurnIdentity,
    state: Extract<BackgroundTurnState, "running" | "waiting">,
  ): boolean {
    const owner = this.#owners.get(backgroundTurnIdentityKey(identity));
    if (
      !owner ||
      owner.phase !== "parked" ||
      isTerminalState(owner.state) ||
      owner.state === state
    ) {
      return false;
    }
    owner.state = state;
    this.#publish();
    return true;
  }

  /**
   * Disconnect retained owners and cancel prepared transfers, while keeping
   * this manager and its subscribers reusable for a later reconnect.
   */
  clear(): void {
    if (this.#disposed) return;
    this.#clearOwners();
  }

  /** Permanently clear this manager and reject any later handoff. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearOwners();
    this.#listeners.clear();
  }

  #clearOwners(): void {
    for (const owner of this.#owners.values()) {
      this.#owners.delete(owner.key);
      owner.phase = "disposed";
      detach(owner);
      safeDisconnect(owner.client);
    }
    // A prepared handoff is not ours to disconnect: until commit it remains
    // the foreground runtime's authority. Invalidate and detach it atomically.
    for (const owner of this.#reservations.values()) {
      this.#rollback(owner);
    }
    this.#publish();
  }

  #commit(owner: BackgroundTurnOwner<Client>): BackgroundTurnCommitResult {
    if (owner.phase !== "prepared") {
      return owner.phase === "parked" ? "parked" : "transport-ended";
    }
    this.#releaseReservation(owner);

    if (this.#disposed || owner.transportEnded) {
      owner.phase = "disposed";
      detach(owner);
      // `commit` means the foreground runtime already preserved this socket
      // for us. If it cannot be retained, this is now our cleanup duty.
      safeDisconnect(owner.client);
      return "transport-ended";
    }

    const existing = this.#owners.get(owner.key);
    if (existing) {
      owner.phase = "disposed";
      detach(owner);
      safeDisconnect(owner.client);
      return "already-owned";
    }

    owner.phase = "parked";
    this.#owners.set(owner.key, owner);
    this.#publish();
    return "parked";
  }

  #rollback(owner: BackgroundTurnOwner<Client>): void {
    if (owner.phase !== "prepared") return;
    owner.phase = "rolled-back";
    this.#releaseReservation(owner);
    detach(owner);
  }

  #commitReclaim(
    owner: BackgroundTurnOwner<Client>,
  ): BackgroundTurnReclaimCommitResult {
    if (
      owner.phase !== "reclaiming" ||
      this.#owners.get(owner.key) !== owner ||
      owner.client.status !== "connected"
    ) {
      if (owner.phase === "reclaiming") this.#retire(owner, false);
      return "transport-ended";
    }
    this.#owners.delete(owner.key);
    owner.phase = "disposed";
    detach(owner);
    this.#publish();
    return "reclaimed";
  }

  #rollbackReclaim(owner: BackgroundTurnOwner<Client>): void {
    if (owner.phase !== "reclaiming") return;
    if (
      this.#owners.get(owner.key) !== owner ||
      owner.client.status !== "connected"
    ) {
      this.#retire(owner, false);
      return;
    }
    owner.phase = "parked";
  }

  #observeNotification(
    owner: BackgroundTurnOwner<Client>,
    notification: RpcNotification,
  ): void {
    if (
      owner.phase !== "prepared" &&
      owner.phase !== "parked" &&
      owner.phase !== "reclaiming"
    ) {
      return;
    }
    if (!notificationMatchesSessionScope(notification, owner.sessionId)) return;

    const terminal = terminalTurnId(notification);
    if (terminal === owner.turnId) {
      const state = terminalState(notification);
      if (owner.state !== state) {
        owner.state = state;
        if (owner.phase === "parked" || owner.phase === "reclaiming") {
          this.#publish();
        }
      }
      return;
    }

    if (
      !isTerminalState(owner.state) &&
      waitingTurnId(notification) === owner.turnId &&
      owner.state !== "waiting"
    ) {
      owner.state = "waiting";
      if (owner.phase === "parked" || owner.phase === "reclaiming") {
        this.#publish();
      }
    }
  }

  #observeStatus(
    owner: BackgroundTurnOwner<Client>,
    status: ConnectionStatus,
  ): void {
    if (status !== "disconnected" && status !== "error") return;
    if (owner.phase === "prepared") {
      owner.transportEnded = true;
      return;
    }
    if (owner.phase === "parked" || owner.phase === "reclaiming") {
      this.#retire(owner, status === "error");
    }
  }

  #retire(owner: BackgroundTurnOwner<Client>, disconnect: boolean): void {
    // Object identity is essential: a delayed callback from an earlier
    // binding must never retire a later owner that reused the exact key.
    if (this.#owners.get(owner.key) !== owner) return;
    this.#owners.delete(owner.key);
    owner.phase = "disposed";
    detach(owner);
    if (disconnect) safeDisconnect(owner.client);
    this.#publish();
  }

  #releaseReservation(owner: BackgroundTurnOwner<Client>): void {
    if (this.#reservations.get(owner.key) === owner) {
      this.#reservations.delete(owner.key);
    }
  }

  #retainedSlotCount(): number {
    let count = 0;
    for (const owner of this.#owners.values()) {
      if (owner.phase === "parked") count += 1;
    }
    return count;
  }

  #publish(): void {
    this.#snapshot = Object.freeze(
      [...this.#owners.values()].map((owner) =>
        Object.freeze({
          workspaceRoot: owner.workspaceRoot,
          profileId: owner.profileId,
          sessionId: owner.sessionId,
          turnId: owner.turnId,
          state: owner.state,
        }),
      ),
    );
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // A projection subscriber cannot roll back transport ownership.
      }
    }
  }

  #assertAvailable(): void {
    if (this.#disposed) {
      throw new Error("The background turn manager has been disposed");
    }
  }
}

function duplicateHandoff(
  identity: BackgroundTurnIdentity,
): PreparedBackgroundTurn {
  return {
    workspaceRoot: identity.workspaceRoot,
    profileId: identity.profileId,
    sessionId: identity.sessionId,
    turnId: identity.turnId,
    shouldPreserveTransport: false,
    commit: () => "already-owned",
    rollback: () => undefined,
  };
}

export function backgroundTurnIdentityKey(
  identity: BackgroundTurnIdentity,
): string {
  return JSON.stringify([
    identity.workspaceRoot,
    identity.profileId,
    identity.sessionId,
    identity.turnId,
  ]);
}

export function backgroundTurnSessionScopeKey(
  scope: BackgroundTurnSessionScope,
): string {
  return JSON.stringify([
    scope.workspaceRoot,
    scope.profileId,
    scope.sessionId,
  ]);
}

function ownerSnapshot<Client extends BackgroundTurnClient>(
  owner: BackgroundTurnOwner<Client>,
): BackgroundTurnSnapshot {
  return {
    workspaceRoot: owner.workspaceRoot,
    profileId: owner.profileId,
    sessionId: owner.sessionId,
    turnId: owner.turnId,
    state: owner.state,
  };
}

function terminalState(notification: RpcNotification): "completed" | "failed" {
  if (notification.method === CORE_UI_METHODS.TURN_ERROR) return "failed";
  if (notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE) {
    return "completed";
  }
  const envelope = parseProjectionEnvelope(notification.params);
  if (!envelope || !isRecord(envelope.payload.data)) return "failed";
  return envelope.payload.data.outcome === "completed" ? "completed" : "failed";
}

function waitingTurnId(notification: RpcNotification): string | null {
  if (
    notification.method !== CORE_UI_METHODS.APPROVAL_REQUESTED &&
    notification.method !== CORE_UI_METHODS.USER_QUESTION_REQUESTED
  ) {
    return null;
  }
  return isRecord(notification.params) &&
    typeof notification.params.turn_id === "string"
    ? notification.params.turn_id
    : null;
}

function isTerminalState(
  state: BackgroundTurnState,
): state is "completed" | "failed" {
  return state === "completed" || state === "failed";
}

function assertIdentity(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} id is required`);
}

function detach<Client extends BackgroundTurnClient>(
  owner: BackgroundTurnOwner<Client>,
): void {
  const unsubscribe = owner.unsubscribe.splice(0);
  for (const listener of unsubscribe) {
    try {
      listener();
    } catch {
      // Listener cleanup must not strand another retained owner.
    }
  }
}

function safeDisconnect(client: BackgroundTurnClient): void {
  try {
    client.disconnect();
  } catch {
    // The manager has already retired its authority; cleanup is best effort.
  }
}
