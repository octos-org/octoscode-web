import {
  CORE_UI_METHODS,
  approvalResolutionId,
  isRecord,
  parseApprovalRequested,
  parseTokenCostUpdate,
  parseUserQuestionRequested,
  type RpcNotification,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  parsePeerNotification,
  samePeerScope,
  type PeerCommands,
} from "@octos-org/octoscode-client/peer-protocol";
import { LazyPeerManager } from "../peers/lazy-peer-manager.ts";
import type {
  PeerOpenOutcome,
  PeerOpenRequest,
  PeerSessionEvent,
} from "../peers/peer-manager.ts";
import type { QueueBackedTurnController } from "../composer/use-turn-controller.ts";
import { ExternalDriverRefusalError } from "@octos-org/octoscode-client/external-driver-meta";
import { peerDispatchRefusalLabel } from "../control/peer-dispatch-commands.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";
import type { SessionControlReadiness } from "./session-record-manager.ts";
import type { TimelineEntry } from "../timeline/model.ts";

export interface PeerCoordinatorClient {
  readonly status: string;
  peerCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object,
  ): Promise<PeerCommands>;
}
/** Structural subset of SessionRecord: no connection config or credentials. */
export interface PeerCoordinatorRecord<Client extends PeerCoordinatorClient> {
  readonly scope: SessionRuntimeScope;
  readonly runtime: {
    currentAuthority(): {
      client: Client;
      generation: number;
      capabilities: UiProtocolCapabilities | undefined;
    } | null;
    getSnapshot(): { phase: string; status: string };
  };
  readonly controller: Pick<
    QueueBackedTurnController,
    "enqueueTurn" | "queueSnapshot" | "backgroundHandoffTurn"
  >;
  readonly payload: { hydrated: SessionHydrateResult } | null;
  /** Canonical record-owned reducer output, never the selected UI's mirror. */
  readonly timeline: readonly TimelineEntry[];
  /** FAIL-CLOSED control-seat projection (session-record-manager.ts:71). Absent
   * or non-`ready` keeps the `session/open` path; only an observed external
   * binding admits the `peer/dispatch` leaf. */
  readonly controlReadiness?: SessionControlReadiness;
}

/** The ACCEPTED `peer/dispatch` receipt facts the host surfaces after the
 * server has adopted a peer identity (design 1120 §3-4). The record is the
 * OPEN Session for `adoptedSessionId`; `operationId` is the idempotency key
 * the accepted receipt echoed back. Identity is matched on the SERVER-adopted
 * `adoptedSessionId`, but `binding.opened` is keyed by the STAGING request
 * session id (the key the manager closes with), so the two deliberately differ. */
export interface PeerDispatchStart<Record> {
  readonly record: Record;
  readonly operationId: string;
  readonly adoptedSessionId: string;
  readonly adoptedTurnId: string;
  /**
   * The dispatch receipt's OWN adopted slug (finding 2920 (b)). The server
   * ADOPTS the peer identity, so the row/dock must key on THIS slug rather than
   * the locally pre-computed staging slug the request carried.
   */
  readonly slug: string;
  /** True when the server reported an idempotent replay of this operationId. */
  readonly duplicate: boolean;
}

type DispatchPeer<Client, Record> = (
  request: PeerOpenRequest,
  operationId: string,
  client: Client,
) => Promise<PeerDispatchStart<Record>>;
export interface SessionPeerCoordinatorOptions<
  Client extends PeerCoordinatorClient,
  Record extends PeerCoordinatorRecord<Client>,
> {
  isRetained(record: Record): boolean;
  subscribeRecords(listener: () => void): () => void;
  /** Call recordManager.openOnRecord using the live config locally; NEVER select.
   * Check request.isCurrent() before opening and after any additional await. */
  openPeer(request: PeerOpenRequest, client: Client): Promise<Record>;
  /** Stage through the external-driver `peer/dispatch` leaf (design 1120 §1).
   * Used ONLY when the record's `controlReadiness === "ready"`; when omitted
   * the `session/open` path stays byte-identical. Fail-closed on every await. */
  dispatchPeer?: DispatchPeer<Client, Record>;
  /** Only this exact record may be evicted. Preserve a selected closed peer's
   * honest view/error; this callback must never select or close its master. */
  closePeer(record: Record): void;
  readOnly?(record: Record): boolean;
  timeoutMs?: number;
  bufferLimit?: number;
}
type Notification = Pick<RpcNotification, "method" | "params">;
interface Binding<
  Client extends PeerCoordinatorClient,
  Record extends PeerCoordinatorRecord<Client>,
> {
  record: Record;
  manager: LazyPeerManager;
  commands: PeerCommands | null;
  generation: number | null;
  version: number;
  buffered: Notification[];
  error: string | null;
  blocked: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
  opened: Map<string, Record>;
  closed: Set<string>;
  /** Pre-dispatch idempotency keys for THIS master, keyed by the pending peer's
   * retry-stable kickoff `turnId`. Minted ONCE and reused on every retry so a
   * lost-ack replay dedupes server-side (design 1120 §4). Entries are dropped
   * with the binding; a re-staged slug mints a fresh key. */
  operations: Map<string, string>;
}

/**
 * Maps a PEER's own Session frame onto its row in the MASTER's manager. Rows
 * are keyed by the STAGING identity (`binding.opened`), while the frame carries
 * the peer's ADOPTED `session_id`; only the coordinator holds both, so this is
 * the one place the activity axis (audit 0550 row 5) can be produced. Unknown
 * sessions, closed peers and non-Session frames yield null and fall through.
 */
export function peerSessionEventFor(
  notification: Notification,
  opened: ReadonlyMap<string, { scope: { sessionId: string } }>,
): PeerSessionEvent | null {
  const frame = notification as RpcNotification;
  if (!isRecord(notification.params)) return null;
  const sessionId = notification.params.session_id;
  if (typeof sessionId !== "string") return null;
  let key: string | null = null;
  for (const [staging, peer] of opened)
    if (peer.scope.sessionId === sessionId) key = staging;
  if (!key) return null;
  // Turn terminal (done / error / interrupted) freezes the axis.
  if (
    notification.method === CORE_UI_METHODS.TURN_COMPLETED ||
    notification.method === CORE_UI_METHODS.TURN_ERROR
  )
    // J3 (judge r3): carry the terminal CODE — turn/error "interrupted" is
    // Stopped, any other error is Failed; errors must NEVER read Finished.
    return {
      sessionId: key,
      kind: "turn-terminal",
      ...(notification.method === CORE_UI_METHODS.TURN_COMPLETED
        ? { outcome: "finished" as const }
        : {
            ...(notification.params.code === "interrupted"
              ? { outcome: "interrupted" as const }
              : { outcome: "failed" as const }),
            ...(typeof notification.params.message === "string"
              ? { error: notification.params.message }
              : {}),
          }),
    };
  if (notification.method === CORE_UI_METHODS.TURN_STARTED)
    // J3: carry the frame's turn id so the manager can detect a REPLACEMENT
    // turn and require fresh intent instead of silently retargeting.
    return {
      sessionId: key,
      kind: "turn-started",
      ...(typeof notification.params.turn_id === "string"
        ? { turnId: notification.params.turn_id }
        : {}),
    };
  if (notification.method === CORE_UI_METHODS.APPROVAL_REQUESTED) {
    const approval = parseApprovalRequested(frame);
    return {
      sessionId: key,
      kind: "attention-requested",
      requestKind: "approval",
      ...(approval ? { requestId: approval.approvalId } : {}),
      // J3: the request's CONTENTS — what is being asked, so every decision
      // is informed (tool, its target, the requested scope, title/body).
      ...(approval
        ? {
            approval: {
              toolName: approval.toolName,
              target:
                typeof (
                  approval.typedDetails as {
                    command?: { command_line?: unknown } | null;
                  } | null
                )?.command?.command_line === "string"
                  ? (
                      approval.typedDetails as {
                        command: { command_line: string };
                      }
                    ).command.command_line
                  : null,
              scope: approval.approvalKind ?? null,
              title: approval.title,
              body: approval.body,
            },
          }
        : {}),
    };
  }
  if (notification.method === CORE_UI_METHODS.USER_QUESTION_REQUESTED) {
    const question = parseUserQuestionRequested(frame);
    return {
      sessionId: key,
      kind: "attention-requested",
      requestKind: "question",
      ...(question ? { requestId: question.questionId } : {}),
      // J3: the question's CONTENTS — the choices the answer card renders.
      ...(question
        ? {
            question: {
              header: question.questions[0]?.header ?? null,
              question: question.questions[0]?.question ?? null,
              options: (question.questions[0]?.options ?? []).map((option) => ({
                label: option.label,
                description: option.description ?? null,
              })),
              multiSelect: question.questions[0]?.multiSelect ?? false,
              allowFreeText: question.questions[0]?.allowFreeText ?? false,
            },
          }
        : {}),
    };
  }
  // approval/decided | auto_resolved | cancelled close the blocked wait.
  if (approvalResolutionId(frame))
    return { sessionId: key, kind: "attention-resolved" };
  const usage = parseTokenCostUpdate(frame);
  if (usage && usage.outputTokens !== undefined)
    return { sessionId: key, kind: "usage", outputTokens: usage.outputTokens };
  return null;
}

/** One native lifecycle owner per retained MASTER record. Selection is absent
 * from this API: background staged events use exactly the same host as foreground. */
export class SessionPeerCoordinator<
  Client extends PeerCoordinatorClient,
  Record extends PeerCoordinatorRecord<Client>,
> {
  readonly #options: SessionPeerCoordinatorOptions<Client, Record>;
  readonly #bindings = new Map<Record, Binding<Client, Record>>();
  readonly #listeners = new Set<() => void>();
  #client: Client | null = null;
  #transport = 0;
  constructor(options: SessionPeerCoordinatorOptions<Client, Record>) {
    this.#options = options;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish = (): void => {
    for (const listener of this.#listeners) listener();
  };
  get(record: Record): LazyPeerManager | null {
    // A FOCUSED peer record is never bound itself — its roster lives in the
    // MASTER binding that opened it (`opened`/`closed` are keyed by that peer's
    // session id). Resolve the OWNER binding first, then fall back to the
    // record's own; a foreign record still resolves nothing (fail-closed).
    //
    // P2g (grant 3030) clause (b): this IS the resolution the seat's Steer path
    // uses (the 2520 owner-manager `get(record)` precedent), so the console's
    // staged dispatch resolves the ACTIVE record's manager through the identical
    // path — see the proving test in session-peer-coordinator.test.ts. Identity
    // is deliberately the record OBJECT, never a scope key: a retired master
    // must not be repainted by a replacement incarnating the same session id
    // (`retirement cancels only its owner`).
    const owner = [...this.#bindings.values()].find(
      (binding) =>
        binding.opened.has(record.scope.sessionId) ||
        binding.closed.has(record.scope.sessionId),
    );
    return (owner ?? this.#bindings.get(record))?.manager ?? null;
  }
  getError(record: Record): string | null {
    return this.#bindings.get(record)?.error ?? null;
  }
  /**
   * `/peer clear` (TUI parity 2500 §2): prune the ACTIVE record's FINISHED peer
   * rows — done/closed only, never live/blocked/idle. Scoped strictly to the
   * named record's own binding, so a foreign or unbound record is a fail-closed
   * 0. Returns the number of rows pruned; the roster re-renders through the
   * manager's own publish (the dock's `summarizeRoster` pill counts follow).
   */
  clearFinished(record: Record): number {
    return this.#bindings.get(record)?.manager.clearFinished() ?? 0;
  }
  /** Capture once when the pooled listener is installed, including same-object reconnects. */
  notificationObserver(
    client: Client,
  ): (notification: Notification) => boolean {
    const transport = this.#transport;
    return (notification) =>
      this.observeNotification(notification, client, transport);
  }
  #timeout(): number {
    return Math.max(1, this.#options.timeoutMs ?? 15_000);
  }

  bind(record: Record): LazyPeerManager | null {
    if (!this.#options.isRetained(record)) return null;
    let binding = this.#bindings.get(record);
    if (!binding) {
      const owner: Binding<Client, Record> = {
        record,
        commands: null,
        generation: null,
        version: 0,
        buffered: [],
        error: null,
        blocked: false,
        timer: null,
        unsubscribe: () => {},
        opened: new Map(),
        closed: new Set(),
        operations: new Map(),
        manager: new LazyPeerManager({
          commands: () => this.#bindings.get(record)?.commands ?? null,
          readOnly: () =>
            owner.blocked || Boolean(this.#options.readOnly?.(record)),
          onOpenPeer: (request) => this.#open(owner, request),
          onClosePeer: ({ sessionId }) => {
            owner.closed.add(sessionId);
            const peer = owner.opened.get(sessionId);
            owner.opened.delete(sessionId);
            if (peer && this.#options.isRetained(peer))
              this.#options.closePeer(peer);
          },
        }),
      };
      owner.unsubscribe = owner.manager.subscribe(this.#publish);
      this.#bindings.set(record, owner);
      binding = owner;
    }
    this.#resolve(binding);
    return binding.manager;
  }

  /** Call null synchronously at loss, even if reconnection reuses the client object. */
  setTransport(client: Client | null): void {
    if (client === this.#client) return;
    this.#client = client;
    this.#transport += 1;
    for (const binding of this.#bindings.values()) {
      this.#withdraw(binding);
      this.#resolve(binding);
    }
    this.#publish();
  }
  #withdraw(binding: Binding<Client, Record>): void {
    binding.version += 1;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = null;
    binding.commands = null;
    binding.generation = null;
    binding.buffered = [];
    binding.manager.syncAuthority();
  }
  #fail(binding: Binding<Client, Record>, message: string): void {
    binding.error = message;
    binding.blocked = true;
    this.#withdraw(binding);
    this.#publish();
  }
  #resolve(binding: Binding<Client, Record>): void {
    const client = this.#client;
    const authority = binding.record.runtime.currentAuthority();
    if (
      binding.blocked ||
      !client ||
      client.status !== "connected" ||
      authority?.client !== client ||
      !authority.capabilities
    )
      return;
    if (binding.generation === authority.generation) return;
    if (binding.generation !== null) this.#withdraw(binding);
    binding.generation = authority.generation;
    const version = ++binding.version,
      transport = this.#transport;
    const current = () =>
      this.#bindings.get(binding.record) === binding &&
      binding.version === version &&
      this.#transport === transport &&
      this.#client === client &&
      client.status === "connected" &&
      this.#options.isRetained(binding.record) &&
      binding.record.runtime.currentAuthority()?.client === client &&
      binding.record.runtime.currentAuthority()?.generation ===
        authority.generation;
    if (binding.timer) clearTimeout(binding.timer);
    binding.timer = setTimeout(() => {
      if (current())
        this.#fail(
          binding,
          "Peer controls could not be loaded. Inspect the peer sessions before retrying.",
        );
    }, this.#timeout());
    void client
      .peerCommands(
        binding.record.scope.sessionId,
        binding.record.scope.profileId,
        authority.capabilities,
        binding.record,
      )
      .then((commands) => {
        if (!current()) return;
        if (
          !samePeerScope(commands.scope, {
            sessionId: binding.record.scope.sessionId,
            profileId: binding.record.scope.profileId,
            authority: binding.record,
          })
        )
          throw new Error("Peer command owner mismatch");
        if (binding.timer) clearTimeout(binding.timer);
        binding.timer = null;
        binding.commands = commands;
        binding.manager.syncAuthority();
        const buffered = binding.buffered;
        binding.buffered = [];
        for (const notification of buffered) {
          if (!current()) break;
          binding.manager.observeNotification(notification, commands);
        }
        this.#publish();
      })
      .catch(() => {
        if (current())
          this.#fail(
            binding,
            "Peer controls could not be loaded. Inspect the peer sessions before retrying.",
          );
      });
  }

  /** Root's ONE pooled listener must forward events for every master, not only selection. */
  observeNotification(
    notification: Notification,
    sourceClient: Client,
    sourceTransport: number,
  ): boolean {
    if (
      sourceTransport !== this.#transport ||
      sourceClient !== this.#client ||
      sourceClient.status !== "connected"
    )
      return false;
    // Native lifecycle frames have session/profile, but no workspace field.
    // Two retained workspace incarnations cannot both claim the same frame.
    const owners = [...this.#bindings.values()].filter(
      (binding) =>
        this.#options.isRetained(binding.record) &&
        parsePeerNotification(notification, {
          sessionId: binding.record.scope.sessionId,
          profileId: binding.record.scope.profileId,
          authority: binding.record,
        }),
    );
    if (owners.length > 1) {
      for (const binding of owners)
        this.#fail(
          binding,
          "Peer event ownership is ambiguous across retained sessions. Inspect the sessions; startup is disabled.",
        );
      return false;
    }
    let accepted = false;
    for (const binding of this.#bindings.values()) {
      if (binding.blocked || !this.#options.isRetained(binding.record))
        continue;
      // A peer's OWN Session events (turn started / attention requested /
      // resolved / terminal / usage) route to that peer's row by its staging
      // identity. Without this producer the row's activity axis never leaves
      // `idle` (gap 5): the manager folds it, nothing ever called it.
      if (binding.commands) {
        const sessionEvent = peerSessionEventFor(notification, binding.opened);
        if (sessionEvent) {
          accepted =
            binding.manager.observeSessionEvent(
              sessionEvent,
              binding.commands,
            ) || accepted;
          continue;
        }
      }
      const scope = {
        sessionId: binding.record.scope.sessionId,
        profileId: binding.record.scope.profileId,
        authority: binding.record,
      };
      const parsed = parsePeerNotification(notification, scope);
      if (!parsed) continue;
      this.#resolve(binding);
      if (binding.commands) {
        accepted =
          binding.manager.observeNotification(notification, binding.commands) ||
          accepted;
      } else if (
        binding.buffered.length >= Math.max(1, this.#options.bufferLimit ?? 128)
      ) {
        this.#fail(
          binding,
          "Peer lifecycle backlog exceeded its limit. Startup is disabled; inspect the peer sessions.",
        );
      } else {
        binding.buffered.push({
          method: notification.method,
          params: parsed.event,
        });
        // A recovering master may not yet expose a new command authority.
        // Bound that waiting period too, not only the dynamic factory itself.
        if (!binding.timer) {
          const transport = this.#transport;
          binding.timer = setTimeout(() => {
            if (
              this.#transport === transport &&
              this.#bindings.get(binding.record) === binding &&
              binding.buffered.length
            )
              this.#fail(
                binding,
                "Peer lifecycle could not resume. Startup is disabled; inspect the peer sessions.",
              );
          }, this.#timeout());
        }
        accepted = true;
      }
    }
    return accepted;
  }

  async #open(
    binding: Binding<Client, Record>,
    request: PeerOpenRequest,
  ): Promise<PeerOpenOutcome> {
    const client = this.#client,
      commands = binding.commands,
      transport = this.#transport;
    const generation = binding.record.runtime.currentAuthority()?.generation;
    const current = () =>
      !!client &&
      client.status === "connected" &&
      this.#client === client &&
      this.#transport === transport &&
      this.#bindings.get(binding.record) === binding &&
      binding.commands === commands &&
      !binding.blocked &&
      !this.#options.readOnly?.(binding.record) &&
      this.#options.isRetained(binding.record) &&
      binding.record.runtime.currentAuthority()?.generation === generation &&
      request.isCurrent() &&
      !request.signal.aborted;
    if (!client || !current())
      return {
        status: "not-started",
        error: "Peer startup was retired before opening.",
      };
    binding.closed.delete(request.sessionId);
    const dispatch = this.#options.dispatchPeer;
    if (dispatch && binding.record.controlReadiness === "ready")
      return this.#openByDispatch(binding, request, client, current, dispatch);
    let peer: Record;
    try {
      peer = await this.#options.openPeer(request, client);
    } catch {
      return {
        status: "not-started",
        error: "Peer session could not be opened; no kickoff was queued.",
      };
    }
    const scope = peer.scope,
      master = binding.record.scope;
    const matches =
      scope.sessionId === request.sessionId &&
      scope.profileId === request.profileId &&
      scope.workspaceRoot === request.cwd &&
      scope.endpoint === master.endpoint &&
      scope.authorityEpoch === master.authorityEpoch;
    if (!current()) {
      if (
        binding.closed.has(request.sessionId) &&
        matches &&
        this.#options.isRetained(peer) &&
        peer.runtime.currentAuthority()?.client === client
      )
        this.#options.closePeer(peer);
      return {
        status: "not-started",
        error: "Peer startup was retired before enqueue.",
      };
    }
    if (
      !matches ||
      !this.#options.isRetained(peer) ||
      peer.runtime.currentAuthority()?.client !== client
    )
      return {
        status: "not-started",
        error:
          "The opened peer did not match its confirmed owner and workspace.",
      };
    binding.opened.set(request.sessionId, peer);
    const hydrated = peer.payload?.hydrated,
      queue = peer.controller.queueSnapshot();
    if (
      !hydrated ||
      hydrated.session_id !== request.sessionId ||
      !Array.isArray(hydrated.turns) ||
      !Array.isArray(hydrated.messages) ||
      hydrated.turns.length ||
      hydrated.messages.length ||
      hydrated.replayed_envelopes?.length ||
      hydrated.replayed_tool_envelopes?.length ||
      hydrated.pending_approvals?.length ||
      hydrated.pending_questions?.length ||
      queue.active ||
      queue.pending.length
    )
      return {
        status: "unknown",
        error:
          "This peer has existing or unconfirmed session history. Inspect it; no kickoff was queued.",
      };
    if (
      peer.runtime.getSnapshot().phase !== "ready" ||
      peer.runtime.getSnapshot().status !== "connected" ||
      !current()
    )
      return {
        status: "not-started",
        error: "The peer session is not ready; no kickoff was queued.",
      };
    return this.#enqueueAndObserve(peer, request, current);
  }

  /**
   * Stage ONE peer through the external-driver `peer/dispatch` leaf. The server
   * ADOPTS the peer identity (design 1120 §3), so the receipt — not the locally
   * pre-computed staging key — is authoritative for the opened record. The
   * accepted receipt is also the producer of the row's `operationId` (§4).
   */
  async #openByDispatch(
    binding: Binding<Client, Record>,
    request: PeerOpenRequest,
    client: Client,
    current: () => boolean,
    dispatch: DispatchPeer<Client, Record>,
  ): Promise<PeerOpenOutcome> {
    // Mint ONCE per pending peer (keyed by the retry-stable kickoff `turnId`)
    // and REUSE it on every retry, so a lost-ack replay dedupes server-side.
    let operationId = binding.operations.get(request.turnId);
    if (!operationId) {
      operationId = crypto.randomUUID();
      binding.operations.set(request.turnId, operationId);
    }
    let started: PeerDispatchStart<Record>;
    try {
      started = await dispatch(request, operationId, client);
    } catch (error) {
      // A typed refusal is a clean, retryable rejection; the raw server copy is
      // never rendered (peer-dispatch-commands.ts label table).
      if (error instanceof ExternalDriverRefusalError)
        return {
          status: "not-started",
          error: peerDispatchRefusalLabel(error.refusalKind),
          // Carry the allowlisted TYPED kind so the manager/console can render the
          // bounded label (a typed refusal never sets `prepareError`; finding
          // 2920 (a)).
          refusalKind: error.refusalKind,
        };
      return {
        status: "unknown",
        error:
          "Peer dispatch could not be confirmed. Inspect the peer session; do not automatically retry.",
      };
    }
    const peer = started.record;
    // The server ALREADY accepted and adopted an identity: there is nothing to
    // un-dispatch, so a late retirement stays `unknown`, never `not-started`.
    if (!current())
      return {
        status: "unknown",
        error:
          "Peer startup was retired before confirmation. Inspect the peer session.",
      };
    const scope = peer.scope,
      master = binding.record.scope;
    // Identity is SERVER-adopted: match the receipt's adopted session, not the
    // staging key. The workspace is server-REPORTED, so it is disclosed rather
    // than fenced against the requested cwd.
    const matches =
      scope.sessionId === started.adoptedSessionId &&
      scope.profileId === request.profileId &&
      scope.endpoint === master.endpoint &&
      scope.authorityEpoch === master.authorityEpoch;
    if (
      !matches ||
      !this.#options.isRetained(peer) ||
      peer.runtime.currentAuthority()?.client !== client ||
      !current()
    )
      return {
        status: "unknown",
        error:
          "The dispatched peer did not match its confirmed owner and workspace. Inspect the peer session.",
      };
    if (
      peer.runtime.getSnapshot().phase !== "ready" ||
      peer.runtime.getSnapshot().status !== "connected"
    )
      return {
        status: "unknown",
        error: "The dispatched peer is not ready. Inspect the peer session.",
      };
    // Key by the STAGING key: that is the identity the manager closes with
    // (peer-manager.ts #close sends `sessionId: identity`), so teardown still
    // resolves. The record itself carries the adopted session scope.
    binding.opened.set(request.sessionId, peer);
    // A `duplicate: true` receipt is an idempotent replay of the SAME key, so it
    // resolves `started` with that key — never a second row. The receipt's OWN
    // adopted slug rides the outcome so the row keys on it (finding 2920 (b)).
    return {
      status: "started",
      operationId: started.operationId,
      slug: started.slug,
    };
  }

  #enqueueAndObserve(
    peer: Record,
    request: PeerOpenRequest,
    current: () => boolean,
  ): Promise<PeerOpenOutcome> {
    const generation = peer.runtime.currentAuthority()?.generation;
    const client = peer.runtime.currentAuthority()?.client;
    return new Promise((resolve) => {
      let finished = false,
        enqueued = false;
      let unsubscribe = () => {};
      const finish = (outcome: PeerOpenOutcome) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        request.signal.removeEventListener("abort", check);
        resolve(outcome);
      };
      const check = () => {
        if (
          !current() ||
          !this.#options.isRetained(peer) ||
          peer.runtime.currentAuthority()?.client !== client ||
          peer.runtime.currentAuthority()?.generation !== generation
        ) {
          finish({
            status: enqueued ? "unknown" : "not-started",
            error:
              "Peer startup authority changed before confirmation. Inspect the peer session.",
          });
        } else if (
          enqueued &&
          (peer.controller.backgroundHandoffTurn()?.turnId === request.turnId ||
            peer.timeline.some(
              (entry) =>
                entry.id === `terminal:${request.turnId}` &&
                entry.kind === "system" &&
                (entry.status === "complete" || entry.status === "error"),
            ))
        )
          // Producer for a peer row's `operationId` (data review 1015, defect 2).
          // The web opens a peer over `session/open`, NOT the `peer/dispatch`
          // leaf, so the accepted dispatch receipt that carries the operation id
          // (`PeerDispatchReceiptView.operationId`, client
          // external-driver-peer-control.ts:376) is genuinely unavailable here:
          // `PeerCommands` exposes only prepare/gather (peer-protocol.ts:185-190)
          // and the leaf is never called in apps/web. The field on the outcome
          // type is already threaded by PeerManager; this site stays
          // `{ status: "started" }` (rows carry null) until the web adopts the
          // dispatch leaf, at which point its accepted receipt is stamped here.
          finish({ status: "started" });
      };
      const timer = setTimeout(
        () =>
          finish({
            status: "unknown",
            error:
              "Peer kickoff acceptance is unknown. Inspect the peer session; do not automatically retry.",
          }),
        this.#timeout(),
      );
      unsubscribe = this.#options.subscribeRecords(check);
      request.signal.addEventListener("abort", check, { once: true });
      check();
      if (finished) {
        unsubscribe();
        return;
      }
      // Queue callbacks may fire synchronously inside admission. Once entered,
      // authority loss is ambiguous until an explicit false receipt returns.
      enqueued = true;
      try {
        const accepted = peer.controller.enqueueTurn({
          turnId: request.turnId,
          text: request.prompt,
        });
        if (!accepted)
          finish({
            status: "not-started",
            error: "The peer controller rejected the kickoff before enqueue.",
          });
        else check();
      } catch {
        finish({
          status: "unknown",
          error:
            "Peer kickoff could not be confirmed. Inspect its session before retrying.",
        });
      }
    });
  }

  retire(record: Record): void {
    const binding = this.#bindings.get(record);
    if (!binding) return;
    this.#bindings.delete(record);
    this.#withdraw(binding);
    binding.unsubscribe();
    binding.manager.clear();
    this.#publish();
  }
  clear(): void {
    for (const record of this.#bindings.keys()) this.retire(record);
    this.#client = null;
    this.#transport += 1;
  }
}
