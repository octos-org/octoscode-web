import {
  CORE_UI_METHODS,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateResult,
  type SessionOpened,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import type {
  CandidateSessionClient,
  CandidateSessionSnapshot,
} from "./candidate-session.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import {
  DurableSessionProjection,
  type SessionRecoverySnapshot,
} from "./durable-session.ts";
import { notificationMatchesSessionScope } from "./scope.ts";

const RECOVERY_NOTIFICATION_LIMIT = 4_096;
const HYDRATE_INCLUDE = [
  "messages",
  "threads",
  "turns",
  "pending_approvals",
] as const;

export interface ActiveSessionClient extends CandidateSessionClient {
  readonly status: ConnectionStatus;
  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void;
  subscribeErrors(listener: (error: Error) => void): () => void;
  listConfigCapabilities(): Promise<ConfigCapabilitiesListResult>;
}

export type ActiveSessionRuntimePhase =
  | "idle"
  | "connecting"
  | "authenticated"
  | "ready"
  | "recovering"
  | "reconnect_wait"
  | "reconnecting"
  | "error"
  | "disconnected";

export interface ActiveSessionRuntimeSessionSnapshot {
  opened: SessionOpened;
  sessionId: string;
  profileId: string;
  cwd: string;
  capabilities: UiProtocolCapabilities | undefined;
}

/**
 * Presentation-safe state. Credentials and the mutable transport never enter
 * this snapshot, so React can subscribe without becoming transport authority.
 */
export interface ActiveSessionRuntimeSnapshot {
  phase: ActiveSessionRuntimePhase;
  status: ConnectionStatus;
  error: string | null;
  /** Validated identity survives a transient transport reconnect. */
  authenticated: boolean;
  serverCapabilities: UiProtocolCapabilities | undefined;
  session: ActiveSessionRuntimeSessionSnapshot | null;
  recovery: SessionRecoverySnapshot;
}

/**
 * Synchronous RPC authority for feature controllers. Async consumers capture
 * this handle and call `isCurrent` after awaits rather than comparing several
 * independently mutable refs.
 */
export interface ActiveSessionAuthority<
  Client extends ActiveSessionClient = ActiveSessionClient,
> {
  readonly generation: number;
  readonly client: Client;
  readonly config: Readonly<SessionConnectionInput>;
  readonly sessionId: string;
  readonly profileId: string;
  readonly cwd: string;
  readonly capabilities: UiProtocolCapabilities | undefined;
  readonly opened: SessionOpened | null;
}

export type ActiveSessionHydrateReason = "candidate" | "recovery" | "reconnect";

export type ActiveSessionRuntimeEvent<
  Client extends ActiveSessionClient = ActiveSessionClient,
> =
  | {
      type: "authenticated";
      reason: "connect" | "reconnect";
      authority: ActiveSessionAuthority<Client>;
    }
  | {
      type: "raw-notification";
      notification: RpcNotification;
    }
  | {
      type: "session-hydrate";
      reason: ActiveSessionHydrateReason;
      authority: ActiveSessionAuthority<Client>;
      hydrated: SessionHydrateResult;
    }
  | {
      type: "notification";
      authority: ActiveSessionAuthority<Client>;
      notification: RpcNotification;
    }
  | {
      type: "session-ready";
      reason: ActiveSessionHydrateReason;
      authority: ActiveSessionAuthority<Client>;
    }
  | { type: "session-cleared" };

export interface ActiveSessionRuntimeOptions<
  Client extends ActiveSessionClient,
> {
  createClient(config: SessionConnectionInput): Client;
  validateServerCapabilities(
    capabilities: UiProtocolCapabilities | undefined,
  ): void;
  validateSessionCapabilities(
    capabilities: UiProtocolCapabilities | undefined,
  ): void;
  isFatalSessionError?(reason: unknown): boolean;
  random?: () => number;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface AdoptCandidateOptions<Client extends ActiveSessionClient> {
  expected: ActiveSessionAuthority<Client>;
  config: SessionConnectionInput;
  candidate: CandidateSessionSnapshot<Client>;
}

export class StaleSessionAuthorityError extends Error {
  constructor() {
    super("The active server connection changed before Session commit");
    this.name = "StaleSessionAuthorityError";
  }
}

interface RuntimeTarget {
  kind: "server" | "session";
  config: SessionConnectionInput;
}

interface ClientBinding {
  active: boolean;
  unsubscribe: Array<() => void>;
}

interface BufferedNotification {
  notification: RpcNotification;
  /** The event already caused one authoritative hydrate and is being retried. */
  retriedAfterHydrate: boolean;
}

type NotificationDisposition = "settled" | "recovering" | "terminal";

/**
 * The single authority for one active server transport and its optional
 * durable Session.
 *
 * Launch choice, React state, timelines, approvals and other product features
 * deliberately stay outside. This runtime owns the inseparable transport
 * concerns: client identity, reconnect intent, Session identity, durable
 * cursor integrity, recovery buffering, and atomic candidate adoption.
 */
export class ActiveSessionRuntime<
  Client extends ActiveSessionClient = ActiveSessionClient,
> {
  readonly #options: ActiveSessionRuntimeOptions<Client>;
  readonly #projection = new DurableSessionProjection();
  readonly #snapshotListeners = new Set<() => void>();
  readonly #eventListeners = new Set<
    (event: ActiveSessionRuntimeEvent<Client>) => void
  >();
  readonly #schedule: NonNullable<
    ActiveSessionRuntimeOptions<Client>["schedule"]
  >;
  readonly #cancelSchedule: NonNullable<
    ActiveSessionRuntimeOptions<Client>["cancelSchedule"]
  >;

  #generation = 0;
  #authority: ActiveSessionAuthority<Client> | null = null;
  #binding: ClientBinding | null = null;
  #target: RuntimeTarget | null = null;
  #retryEnabled = false;
  #retryAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #recoveryOperation = 0;
  #recovering = false;
  #recoveryBuffer: BufferedNotification[] = [];
  #identityValidated = false;
  #serverCapabilities: UiProtocolCapabilities | undefined;
  #sessionCapabilities: UiProtocolCapabilities | undefined;
  #opened: SessionOpened | null = null;
  #phase: ActiveSessionRuntimePhase = "idle";
  #status: ConnectionStatus = "idle";
  #error: string | null = null;
  #snapshot: ActiveSessionRuntimeSnapshot;

  constructor(options: ActiveSessionRuntimeOptions<Client>) {
    this.#options = options;
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#cancelSchedule =
      options.cancelSchedule ?? ((handle) => clearTimeout(handle));
    this.#projection.reset("");
    this.#snapshot = this.#buildSnapshot();
  }

  getSnapshot = (): ActiveSessionRuntimeSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  };

  subscribeEvents(
    listener: (event: ActiveSessionRuntimeEvent<Client>) => void,
  ): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  currentAuthority(): ActiveSessionAuthority<Client> | null {
    return this.#authority;
  }

  isCurrent(authority: ActiveSessionAuthority<Client>): boolean {
    return (
      this.#authority?.generation === authority.generation &&
      this.#authority.client === authority.client
    );
  }

  /**
   * Replace the current server identity and authenticate only. Session hints
   * stay outside this reconnect target until a prepared candidate commits.
   */
  async authenticate(
    input: SessionConnectionInput,
  ): Promise<ActiveSessionAuthority<Client> | null> {
    const config = serverOnlyConfig(input);
    this.#cancelReconnect();
    this.#retryEnabled = false;
    this.#retryAttempt = 0;
    this.#target = { kind: "server", config };
    this.#identityValidated = false;
    this.#serverCapabilities = undefined;
    this.#sessionCapabilities = undefined;
    this.#opened = null;
    this.#recovering = false;
    this.#recoveryBuffer = [];
    this.#projection.reset("");
    this.#phase = "connecting";
    this.#status = "idle";
    this.#error = null;
    const authority = this.#replaceTransport(config);
    this.#emit({ type: "session-cleared" });
    this.#publish();

    try {
      await authority.client.connect();
      if (!this.isCurrent(authority)) return null;
      const result = await authority.client.listConfigCapabilities();
      if (!this.isCurrent(authority)) return null;
      this.#options.validateServerCapabilities(result.capabilities);
      this.#serverCapabilities = result.capabilities;
      this.#authority = authorityWith(authority, {
        capabilities: result.capabilities,
      });
      this.#phase = "authenticated";
      this.#status = authority.client.status;
      this.#error = null;
      this.#identityValidated = true;
      this.#retryEnabled = true;
      this.#retryAttempt = 0;
      this.#publish();
      const authenticated = this.#authority;
      this.#emit({
        type: "authenticated",
        reason: "connect",
        authority: authenticated,
      });
      return authenticated;
    } catch (reason) {
      if (!this.isCurrent(authority)) return null;
      this.#failCurrent(reason, false);
      throw reason;
    }
  }

  /**
   * Atomically adopt a fully opened and hydrated candidate. Validation and
   * stale-authority checks happen before the old transport is touched.
   */
  adoptCandidate(
    options: AdoptCandidateOptions<Client>,
  ): ActiveSessionAuthority<Client> {
    if (!this.isCurrent(options.expected)) {
      throw new StaleSessionAuthorityError();
    }
    const { candidate } = options;
    this.#options.validateServerCapabilities(candidate.opened.capabilities);
    this.#options.validateSessionCapabilities(candidate.opened.capabilities);
    if (candidate.hydrated.session_id !== candidate.opened.session_id) {
      throw new Error("session/hydrate returned another session");
    }
    if (candidate.client.status !== "connected") {
      throw new Error("The prepared candidate transport is not connected");
    }
    if (candidate.notifications.length > RECOVERY_NOTIFICATION_LIMIT) {
      throw new Error("The prepared candidate contains too many events");
    }

    const config = committedSessionConfig(options.config, candidate.opened);
    const previous = this.#authority;
    const previousBinding = this.#binding;
    this.#cancelReconnect();

    const next = this.#createAuthority(candidate.client, config, {
      opened: candidate.opened,
      capabilities: candidate.opened.capabilities,
    });
    const nextBinding = this.#bind(next);
    if (candidate.client.status !== "connected") {
      this.#disposeBinding(nextBinding);
      throw new Error("The prepared candidate transport disconnected");
    }

    this.#invalidateRecoveryOperation();
    this.#authority = next;
    this.#binding = nextBinding;
    nextBinding.active = true;
    this.#target = { kind: "session", config };
    this.#retryEnabled = true;
    this.#retryAttempt = 0;
    this.#identityValidated = true;
    this.#serverCapabilities = candidate.opened.capabilities;
    this.#sessionCapabilities = candidate.opened.capabilities;
    this.#opened = candidate.opened;
    this.#status = candidate.client.status;
    this.#error = null;
    this.#projection.reset(candidate.opened.session_id);
    this.#projection.beginHydrate(candidate.opened.session_id);
    this.#projection.commitHydrate(candidate.hydrated);
    this.#recovering = false;
    this.#recoveryBuffer = [];
    this.#phase = "recovering";

    this.#disposeBinding(previousBinding);
    try {
      previous?.client.disconnect();
    } catch {
      // The new authority is already committed; old transport cleanup is best effort.
    }

    this.#publish();
    // The candidate is now the product authority. Clear the previous product
    // projection before exposing this Session's raw diagnostics.
    this.#emit({ type: "session-cleared" });
    for (const notification of candidate.notifications) {
      this.#emit({ type: "raw-notification", notification });
    }
    this.#emit({
      type: "session-hydrate",
      reason: "candidate",
      authority: next,
      hydrated: candidate.hydrated,
    });
    this.#drainCandidateNotifications(candidate.notifications);
    this.#finishRecovery("candidate", next);
    return next;
  }

  /** Set a product-operation error without granting product code transport ownership. */
  reportError(message: string | null): void {
    this.#error = message;
    this.#publish();
  }

  disconnect(): void {
    this.#cancelReconnect();
    this.#retryEnabled = false;
    this.#target = null;
    this.#generation += 1;
    this.#invalidateRecoveryOperation();
    const previous = this.#authority;
    const previousBinding = this.#binding;
    this.#authority = null;
    this.#binding = null;
    this.#serverCapabilities = undefined;
    this.#identityValidated = false;
    this.#sessionCapabilities = undefined;
    this.#opened = null;
    this.#recovering = false;
    this.#recoveryBuffer = [];
    this.#projection.reset("");
    this.#phase = "disconnected";
    this.#status = "disconnected";
    this.#error = null;
    this.#disposeBinding(previousBinding);
    try {
      previous?.client.disconnect();
    } catch {
      // Explicit disconnect is idempotent and best effort.
    }
    this.#publish();
    this.#emit({ type: "session-cleared" });
  }

  dispose(): void {
    this.disconnect();
    this.#snapshotListeners.clear();
    this.#eventListeners.clear();
  }

  #replaceTransport(
    config: SessionConnectionInput,
    session?: {
      opened: SessionOpened;
      capabilities: UiProtocolCapabilities | undefined;
    },
  ): ActiveSessionAuthority<Client> {
    this.#invalidateRecoveryOperation();
    const previous = this.#authority;
    const previousBinding = this.#binding;
    const client = this.#options.createClient(config);
    const authority = this.#createAuthority(client, config, session);
    const binding = this.#bind(authority);
    this.#authority = authority;
    this.#binding = binding;
    binding.active = true;
    this.#disposeBinding(previousBinding);
    try {
      previous?.client.disconnect();
    } catch {
      // A superseded transport cannot prevent the new connection attempt.
    }
    return authority;
  }

  #createAuthority(
    client: Client,
    config: SessionConnectionInput,
    session?: {
      opened: SessionOpened;
      capabilities: UiProtocolCapabilities | undefined;
    },
  ): ActiveSessionAuthority<Client> {
    const normalized = normalizeConfig(config);
    return Object.freeze({
      generation: ++this.#generation,
      client,
      config: Object.freeze({ ...normalized }),
      sessionId: session?.opened.session_id ?? "",
      profileId: session?.opened.active_profile_id ?? normalized.profileId,
      cwd: session?.opened.workspace_root ?? normalized.cwd,
      capabilities: session?.capabilities,
      opened: session?.opened ?? null,
    });
  }

  #bind(authority: ActiveSessionAuthority<Client>): ClientBinding {
    const binding: ClientBinding = { active: false, unsubscribe: [] };
    binding.unsubscribe.push(
      authority.client.subscribeStatus((status) => {
        if (!binding.active || !this.isCurrent(authority)) return;
        this.#status = status;
        if (status === "connecting") {
          this.#phase = this.#retryAttempt > 0 ? "reconnecting" : "connecting";
        }
        if (status === "error") this.#phase = "error";
        this.#publish();
        if (status === "disconnected") this.#scheduleReconnect();
      }),
      authority.client.subscribeErrors((error) => {
        if (!binding.active || !this.isCurrent(authority)) return;
        this.#error = error.message;
        this.#publish();
      }),
      authority.client.subscribeNotifications((notification) => {
        if (!binding.active || !this.isCurrent(authority)) return;
        const current = this.#authority;
        if (!current || !this.isCurrent(current)) return;
        this.#acceptNotification(
          current,
          { notification, retriedAfterHydrate: false },
          true,
        );
      }),
    );
    return binding;
  }

  #disposeBinding(binding: ClientBinding | null): void {
    if (!binding) return;
    binding.active = false;
    for (const unsubscribe of binding.unsubscribe.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Listener cleanup must not compromise the active authority.
      }
    }
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer || !this.#retryEnabled || !this.#target) return;
    this.#invalidateRecoveryOperation();
    const attempt = this.#retryAttempt + 1;
    this.#retryAttempt = attempt;
    const baseDelay = Math.min(500 * 2 ** Math.min(attempt - 1, 4), 5_000);
    const random = clampUnit((this.#options.random ?? Math.random)());
    const delayMs = Math.round(baseDelay * (0.8 + random * 0.4));
    if (this.#target.kind === "session") {
      this.#projection.beginReconnect(attempt);
      this.#recovering = true;
      this.#recoveryBuffer = [];
    } else {
      this.#recovering = false;
      this.#recoveryBuffer = [];
    }
    this.#phase = "reconnect_wait";
    this.#publish();
    const expectedTarget = this.#target;
    this.#reconnectTimer = this.#schedule(() => {
      this.#reconnectTimer = null;
      if (!this.#retryEnabled || this.#target !== expectedTarget) return;
      void this.#reconnect(expectedTarget);
    }, delayMs);
  }

  async #reconnect(target: RuntimeTarget): Promise<void> {
    if (!this.#retryEnabled || this.#target !== target) return;
    const resumeCursor =
      target.kind === "session"
        ? this.#projection.snapshot().cursor
        : undefined;
    this.#phase = "reconnecting";
    this.#error = null;
    const retainedSession =
      target.kind === "session" && this.#opened
        ? {
            opened: this.#opened,
            capabilities: this.#sessionCapabilities,
          }
        : undefined;
    const authority = this.#replaceTransport(target.config, retainedSession);
    this.#publish();
    try {
      await authority.client.connect();
      if (!this.isCurrent(authority)) return;
      if (target.kind === "server") {
        const result = await authority.client.listConfigCapabilities();
        if (!this.isCurrent(authority)) return;
        this.#options.validateServerCapabilities(result.capabilities);
        this.#serverCapabilities = result.capabilities;
        this.#authority = authorityWith(authority, {
          capabilities: result.capabilities,
        });
        this.#phase = "authenticated";
        this.#status = authority.client.status;
        this.#error = null;
        this.#identityValidated = true;
        this.#retryAttempt = 0;
        this.#publish();
        this.#emit({
          type: "authenticated",
          reason: "reconnect",
          authority: this.#authority,
        });
        return;
      }

      const result = await authority.client.openSession({
        session_id: target.config.sessionId,
        ...(target.config.profileId
          ? { profile_id: target.config.profileId }
          : {}),
        ...(target.config.cwd ? { cwd: target.config.cwd } : {}),
        ...(resumeCursor ? { after: resumeCursor } : {}),
      });
      if (!this.isCurrent(authority)) return;
      if (result.opened.session_id !== target.config.sessionId) {
        throw new Error(
          `session/open returned ${result.opened.session_id}, expected ${target.config.sessionId}`,
        );
      }
      this.#options.validateServerCapabilities(result.opened.capabilities);
      this.#options.validateSessionCapabilities(result.opened.capabilities);
      const config = committedSessionConfig(target.config, result.opened);
      this.#target = { kind: "session", config };
      this.#opened = result.opened;
      this.#identityValidated = true;
      this.#serverCapabilities = result.opened.capabilities;
      this.#sessionCapabilities = result.opened.capabilities;
      this.#authority = authorityWith(authority, {
        config,
        opened: result.opened,
        capabilities: result.opened.capabilities,
      });
      await this.#hydrate(this.#authority, "reconnect");
    } catch (reason) {
      if (!this.isCurrent(authority)) return;
      this.#failCurrent(reason, true);
    }
  }

  async #hydrate(
    authority: ActiveSessionAuthority<Client>,
    reason: Exclude<ActiveSessionHydrateReason, "candidate">,
  ): Promise<void> {
    if (!authority.sessionId || !this.isCurrent(authority)) return;
    const operation = ++this.#recoveryOperation;
    this.#recovering = true;
    this.#phase = "recovering";
    this.#projection.beginHydrate(authority.sessionId);
    this.#publish();
    let hydrated: SessionHydrateResult;
    try {
      hydrated = await authority.client.hydrateSession({
        session_id: authority.sessionId,
        include: [...HYDRATE_INCLUDE],
      });
    } catch (reason) {
      if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
      throw reason;
    }
    if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
    this.#projection.commitHydrate(hydrated);
    this.#recovering = false;
    this.#error = null;
    this.#publish();
    this.#emit({
      type: "session-hydrate",
      reason,
      authority,
      hydrated,
    });
    if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
    const buffered = this.#recoveryBuffer;
    this.#recoveryBuffer = [];
    const disposition = this.#drainNotifications(authority, buffered);
    if (
      disposition === "settled" &&
      this.#isRecoveryOperationCurrent(authority, operation)
    ) {
      this.#finishRecovery(reason, authority);
    }
  }

  #finishRecovery(
    reason: ActiveSessionHydrateReason,
    authority: ActiveSessionAuthority<Client>,
  ): void {
    if (!this.isCurrent(authority) || this.#recovering) return;
    if (authority.client.status !== "connected") {
      this.#failCurrent(
        new Error("The Session transport disconnected during recovery"),
        true,
      );
      return;
    }
    this.#phase = "ready";
    this.#status = authority.client.status;
    this.#retryAttempt = 0;
    this.#publish();
    this.#emit({ type: "session-ready", reason, authority });
  }

  #drainCandidateNotifications(
    notifications: readonly RpcNotification[],
  ): void {
    const authority = this.#authority;
    if (!authority) return;
    this.#drainNotifications(
      authority,
      notifications.map((notification) => ({
        notification,
        retriedAfterHydrate: false,
      })),
    );
  }

  #drainNotifications(
    authority: ActiveSessionAuthority<Client>,
    notifications: readonly BufferedNotification[],
  ): NotificationDisposition {
    for (let index = 0; index < notifications.length; index += 1) {
      const entry = notifications[index];
      if (!entry) continue;
      const disposition = this.#acceptNotification(authority, entry, false);
      if (disposition === "terminal") return disposition;
      if (disposition === "recovering") {
        for (const remainder of notifications.slice(index + 1)) {
          if (!this.#enqueueRecovery(authority, remainder)) return "terminal";
        }
        return "recovering";
      }
    }
    return "settled";
  }

  #acceptNotification(
    authority: ActiveSessionAuthority<Client>,
    entry: BufferedNotification,
    raw: boolean,
  ): NotificationDisposition {
    if (!this.isCurrent(authority)) return "terminal";
    const { notification } = entry;
    if (raw) this.#emit({ type: "raw-notification", notification });
    if (this.#recovering) {
      return this.#enqueueRecovery(authority, entry)
        ? "recovering"
        : "terminal";
    }

    const decision = this.#projection.observe(notification);
    this.#publish();
    if (decision.kind === "recover") {
      if (entry.retriedAfterHydrate) {
        this.#failCurrent(
          new Error(
            `Recovery could not reconcile a durable event: ${decision.reason}`,
          ),
          true,
        );
        return "terminal";
      }
      this.#recovering = true;
      this.#phase = "recovering";
      this.#recoveryBuffer =
        notification.method === CORE_UI_METHODS.REPLAY_LOSSY
          ? []
          : [{ notification, retriedAfterHydrate: true }];
      this.#publish();
      void this.#hydrate(authority, "recovery").catch((reason: unknown) => {
        if (!this.isCurrent(authority)) return;
        this.#failCurrent(reason, true);
      });
      return "recovering";
    }
    if (
      notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE &&
      decision.kind !== "apply"
    ) {
      return "settled";
    }
    if (
      notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE &&
      !notificationMatchesSessionScope(notification, authority.sessionId)
    ) {
      return "settled";
    }
    this.#emit({ type: "notification", authority, notification });
    return "settled";
  }

  #enqueueRecovery(
    authority: ActiveSessionAuthority<Client>,
    entry: BufferedNotification,
  ): boolean {
    if (!this.isCurrent(authority) || !this.#recovering) return false;
    if (this.#recoveryBuffer.length >= RECOVERY_NOTIFICATION_LIMIT) {
      this.#overflowRecovery(authority);
      return false;
    }
    this.#recoveryBuffer.push(entry);
    return true;
  }

  #overflowRecovery(authority: ActiveSessionAuthority<Client>): void {
    if (!this.isCurrent(authority)) return;
    const message =
      "Recovery buffer exceeded 4096 events; reconnecting from the last durable cursor";
    this.#invalidateRecoveryOperation();
    this.#recovering = false;
    this.#recoveryBuffer = [];
    this.#projection.fail(message);
    this.#phase = "error";
    this.#error = message;
    this.#publish();
    try {
      authority.client.disconnect();
    } finally {
      this.#scheduleReconnect();
    }
  }

  #failCurrent(reason: unknown, reconnect: boolean): void {
    const authority = this.#authority;
    if (!authority) return;
    this.#invalidateRecoveryOperation();
    const message = errorMessage(reason);
    const fatal = this.#options.isFatalSessionError?.(reason) ?? false;
    if (fatal) {
      this.#retryEnabled = false;
      this.#identityValidated = false;
    }
    this.#recovering = false;
    this.#recoveryBuffer = [];
    if (authority.sessionId) this.#projection.fail(message);
    this.#phase = "error";
    this.#error = message;
    this.#status = authority.client.status;
    this.#publish();
    try {
      authority.client.disconnect();
    } finally {
      if (reconnect && !fatal) this.#scheduleReconnect();
    }
  }

  #invalidateRecoveryOperation(): void {
    this.#recoveryOperation += 1;
  }

  #isRecoveryOperationCurrent(
    authority: ActiveSessionAuthority<Client>,
    operation: number,
  ): boolean {
    return this.isCurrent(authority) && this.#recoveryOperation === operation;
  }

  #cancelReconnect(): void {
    if (this.#reconnectTimer) {
      this.#cancelSchedule(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #buildSnapshot(): ActiveSessionRuntimeSnapshot {
    const authority = this.#authority;
    const capabilities = this.#sessionCapabilities;
    return {
      phase: this.#phase,
      status: this.#status,
      error: this.#error,
      authenticated: this.#identityValidated,
      serverCapabilities: this.#serverCapabilities,
      session:
        authority && this.#opened
          ? {
              opened: this.#opened,
              sessionId: authority.sessionId,
              profileId: authority.profileId,
              cwd: authority.cwd,
              capabilities,
            }
          : null,
      recovery: this.#projection.snapshot(),
    };
  }

  #publish(): void {
    this.#snapshot = this.#buildSnapshot();
    for (const listener of this.#snapshotListeners) listener();
  }

  #emit(event: ActiveSessionRuntimeEvent<Client>): void {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // A product projection observer cannot roll back transport authority.
      }
    }
  }
}

function authorityWith<Client extends ActiveSessionClient>(
  authority: ActiveSessionAuthority<Client>,
  patch: {
    config?: SessionConnectionInput;
    opened?: SessionOpened;
    capabilities?: UiProtocolCapabilities | undefined;
  },
): ActiveSessionAuthority<Client> {
  const config = normalizeConfig(patch.config ?? authority.config);
  const opened = patch.opened ?? authority.opened;
  return Object.freeze({
    ...authority,
    config: Object.freeze({ ...config }),
    sessionId: opened?.session_id ?? authority.sessionId,
    profileId:
      opened?.active_profile_id ?? config.profileId ?? authority.profileId,
    cwd: opened?.workspace_root ?? config.cwd ?? authority.cwd,
    capabilities: patch.capabilities ?? authority.capabilities,
    opened,
  });
}

function serverOnlyConfig(
  input: SessionConnectionInput,
): SessionConnectionInput {
  const normalized = normalizeConfig(input);
  return {
    ...normalized,
    sessionId: "",
    profileId: "",
    cwd: "",
  };
}

function committedSessionConfig(
  input: SessionConnectionInput,
  opened: SessionOpened,
): SessionConnectionInput {
  const normalized = normalizeConfig(input);
  return {
    ...normalized,
    sessionId: opened.session_id,
    profileId: opened.active_profile_id ?? normalized.profileId,
    cwd: opened.workspace_root ?? normalized.cwd,
  };
}

function normalizeConfig(
  input: Readonly<SessionConnectionInput>,
): SessionConnectionInput {
  return {
    endpoint: input.endpoint.trim(),
    token: input.token,
    sessionId: input.sessionId.trim(),
    profileId: input.profileId.trim(),
    cwd: input.cwd.trim(),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
