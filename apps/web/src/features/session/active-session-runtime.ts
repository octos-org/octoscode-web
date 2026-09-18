import {
  CORE_UI_METHODS,
  CORE_UI_FEATURES,
  supportsFeature,
  isRecord,
  parseProjectionEnvelope,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateResult,
  type SessionOpened,
  type UiCursor,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  CandidateSessionClient,
  CandidateSessionSnapshot,
  PreparedCandidateSession,
} from "./candidate-session.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import {
  DurableSessionProjection,
  type SessionRecoverySnapshot,
} from "./durable-session.ts";
import { notificationMatchesSessionScope } from "./scope.ts";
import type { HydratedAssistantIdentity } from "../timeline/model.ts";

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
  /**
   * OPTIONAL read-only external-driver commands (B discovery). Clients
   * without the negotiated capability simply omit the method; the record
   * manager treats its absence as explicit unavailable — never a cast.
   */
  externalDriverCommands?(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    topic?: string,
  ): Promise<
    import("@octos-org/octoscode-client/external-driver").ExternalDriverReadCommands
  >;
}

export interface PrepareRetainedCandidateSessionOptions<
  Client extends ActiveSessionClient,
> {
  client: Client;
  config: SessionConnectionInput;
  signal: AbortSignal;
  /** Durable cursor to resume replay from (reconnect recovery), if any. */
  after?: UiCursor;
  validateOpened(opened: SessionOpened): void;
  prepareHydrate?: (hydrated: SessionHydrateResult) => Promise<void>;
}

/**
 * Re-open and hydrate an already-connected parked owner without taking its
 * cleanup authority. Failure only removes the staging listener; the background
 * manager can then roll the reclaim reservation back safely.
 */
export async function prepareRetainedCandidateSession<
  Client extends ActiveSessionClient,
>(
  options: PrepareRetainedCandidateSessionOptions<Client>,
): Promise<PreparedCandidateSession<Client>> {
  const { client, config, signal } = options;
  const notifications: RpcNotification[] = [];
  const terminalListeners = new Set<(error: Error) => void>();
  let state: "preparing" | "prepared" | "released" | "disposed" = "preparing";
  let terminalError: Error | null = null;
  let unsubscribe: (() => void) | null = null;

  const detach = () => {
    const listener = unsubscribe;
    unsubscribe = null;
    listener?.();
    signal.removeEventListener("abort", abort);
  };
  const fail = (error: Error) => {
    terminalError ??= error;
    if (state === "released" || state === "disposed") return;
    state = "disposed";
    for (const listener of terminalListeners) listener(terminalError);
    terminalListeners.clear();
    detach();
  };
  function abort() {
    fail(new Error("Retained candidate opening was cancelled"));
  }
  const assertPreparing = () => {
    if (terminalError) throw terminalError;
    if (signal.aborted) abort();
    if (client.status !== "connected") {
      fail(new Error("The retained owner transport disconnected"));
    }
    if (terminalError) throw terminalError;
  };
  const waitForStage = <Value>(operation: Promise<Value>): Promise<Value> => {
    assertPreparing();
    return new Promise<Value>((resolve, reject) => {
      let settled = false;
      const failStage = (error: Error) => {
        if (settled) return;
        settled = true;
        terminalListeners.delete(failStage);
        reject(error);
      };
      terminalListeners.add(failStage);
      operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          terminalListeners.delete(failStage);
          resolve(value);
        },
        (reason: unknown) => {
          if (settled) return;
          settled = true;
          terminalListeners.delete(failStage);
          reject(reason);
        },
      );
    });
  };

  try {
    signal.addEventListener("abort", abort, { once: true });
    unsubscribe = client.subscribeNotifications((notification) => {
      // Filter to THIS Session's scope BEFORE buffering: on a pooled transport
      // every Session's traffic flows past, so foreign events must never
      // consume this record's bound or be able to overflow it.
      if (!notificationMatchesSessionScope(notification, config.sessionId)) {
        return;
      }
      if (notifications.length >= RECOVERY_NOTIFICATION_LIMIT) {
        fail(
          new Error(
            "The retained candidate emitted too many events while opening.",
          ),
        );
        return;
      }
      notifications.push(notification);
    });
    assertPreparing();
    const result = await waitForStage(
      client.openSession({
        session_id: config.sessionId,
        ...(config.profileId ? { profile_id: config.profileId } : {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(options.after ? { after: options.after } : {}),
      }),
    );
    assertPreparing();
    options.validateOpened(result.opened);
    assertPreparing();
    const hydrated = await waitForStage(
      client.hydrateSession({
        session_id: result.opened.session_id,
        include: [...HYDRATE_INCLUDE],
      }),
    );
    assertPreparing();
    if (hydrated.session_id !== result.opened.session_id) {
      throw new Error("session/hydrate returned another session");
    }
    if (options.prepareHydrate) {
      await waitForStage(options.prepareHydrate(hydrated));
      assertPreparing();
    }
    state = "prepared";
    return {
      release() {
        if (state !== "prepared") {
          throw (
            terminalError ?? new Error("Retained candidate is not prepared")
          );
        }
        assertPreparing();
        state = "released";
        detach();
        return {
          client,
          opened: result.opened,
          hydrated,
          notifications: [...notifications],
        };
      },
      dispose() {
        if (state === "released" || state === "disposed") return;
        state = "disposed";
        detach();
      },
    };
  } catch (reason) {
    const error = terminalError ?? errorFrom(reason);
    fail(error);
    throw error;
  }
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
export interface ActiveSessionDiagnostic {
  at: string;
  kind:
    "connected" | "hydrated" | "recovered" | "reconnect-scheduled" | "failed";
  detail?: string | undefined;
}

export interface ActiveSessionRuntimeSnapshot {
  phase: ActiveSessionRuntimePhase;
  status: ConnectionStatus;
  error: string | null;
  /** Validated identity survives a transient transport reconnect. */
  authenticated: boolean;
  serverCapabilities: UiProtocolCapabilities | undefined;
  session: ActiveSessionRuntimeSessionSnapshot | null;
  recovery: SessionRecoverySnapshot;
  /** Newest-last ring of significant lifecycle events (copy-diagnostics). */
  diagnostics: readonly ActiveSessionDiagnostic[];
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
      /** Covered receipts contribute identity only, never replacement prose. */
      assistantIdentities?: readonly HydratedAssistantIdentity[];
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
  | { type: "session-cleared"; reason: "select" | "resume" | "disconnect" };

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
  /** Complete optional projection preparation inside the hydrate transaction. */
  prepareHydrate?: (hydrated: SessionHydrateResult) => Promise<void>;
  random?: () => number;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
  /**
   * Managed-transport mode: this runtime does NOT own the physical socket.
   * A transport pool (one connection per authenticated profile scope) owns
   * create/close/retry; this runtime only installs, suspends, and resumes its
   * logical Session binding on that shared socket. Session errors cannot kill
   * other Sessions because this runtime never disconnects the pooled socket.
   */
  managedTransport?: boolean;
}

export interface AdoptCandidateOptions<Client extends ActiveSessionClient> {
  expected: ActiveSessionAuthority<Client>;
  config: SessionConnectionInput;
  candidate: CandidateSessionSnapshot<Client>;
  /**
   * Transfer cleanup of the previous transport to a background-turn owner.
   *
   * Core aborts foreground work when the WebSocket that started it closes.
   * The caller may therefore keep that exact socket alive while another
   * Session becomes the foreground product authority. The old binding is
   * still retired here, so it can no longer publish into the new Session.
   */
  preservePreviousTransport?: boolean;
  /** Final synchronous authorization immediately before authority mutation. */
  authorizeCommit?: () => boolean;
}

export class StaleSessionAuthorityError extends Error {
  constructor() {
    super("The active server connection changed before Session commit");
    this.name = "StaleSessionAuthorityError";
  }
}

/**
 * Hydrate landed on a different session than the one this runtime opened —
 * a server routing fault. Inherently fatal: retrying would loop forever and
 * the mismatch must reach the user (issue #13 / audit M2).
 */
export class HydrateSessionMismatchError extends Error {
  constructor(returnedSessionId: string, expectedSessionId: string) {
    super(
      `session/hydrate returned session ${returnedSessionId}, expected ${expectedSessionId}`,
    );
    this.name = "HydrateSessionMismatchError";
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
  /** Covered receipt advances ordering but has no ordinary projection effects. */
  identityOnly?: boolean;
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
  #diagnostics: ActiveSessionDiagnostic[] = [];
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
    this.#emit({ type: "session-cleared", reason: "select" });
    this.#publish();

    try {
      await authority.client.connect();
      if (!this.isCurrent(authority)) return null;
      const result = await authority.client.listConfigCapabilities();
      if (!this.isCurrent(authority)) return null;
      assertConnected(authority.client);
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
    const previous = this.#authority;
    const previousBinding = this.#binding;
    const next = this.#commitCandidate(
      options.config,
      options.candidate,
      options.authorizeCommit
        ? { authorizeCommit: options.authorizeCommit }
        : {},
    );

    this.#disposeBinding(previousBinding);
    if (!options.preservePreviousTransport) {
      try {
        previous?.client.disconnect();
      } catch {
        // The new authority is already committed; old transport cleanup is best effort.
      }
    }

    this.#emitCandidateProjection(next, options.candidate, "select");
    return next;
  }

  /**
   * Adopt a candidate into an EMPTY runtime (first install). There is no
   * previous authority to validate or clean up; the shared validation and
   * commit logic runs and the candidate's hydrate is projected.
   */
  #adoptFirst(
    config: SessionConnectionInput,
    candidate: CandidateSessionSnapshot<Client>,
    authorizeCommit?: () => boolean,
  ): ActiveSessionAuthority<Client> {
    // authorizeCommit runs BEFORE any side effects — a rejected first install
    // must not bind or project the candidate.
    if (authorizeCommit && !authorizeCommit()) {
      throw new StaleSessionAuthorityError();
    }
    const next = this.#commitCandidate(
      config,
      candidate,
      authorizeCommit ? { authorizeCommit } : {},
    );
    this.#emitCandidateProjection(next, candidate, "resume");
    return next;
  }

  /** Validate + bind + commit a candidate as this runtime's authority. */
  #commitCandidate(
    inputConfig: SessionConnectionInput,
    candidate: CandidateSessionSnapshot<Client>,
    options: { authorizeCommit?: () => boolean },
  ): ActiveSessionAuthority<Client> {
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

    const config = committedSessionConfig(inputConfig, candidate.opened);
    this.#cancelReconnect();

    const next = this.#createAuthority(candidate.client, config, {
      opened: candidate.opened,
      capabilities: candidate.opened.capabilities,
    });
    const nextBinding = this.#bind(next);
    if (options.authorizeCommit && !options.authorizeCommit()) {
      this.#disposeBinding(nextBinding);
      throw new StaleSessionAuthorityError();
    }

    this.#invalidateRecoveryOperation();
    this.#authority = next;
    this.#binding = nextBinding;
    nextBinding.active = true;
    this.#target = { kind: "session", config };
    this.#retryEnabled = !this.#managed;
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
    return next;
  }

  /** Emit the cleared→hydrate→notifications→ready projection for a commit. */
  #emitCandidateProjection(
    next: ActiveSessionAuthority<Client>,
    candidate: CandidateSessionSnapshot<Client>,
    clearedReason: "select" | "resume",
  ): void {
    this.#publish();
    // The candidate is now the product authority. On "select" the previous
    // product projection is cleared; on "resume" (reconnect recovery) the
    // record's queue is preserved — the hook distinguishes presentation
    // replacement from a queue reset via this reason.
    this.#emit({ type: "session-cleared", reason: clearedReason });
    for (const notification of candidate.notifications) {
      this.#emit({ type: "raw-notification", notification });
    }
    if (!this.isCurrent(next)) return;
    const covered = hydrateAssistantIdentities(
      next,
      candidate.hydrated,
      candidate.notifications,
    );
    this.#emit({
      type: "session-hydrate",
      reason: "candidate",
      authority: next,
      hydrated: candidate.hydrated,
      assistantIdentities: covered.identities,
    });
    if (!this.isCurrent(next)) return;
    this.#drainCandidateNotifications(
      candidate.notifications,
      covered.receipts,
    );
    this.#finishRecovery("candidate", next);
  }

  /** Set a product-operation error without granting product code transport ownership. */
  reportError(message: string | null): void {
    this.#error = message;
    this.#publish();
  }

  /** Refresh an existing record without replacing its transport or selection. */
  async rehydrateSession(
    expected: ActiveSessionAuthority<Client>,
    authorizeCommit: () => boolean,
  ): Promise<void> {
    if (!this.isCurrent(expected) || !authorizeCommit())
      throw new StaleSessionAuthorityError();
    try {
      await this.#hydrate(expected, "recovery", authorizeCommit);
      if (!this.isCurrent(expected) || !authorizeCommit())
        throw new StaleSessionAuthorityError();
    } catch (reason) {
      if (this.isCurrent(expected)) {
        // A history mutation may already be committed. Keep its notification
        // binding so the retained lease can retry only this hydrate, without
        // silently becoming a ready record that no longer observes events.
        this.#invalidateRecoveryOperation();
        this.#recovering = false;
        this.#recoveryBuffer = [];
        this.#error = errorMessage(reason);
        this.#phase = "error";
        this.#projection.fail(this.#error);
        this.#publish();
      }
      throw reason;
    }
  }

  get #managed(): boolean {
    return this.#options.managedTransport === true;
  }

  /**
   * Install a fully prepared candidate as this record's authority. Managed
   * mode ONLY: the shared pooled transport stays open (the pool owns its
   * lifecycle); this runtime binds to it and projects the candidate's
   * hydrate. Never creates or closes the socket.
   */
  installPreparedSession(
    options: Omit<
      AdoptCandidateOptions<Client>,
      "expected" | "preservePreviousTransport"
    > & {
      expected?: ActiveSessionAuthority<Client>;
    },
  ): ActiveSessionAuthority<Client> {
    if (!this.#managed) {
      throw new Error("installPreparedSession requires managed-transport mode");
    }
    const current = this.#authority;
    if (current) {
      if (!options.expected || !this.isCurrent(options.expected)) {
        throw new StaleSessionAuthorityError();
      }
      return this.adoptCandidate({
        ...options,
        expected: current,
        preservePreviousTransport: true,
      });
    }
    // First install on a fresh record: adopt into the empty runtime.
    return this.#adoptFirst(
      options.config,
      options.candidate,
      options.authorizeCommit,
    );
  }

  /**
   * Detach this record from the pooled transport without closing it. The
   * Session's server-side work is unaffected; the record simply stops
   * observing until `resumePreparedSession` re-binds it.
   */
  suspendTransport(expected: ActiveSessionAuthority<Client>): void {
    if (!this.#managed) {
      throw new Error("suspendTransport requires managed-transport mode");
    }
    if (!this.isCurrent(expected)) {
      throw new StaleSessionAuthorityError();
    }
    this.#cancelReconnect();
    this.#retryEnabled = false;
    // Invalidate the authority and any in-flight hydrate/recovery operation so
    // a LATE hydrate that resolves after suspension cannot commit or emit
    // ready. The durable identity + cursor are retained for resume.
    this.#invalidateRecoveryOperation();
    this.#generation += 1;
    this.#recovering = false;
    this.#recoveryBuffer = [];
    const binding = this.#binding;
    this.#binding = null;
    this.#disposeBinding(binding);
    // Null the authority so every lease (isCurrent) fails during suspension:
    // a start/interrupt RPC captured against the OLD authority cannot dispatch
    // while the record is detached. The Session's server-side work continues;
    // this client simply stops being an authority until resume.
    this.#authority = null;
    // Freeze dispatch: the record is detached and unhealthy until resume.
    this.#phase = "disconnected";
    this.#status = "disconnected";
    this.#publish();
  }

  /**
   * Re-bind a suspended (or fresh) record to the pooled transport with a new
   * prepared candidate. The pool supplies the connected socket; this runtime
   * validates and projects it.
   */
  resumePreparedSession(
    options: Omit<
      AdoptCandidateOptions<Client>,
      "preservePreviousTransport" | "expected"
    >,
  ): ActiveSessionAuthority<Client> {
    if (!this.#managed) {
      throw new Error("resumePreparedSession requires managed-transport mode");
    }
    // After suspendTransport the authority is null; this is a re-install on the
    // shared pooled socket (never a new transport). authorizeCommit still gates.
    return this.#adoptFirst(
      options.config,
      options.candidate,
      options.authorizeCommit,
    );
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
    if (!this.#managed) {
      try {
        previous?.client.disconnect();
      } catch {
        // Explicit disconnect is idempotent and best effort.
      }
    }
    // Managed mode: the pooled socket belongs to the pool. One record's
    // teardown never closes the shared transport other Sessions live on.
    this.#publish();
    this.#emit({ type: "session-cleared", reason: "disconnect" });
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
    if (this.#managed) {
      throw new Error(
        "A managed Session runtime cannot replace its transport; the pool owns the socket",
      );
    }
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
        // Browser WebSockets report error before close. The client preserves
        // that error status on close, so waiting only for "disconnected"
        // strands an established Session after an ordinary network failure.
        if (status === "disconnected" || status === "error") {
          this.#scheduleReconnect();
        }
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
      unsubscribe();
    }
  }

  #scheduleReconnect(): void {
    if (this.#managed) return; // the pool owns reconnect scheduling
    if (this.#reconnectTimer || !this.#retryEnabled || !this.#target) return;
    this.#invalidateRecoveryOperation();
    const attempt = this.#retryAttempt + 1;
    this.#retryAttempt = attempt;
    const baseDelay = Math.min(500 * 2 ** Math.min(attempt - 1, 4), 5_000);
    const random = (this.#options.random ?? Math.random)();
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
    this.#logDiagnostic("reconnect-scheduled");
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
        assertConnected(authority.client);
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
      assertConnected(authority.client);
      if (result.opened.session_id !== target.config.sessionId) {
        throw new Error(
          `session/open returned ${result.opened.session_id}, expected ${target.config.sessionId}`,
        );
      }
      if (
        target.config.profileId &&
        result.opened.active_profile_id !== target.config.profileId
      ) {
        throw new Error(
          `session/open returned Profile ${result.opened.active_profile_id ?? "<missing>"}, expected ${target.config.profileId}`,
        );
      }
      if (
        target.config.cwd &&
        result.opened.workspace_root !== target.config.cwd
      ) {
        throw new Error(
          `session/open returned workspace ${result.opened.workspace_root ?? "<missing>"}, expected ${target.config.cwd}`,
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
    authorizeCommit?: () => boolean,
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
    if (hydrated.session_id !== authority.sessionId) {
      // Routing-class contract violation (the server accepted session/open
      // but hydrate landed elsewhere). Inherently fatal, so the reconnect
      // loop stops and the real cause reaches the UI instead of being
      // masked by the generic reconnect banner.
      throw new HydrateSessionMismatchError(
        hydrated.session_id,
        authority.sessionId,
      );
    }
    if (this.#options.prepareHydrate) {
      try {
        await this.#options.prepareHydrate(hydrated);
      } catch (reason) {
        if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
        throw reason;
      }
      if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
    }
    if (authorizeCommit && !authorizeCommit())
      throw new StaleSessionAuthorityError();
    this.#projection.commitHydrate(hydrated);
    this.#recovering = false;
    this.#error = null;
    this.#logDiagnostic("hydrated");
    this.#publish();
    if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
    const covered = hydrateAssistantIdentities(
      authority,
      hydrated,
      this.#recoveryBuffer.map((entry) => entry.notification),
    );
    this.#emit({
      type: "session-hydrate",
      reason,
      authority,
      hydrated,
      assistantIdentities: covered.identities,
    });
    if (!this.#isRecoveryOperationCurrent(authority, operation)) return;
    const buffered = this.#recoveryBuffer;
    this.#recoveryBuffer = [];
    const disposition = this.#drainNotifications(
      authority,
      buffered.map((entry) =>
        covered.receipts.has(entry.notification)
          ? { ...entry, identityOnly: true }
          : entry,
      ),
    );
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
    this.#logDiagnostic("recovered");
    this.#publish();
    this.#emit({ type: "session-ready", reason, authority });
  }

  #drainCandidateNotifications(
    notifications: readonly RpcNotification[],
    identityOnly: ReadonlySet<RpcNotification> = new Set(),
  ): void {
    const authority = this.#authority;
    if (!authority) return;
    this.#drainNotifications(
      authority,
      notifications.map((notification) => ({
        notification,
        retriedAfterHydrate: false,
        identityOnly: identityOnly.has(notification),
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
      const disposition = this.#acceptNotification(authority, entry, false, {
        fromRecoveryBuffer: true,
      });
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
    options: { fromRecoveryBuffer?: boolean } = {},
  ): NotificationDisposition {
    if (!this.isCurrent(authority)) return "terminal";
    const { notification } = entry;
    // Raw diagnostics observe every event on the pooled transport (the event
    // inspector is transport-scoped, not Session-scoped); this consumes no
    // recovery buffer and does not project into the timeline.
    if (raw) this.#emit({ type: "raw-notification", notification });
    // P8: filter FOREIGN-Session traffic BEFORE the recovery buffer-capacity
    // check and BEFORE any timeline projection. On a pooled transport every
    // Session's events flow past every record's runtime; a foreign Session's
    // flood must never consume this record's recovery bound nor fold into its
    // timeline. rc11 projection envelopes DO carry session_id (+ topic), so
    // they are scope-filtered too — a deferred-recovery flood of another
    // Session's envelopes cannot overflow this record.
    if (!notificationMatchesSessionScope(notification, authority.sessionId)) {
      return "settled";
    }
    if (this.#recovering) {
      return this.#enqueueRecovery(authority, entry)
        ? "recovering"
        : "terminal";
    }

    const decision = this.#projection.observe(notification, options);
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
    // A covered persisted receipt still participates in thread/cursor ordering.
    // Its identity was joined to hydrate before draining; its stale prose and
    // ordinary notification/queue/peer effects are deliberately not replayed.
    if (entry.identityOnly) return "settled";
    // Foreign-session traffic was already filtered at the top of this method.
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
    if (this.#managed) {
      // Managed mode: the pool owns the physical socket and every other
      // Session on it. Quarantine THIS record instead of closing the shared
      // transport.
      const binding = this.#binding;
      this.#binding = null;
      this.#disposeBinding(binding);
      return;
    }
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
    this.#logDiagnostic("failed", message);
    // A hydrate routing mismatch is fatal in itself: the host cannot opt
    // back into an endless retry loop by omitting the classifier.
    const fatal =
      reason instanceof HydrateSessionMismatchError ||
      (this.#options.isFatalSessionError?.(reason) ?? false);
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
    if (this.#managed) {
      const binding = this.#binding;
      this.#binding = null;
      this.#disposeBinding(binding);
      return;
    }
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
      diagnostics: this.#diagnostics.slice(),
    };
  }

  #logDiagnostic(kind: ActiveSessionDiagnostic["kind"], detail?: string): void {
    this.#diagnostics.push({
      at: new Date().toISOString(),
      kind,
      ...(detail !== undefined ? { detail } : {}),
    });
    const overflow = this.#diagnostics.length - 20;
    if (overflow > 0) this.#diagnostics.splice(0, overflow);
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

/** Split only receipts already covered by this exact, committed hydrate head. */
function hydrateAssistantIdentities<Client extends ActiveSessionClient>(
  authority: ActiveSessionAuthority<Client>,
  hydrated: SessionHydrateResult,
  notifications: readonly RpcNotification[],
): { identities: HydratedAssistantIdentity[]; receipts: Set<RpcNotification> } {
  const identities: HydratedAssistantIdentity[] = [];
  const receipts = new Set<RpcNotification>();
  for (const notification of notifications) {
    const envelope =
      notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE &&
      hydrated.session_id === authority.sessionId &&
      supportsFeature(
        authority.capabilities,
        CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
      ) &&
      notificationMatchesSessionScope(notification, authority.sessionId)
        ? parseProjectionEnvelope(notification.params)
        : null;
    if (
      envelope?.payload.type !== "assistant_persisted" ||
      !envelope.cursor ||
      envelope.cursor.stream !== hydrated.cursor.stream ||
      envelope.cursor.seq > hydrated.cursor.seq
    ) {
      continue;
    }
    receipts.add(notification);
    // Even an unusable identity cannot authorize covered prose to replace the
    // hydrate. Missing/reused IDs are rejected by the record's identity join.
    const data = envelope.payload.data;
    if (
      isRecord(data) &&
      isRecord(data.meta) &&
      typeof data.meta.message_id === "string" &&
      data.meta.message_id.length > 0 &&
      typeof data.assistant_segment_id === "string" &&
      data.assistant_segment_id.length > 0
    ) {
      identities.push({
        messageId: data.meta.message_id,
        turnId: envelope.turn_id,
        segmentId: data.assistant_segment_id,
      });
    }
  }
  return { identities, receipts };
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

function assertConnected(client: ActiveSessionClient): void {
  // A response may already be received while its lazy decoder is loading.
  // Closing the socket then cannot reject that promise; do not let its late
  // completion authenticate a dead client or replace the scheduled retry target.
  if (client.status !== "connected") {
    throw new Error(
      "The server transport disconnected before the response was ready",
    );
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
