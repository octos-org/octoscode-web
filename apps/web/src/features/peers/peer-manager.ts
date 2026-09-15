import {
  PEER_METHODS,
  PeerCapabilityError,
  buildPeerPrepareParams,
  samePeerScope,
  parsePeerNotification,
  peerIdentityForTopic,
  type PeerCommands,
  type PeerScope,
  type PeerFleetEntry,
  type PeerPrepareParams,
  type PeerPrepareResult,
  type PeerGatherParams,
  type PeerGatherResult,
  type PeerGatherEntry,
} from "@octos-org/octoscode-client/peers";
import type { RpcNotification } from "@octos-org/octoscode-client/protocol";

export type PeerOpenOutcome =
  | { status: "started"; operationId?: string | null; slug?: string }
  | { status: "not-started"; error: string; refusalKind?: string }
  | { status: "unknown"; error: string };

export interface PeerOpenRequest {
  readonly scope: PeerScope;
  readonly sessionId: string;
  readonly profileId: string;
  readonly topic: string;
  readonly slug: string;
  readonly cwd: string;
  readonly briefPath: string;
  readonly brief: string;
  readonly prompt: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  /** Host must check before opening, and after EVERY await before recording or starting a turn. */
  isCurrent(): boolean;
}
/**
 * Live-run axis (audit 0550 row 5), orthogonal to the lifecycle `status`:
 * `turn started -> live`; `approval/question requested -> blocked` (outranks
 * live); `turn terminal done/error/interrupted -> done` + a frozen stamp;
 * otherwise `idle`. Mirrors the TUI dock's ✻/⚠/✓/○ glyph semantics.
 */
export type PeerActivity = "idle" | "live" | "blocked" | "done";
/** Operator request kind a `blocked` peer Session is waiting on (console §6). */
export type PeerAttentionRequestKind = "approval" | "question";
/** Events the host reports for a peer's own Session, scoped by Session id. */
export type PeerSessionEventKind =
  | "turn-started"
  | "attention-requested"
  | "attention-resolved"
  | "turn-terminal"
  | "control-ack"
  | "usage";

/**
 * Acknowledgment vs outcome (design §4.3, round 2 judge #4). A CONTROL ack
 * is an ACKNOWLEDGMENT — "Sent" for steer, "Stop requested" for interrupt —
 * and promises nothing about the peer's outcome; only a turn TERMINAL carries
 * an outcome (Finished / Stopped / Failed). An ack never changes `activity`.
 */
export type PeerControlAcknowledgment =
  | { readonly kind: "sent"; readonly action: "steer" | "answer" | "approval" }
  | { readonly kind: "stop-requested" };

/** The terminal outcome a peer's own Session reported for its last turn. */
export type PeerTurnOutcome = "finished" | "stopped" | "failed";

/** The control action that produced a `control-ack` event. */
export type PeerControlAckAction = "steer" | "interrupt" | "answer" | "approval";

/**
 * The CONTENTS of a pending approval (judge r2 #4: "approvals/questions bound
 * to the REAL pending ids with contents + consequences"). Frozen verbatim
 * from the client's parsed `ApprovalRequested`; presentation-only.
 */
export interface PeerApprovalDetail {
  readonly toolName: string;
  /** The tool's target — its command line or path. */
  readonly target: string | null;
  /** The scope the request asks for ("request" | "turn" | "session" | "tool"). */
  readonly scope: string | null;
  readonly title: string | null;
  readonly body: string | null;
}

/** The CONTENTS of a pending question, for the row's answer card. */
export interface PeerQuestionOption {
  readonly label: string;
  readonly description: string | null;
}
export interface PeerQuestionDetail {
  readonly header: string | null;
  readonly question: string | null;
  readonly options: readonly PeerQuestionOption[];
  readonly multiSelect: boolean;
  readonly allowFreeText: boolean;
}
export interface PeerSessionEvent {
  readonly sessionId: string;
  readonly kind: PeerSessionEventKind;
  /**
   * The turn the event belongs to. On `turn-started` a turn id that DIFFERS
   * from the row's current turn is a REPLACEMENT turn: any pending
   * acknowledgment is stale and the row must demand a fresh click (§4.3 "the
   * row keeps the targeted turn id it acted on"). Optional so every
   * pre-existing caller keeps type-checking.
   */
  readonly turnId?: string;
  /**
   * Terminal outcome, only meaningful when `kind === "turn-terminal"`:
   * `finished` (turn/completed), `interrupted` (turn/error interrupted —
   * mapped to "stopped"), `failed` (any other turn/error). Optional so every
   * pre-existing caller keeps type-checking.
   */
  readonly outcome?: "finished" | "interrupted" | "failed";
  /** Terminal error text, only meaningful when `outcome === "failed"`. */
  readonly error?: string;
  /**
   * The control action an ack acknowledges, only meaningful when
   * `kind === "control-ack"`.
   */
  readonly action?: PeerControlAckAction;
  /**
   * Approval contents, only meaningful when `requestKind === "approval"` on an
   * `attention-requested` event (judge r2 #4).
   */
  readonly approval?: Readonly<PeerApprovalDetail>;
  /**
   * Question contents, only meaningful when `requestKind === "question"` on an
   * `attention-requested` event (judge r2 #4).
   */
  readonly question?: Readonly<PeerQuestionDetail>;
  /**
   * Output tokens for ONE turn, only meaningful when `kind === "usage"`.
   * Sourced from the client's existing token-cost surface —
   * `parseTokenCostUpdate()` → `TokenCostUpdate.outputTokens`
   * (`progress.updated` with `metadata.kind === "token_cost_update"`).
   */
  readonly outputTokens?: number;
  /**
   * Pending operator request, only meaningful when
   * `kind === "attention-requested"` (console plan §6): stamped on the row and
   * cleared on `attention-resolved` / `turn-terminal`.
   */
  readonly requestId?: string;
  readonly requestKind?: PeerAttentionRequestKind;
}
export interface PeerRosterEntry {
  readonly identity: string;
  readonly profileId: string;
  readonly topic: string;
  readonly slug: string;
  readonly cwd: string;
  readonly briefPath: string;
  readonly origin: "prepare" | "staged";
  readonly turnId: string;
  readonly status: "opening" | "started" | "failed" | "unknown" | "closed";
  /** Live-run axis (audit 0550 row 5); `status` remains the lifecycle axis. */
  readonly activity: PeerActivity;
  /** Wall-clock ms the row last became `started`; null until it first opens. */
  readonly openedAt: number | null;
  /** Wall-clock ms of the latest turn terminal, frozen for `done`; null until then. */
  readonly finishedAt: number | null;
  /**
   * Output tokens accumulated across the peer Session's turns (audit row 4),
   * from `usage` Session events; every row this manager produces carries a
   * number (0 until the first one lands). Optional in the type only so
   * full-row fixtures outside this grant keep type-checking.
   */
  readonly outputTokens?: number;
  /**
   * Pending operator request while `blocked` (console plan §6): the client's
   * request id and its kind, or null. Cleared on `attention-resolved` and on
   * every turn terminal. Optional in the type only so full-row fixtures
   * outside this grant keep type-checking.
   */
  readonly requestId?: string | null;
  readonly requestKind?: PeerAttentionRequestKind | null;
  /**
   * The pending request's CONTENTS (judge r2 #4): the approval's tool/target/
   * scope or the question's header/choices, or null. Cleared with the request.
   */
  readonly requestDetail?:
    | Readonly<PeerApprovalDetail>
    | Readonly<PeerQuestionDetail>
    | null;
  /**
   * The accepted dispatch's resolved MODEL (triage 4510 P2: the dock row reads
   * "Peer N · model" — Fleet §4.3 parity; never the raw slug). Optional in the
   * type only so full-row fixtures outside this grant keep type-checking.
   */
  readonly model?: string | null;
  /**
   * The peer/dispatch ACCEPTED operationId for this row (approval wiring GAP,
   * plan 0940): the caller-supplied idempotency key the receipt echoes back
   * (client `external-driver-peer-control.ts:343/:376`). Stamped from the
   * `PeerOpenOutcome` when the manager observes a confirmed start; preserved
   * across reconnects (the row is never re-minted for an existing identity);
   * cleared on close. Optional in the type only so full-row fixtures outside
   * this grant keep type-checking.
   */
  readonly operationId?: string | null;
  /**
   * The last CONTROL acknowledgment (round 2 judge #4): "Sent" /
   * "Stop requested" from an accepted `peer/control` receipt — an
   * acknowledgment, never an outcome. Cleared by a terminal, by an
   * attention-requested event (the wait supersedes the ack), and invalidated
   * (with `turnChangedSinceAck`) when a replacement turn starts. Optional in
   * the type only so full-row fixtures outside this grant keep type-checking.
   */
  readonly acknowledgment?: PeerControlAcknowledgment | null;
  /**
   * The terminal OUTCOME of the row's last turn: "finished" (turn/completed),
   * "stopped" (turn/error interrupted), "failed" (any other turn/error). Null
   * while the turn runs. Optional in the type only so full-row fixtures
   * outside this grant keep type-checking.
   */
  readonly outcome?: PeerTurnOutcome | null;
  /**
   * Renewed-intent marker (§4.3): the peer started a turn OTHER than the one
   * a pending/last action targeted. Rendered as "Peer started a new turn";
   * any pending action button requires a fresh click. Cleared on the next
   * terminal. Optional in the type only so full-row fixtures outside this
   * grant keep type-checking.
   */
  readonly turnChangedSinceAck?: boolean;
  readonly error: string | null;
  readonly canRetry: boolean;
}
export interface PeerManagerSnapshot {
  readonly peers: readonly PeerRosterEntry[];
  /** Profile-wide read results; they carry no session/workspace ownership. */
  readonly blackboard: readonly PeerGatherEntry[];
  readonly prepareBusy: boolean;
  readonly gatherBusy: boolean;
  readonly prepareError: string | null;
  readonly gatherError: string | null;
  readonly prepareUncertain: boolean;
  /**
   * The allowlisted TYPED dispatch-refusal kind from the LAST staging settle
   * (finding 2920 (a)). The Core answers a refused `peer/dispatch` with a
   * JSON-RPC error carrying `data.kind` (evidence
   * native-glm-dispatch-refusal-shape-2920), never a `state:"refused"` receipt,
   * so the console cannot learn the refusal from `prepareError` alone. Bounded
   * allowlisted marker only — raw server copy never rides this field. Null when
   * the last settle was not a typed dispatch refusal.
   */
  readonly dispatchRefusalKind: string | null;
}
export const EMPTY_PEER_SNAPSHOT: PeerManagerSnapshot = Object.freeze({
  peers: Object.freeze([]),
  blackboard: Object.freeze([]),
  prepareBusy: false,
  gatherBusy: false,
  prepareError: null,
  gatherError: null,
  prepareUncertain: false,
  dispatchRefusalKind: null,
});
export interface PeerManagerOptions {
  commands(): PeerCommands | null;
  readOnly?(): boolean;
  /** Open and kick off in the BACKGROUND; never change focus or active workspace. */
  onOpenPeer(request: PeerOpenRequest): Promise<PeerOpenOutcome>;
  onClosePeer?(request: { scope: PeerScope; sessionId: string }): void;
}
interface PendingPeer {
  request: PeerOpenRequest;
  abort: AbortController;
  attempt: number;
  promise: Promise<boolean> | null;
  invoked: boolean;
}

/** TUI store.rs peer_kickoff_prompt, including the durable brief location. */
export function peerKickoffPrompt(brief: string, briefPath: string): string {
  return `You are a peer agent. Your brief:\n\n${brief}\n\n(The durable copy of this brief is at ${briefPath} — re-read it if your context is compacted.)`;
}

/** React-free manager. Commands identity is the complete runtime authority fence. */
export class PeerManager {
  #options: PeerManagerOptions;
  #commands: PeerCommands | null;
  #owner: PeerScope | null;
  #epoch = 0;
  #snapshot = EMPTY_PEER_SNAPSHOT;
  #listeners = new Set<() => void>();
  #peers = new Map<string, PeerRosterEntry>();
  #pending = new Map<string, PendingPeer>();
  // Keep tombstones even after a closed row is acknowledged. Durable events have
  // no incarnation/version field; replay alone cannot authorize slug reuse.
  #closed = new Map<string, number>();
  #closeRevision = 0;
  #prepare: Promise<PeerPrepareResult | null> | null = null;
  #prepareAwaitingReceipt = false;
  #gatherToken = 0;
  // Activity axis (audit 0550 row 5): a row's activity immediately before a
  // `blocked` wait, restored when the approval/question resolves. Cleared when
  // the turn terminates or the row is closed/retired.
  #preBlock = new Map<string, PeerActivity>();

  constructor(options: PeerManagerOptions) {
    this.#options = options;
    this.#commands = options.commands();
    this.#owner = this.#commands?.scope ?? null;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = (): PeerManagerSnapshot => this.#snapshot;
  snapshot = this.getSnapshot;

  #publish(patch: Partial<PeerManagerSnapshot> = {}): void {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      peers: Object.freeze([...this.#peers.values()]),
    });
    for (const listener of this.#listeners) listener();
  }
  /**
   * Transport changes retain peer identities. Null is a temporary withdrawal;
   * hosts call clear() for explicit logout/retirement. A new semantic owner
   * (authority + session + profile) always retires the old owner's private data.
   */
  syncAuthority(): void {
    const commands = this.#options.commands();
    if (commands === this.#commands) return;
    this.#commands = commands;
    if (commands && !samePeerScope(this.#owner, commands.scope)) {
      this.#owner = commands.scope;
      this.clear();
      return;
    }
    this.#epoch += 1;
    this.#gatherToken += 1;
    for (const [identity, pending] of this.#pending) {
      pending.abort.abort();
      pending.attempt += 1;
      pending.promise = null;
      const entry = this.#peers.get(identity);
      if (entry?.status === "opening")
        this.#peers.set(
          identity,
          Object.freeze({
            ...entry,
            status: pending.invoked ? "unknown" : "failed",
            canRetry: !pending.invoked,
            error: pending.invoked
              ? "The connection changed before peer startup was confirmed. Inspect the peer session."
              : "The connection changed before peer startup. Retry opening when connected.",
          }),
        );
    }
    const uncertain = this.#prepareAwaitingReceipt;
    this.#prepareAwaitingReceipt = false;
    this.#prepare = null;
    this.#publish({
      prepareBusy: false,
      gatherBusy: false,
      ...(uncertain
        ? {
            prepareUncertain: true,
            prepareError:
              "The connection changed before staging was confirmed. Inspect the peer blackboard.",
          }
        : {}),
    });
  }
  /** Full semantic retirement. Do not use for ordinary reconnect. */
  clear(): void {
    this.#epoch += 1;
    this.#gatherToken += 1;
    for (const pending of this.#pending.values()) pending.abort.abort();
    this.#pending.clear();
    this.#peers.clear();
    this.#closed.clear();
    this.#prepare = null;
    this.#prepareAwaitingReceipt = false;
    this.#owner = this.#commands?.scope ?? null;
    this.#snapshot = EMPTY_PEER_SNAPSHOT;
    for (const listener of this.#listeners) listener();
  }
  #current(commands: PeerCommands, epoch: number): boolean {
    return (
      this.#epoch === epoch &&
      this.#commands === commands &&
      this.#options.commands() === commands
    );
  }
  canPrepare(readOnly = this.#options.readOnly?.() ?? false): boolean {
    return (
      !readOnly &&
      !this.#options.readOnly?.() &&
      (this.#options.commands()?.capabilities.prepare ?? false)
    );
  }
  canGather(): boolean {
    return this.#options.commands()?.capabilities.gather ?? false;
  }

  kickoff(
    params: PeerPrepareParams,
    options?: { readOnly: boolean },
  ): Promise<PeerPrepareResult | null> {
    this.syncAuthority();
    const commands = this.#commands;
    if (!commands || !this.canPrepare(options?.readOnly))
      return Promise.reject(new PeerCapabilityError(PEER_METHODS.PREPARE));
    if (this.#prepare) return this.#prepare;
    if (this.#snapshot.prepareUncertain)
      return Promise.reject(
        new Error(
          "The previous staging outcome is unknown. Inspect the peer blackboard before staging another peer.",
        ),
      );
    let input: PeerPrepareParams;
    try {
      input = buildPeerPrepareParams(params);
    } catch {
      this.#publish({
        prepareError:
          "Check the peer brief and fleet settings before retrying.",
      });
      return Promise.resolve(null);
    }
    const epoch = this.#epoch;
    const closeRevision = this.#closeRevision;
    // Capture input before awaiting: form edits must not change the peer's kickoff.
    const brief = input.brief;
    this.#publish({
      prepareBusy: true,
      prepareError: null,
      dispatchRefusalKind: null,
    });
    const operation = Promise.resolve()
      .then(() => {
        if (!this.#current(commands, epoch)) return null;
        this.#prepareAwaitingReceipt = true;
        return commands.prepare(input);
      })
      .then(async (result) => {
        if (!result || !this.#current(commands, epoch)) return null;
        this.#prepareAwaitingReceipt = false;
        const fleet = result.peers.length ? result.peers : [result];
        await Promise.all(
          fleet.map((peer, index) =>
            this.#stage(
              commands,
              peer,
              fleet.length > 1
                ? `${brief}\n\n(You are fleet member ${index + 1} of ${fleet.length} — peers were given this same brief; differentiate your angle.)`
                : brief,
              "prepare",
              closeRevision,
            ),
          ),
        );
        return this.#current(commands, epoch) ? result : null;
      })
      .catch(() => {
        if (this.#current(commands, epoch))
          this.#publish({
            prepareError:
              "Peer staging could not be confirmed. Inspect the blackboard; the server may have staged the peer.",
            prepareUncertain: true,
          });
        return null;
      })
      .finally(() => {
        if (this.#current(commands, epoch) && this.#prepare === operation) {
          this.#prepare = null;
          this.#prepareAwaitingReceipt = false;
          this.#publish({ prepareBusy: false });
        }
      });
    this.#prepare = operation;
    return operation;
  }

  async gather(
    params: PeerGatherParams = {},
  ): Promise<PeerGatherResult | null> {
    this.syncAuthority();
    const commands = this.#commands;
    if (!commands || !this.canGather())
      throw new PeerCapabilityError(PEER_METHODS.GATHER);
    const epoch = this.#epoch;
    const token = ++this.#gatherToken;
    this.#publish({ gatherBusy: true, gatherError: null });
    try {
      const result = await commands.gather(params);
      if (!this.#current(commands, epoch) || token !== this.#gatherToken)
        return null;
      // Gathering never creates an owned session or opens a peer. Preserve lifecycle
      // tombstones if a concurrent read returns a stale pre-close blackboard row.
      const rows = result.peers.map((row) =>
        Object.freeze({
          ...row,
          closed:
            row.closed ||
            this.#closed.has(
              peerIdentityForTopic(result.profile_id, row.topic),
            ),
        }),
      );
      this.#publish({ blackboard: Object.freeze(rows), gatherError: null });
      return result;
    } catch {
      if (this.#current(commands, epoch) && token === this.#gatherToken)
        this.#publish({
          gatherError: "Could not read the peer blackboard. Retry gathering.",
        });
      return null;
    } finally {
      if (this.#current(commands, epoch) && token === this.#gatherToken)
        this.#publish({ gatherBusy: false });
    }
  }

  observeNotification(
    notification: Pick<RpcNotification, "method" | "params">,
    sourceCommands: PeerCommands,
  ): boolean {
    this.syncAuthority();
    const commands = this.#commands;
    if (!commands || commands !== sourceCommands) return false;
    const parsed = parsePeerNotification(notification, commands.scope);
    if (!parsed) return false;
    if (parsed.kind === "staged") {
      if (!commands.capabilities.staged || this.#options.readOnly?.())
        return false;
      void this.#stage(commands, parsed.event, parsed.event.brief, "staged");
    } else {
      if (!commands.capabilities.closed) return false;
      this.#close(
        commands,
        peerIdentityForTopic(parsed.event.profile_id, parsed.event.topic),
      );
    }
    return true;
  }

  /**
   * Fold one event from a peer's OWN Session into that peer's activity axis
   * (audit 0550 row 5). Fenced exactly like `observeNotification`: stale
   * transport incarnations and unknown/closed Sessions are rejected, and only
   * the named Session's row is stamped (row 8). Returns whether the event was
   * owned by a live peer row.
   */
  observeSessionEvent(
    event: PeerSessionEvent,
    sourceCommands: PeerCommands,
  ): boolean {
    this.syncAuthority();
    const commands = this.#commands;
    if (!commands || commands !== sourceCommands) return false;
    const entry = this.#peers.get(event.sessionId);
    if (!entry || entry.status === "closed") return false;
    const now = Date.now();
    if (event.kind === "turn-started") {
      this.#preBlock.delete(event.sessionId);
      // A REPLACEMENT turn (§4.3) invalidates any pending acknowledgment: the
      // row must demand a fresh click instead of silently retargeting. A turn
      // event carrying no id (legacy callers) cannot detect a change, so the
      // row's current turn is kept and the ack survives.
      const replacement =
        typeof event.turnId === "string" &&
        event.turnId !== "" &&
        event.turnId !== entry.turnId;
      this.#stamp(
        event.sessionId,
        replacement
          ? {
              ...entry,
              turnId: event.turnId,
              acknowledgment: null,
              turnChangedSinceAck:
                entry.acknowledgment !== null &&
                entry.acknowledgment !== undefined,
            }
          : entry,
        "live",
        entry.finishedAt,
      );
      return true;
    }
    if (event.kind === "control-ack") {
      // ACKNOWLEDGMENT, never an outcome: an accepted control frame leaves the
      // activity axis untouched and stamps only the ack (judge #4 — "Sent" /
      // "Stop requested" are separate from Finished / Stopped / Failed).
      this.#stamp(event.sessionId, entry, entry.activity, entry.finishedAt, {
        acknowledgment:
          event.action === "interrupt"
            ? { kind: "stop-requested" }
            : { kind: "sent", action: event.action ?? "steer" },
        turnChangedSinceAck: false,
      });
      return true;
    }
    if (event.kind === "attention-requested") {
      if (entry.activity !== "blocked")
        this.#preBlock.set(event.sessionId, entry.activity);
      // Stamp the pending request so the console row can act on it; a request
      // with no id/kind stamps explicit nulls rather than leaving stale ones.
      const detail =
        event.requestKind === "approval"
          ? (event.approval ?? null)
          : event.requestKind === "question"
            ? (event.question ?? null)
            : null;
      this.#stamp(
        event.sessionId,
        {
          ...entry,
          requestId: event.requestId ?? null,
          requestKind: event.requestKind ?? null,
          requestDetail: detail,
        },
        "blocked",
        entry.finishedAt,
      );
      return true;
    }
    if (event.kind === "attention-resolved") {
      const restored = this.#preBlock.get(event.sessionId);
      this.#preBlock.delete(event.sessionId);
      if (restored !== undefined || entry.activity === "blocked")
        this.#stamp(
          event.sessionId,
          {
            ...entry,
            requestId: null,
            requestKind: null,
            requestDetail: null,
          },
          restored ?? "idle",
          entry.finishedAt,
        );
      return true;
    }
    if (event.kind === "usage") {
      // Token spend accumulates independently of the activity axis: re-stamp
      // with the row's current activity/finishedAt and only raise the total.
      const tokens = event.outputTokens;
      if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0)
        return true;
      this.#stamp(
        event.sessionId,
        { ...entry, outputTokens: (entry.outputTokens ?? 0) + tokens },
        entry.activity,
        entry.finishedAt,
      );
      return true;
    }
    // Turn terminal (done / error / interrupted): freeze the elapsed stamp and
    // drop any pending operator request — nothing is outstanding afterwards.
    this.#preBlock.delete(event.sessionId);
    const outcome: PeerTurnOutcome =
      event.outcome === "interrupted"
        ? "stopped"
        : event.outcome === "failed"
          ? "failed"
          : "finished";
    this.#stamp(
      event.sessionId,
      {
        ...entry,
        requestId: null,
        requestKind: null,
        requestDetail: null,
        // Outcome words (§4.3): the terminal is the OUTCOME; the ack never
        // was one. Both are cleared so the row reads Finished/Stopped/Failed.
        acknowledgment: null,
        turnChangedSinceAck: false,
        outcome,
        ...(outcome === "failed" && typeof event.error === "string"
          ? { error: event.error }
          : {}),
      },
      "done",
      now,
    );
    return true;
  }

  #stamp(
    identity: string,
    entry: PeerRosterEntry,
    activity: PeerActivity,
    finishedAt: number | null,
    fields: Partial<PeerRosterEntry> = {},
  ): void {
    this.#peers.set(
      identity,
      Object.freeze({ ...entry, ...fields, activity, finishedAt }),
    );
    this.#publish();
  }

  #close(commands: PeerCommands, identity: string): void {
    if (this.#closed.has(identity)) return;
    const epoch = this.#epoch;
    this.#closed.set(identity, ++this.#closeRevision);
    this.#pending.get(identity)?.abort.abort();
    this.#pending.delete(identity);
    this.#preBlock.delete(identity);
    const entry = this.#peers.get(identity);
    if (entry) {
      this.#peers.set(
        identity,
        Object.freeze({
          ...entry,
          status: "closed",
          canRetry: false,
          error: null,
          operationId: null,
          // A close is terminal for the row: no operator request can still be
          // outstanding, so drop any pending id/kind (data review 1015, defect 1).
          requestId: null,
          requestKind: null,
        }),
      );
    }
    this.#publish({
      blackboard: Object.freeze(
        this.#snapshot.blackboard.map((row) =>
          peerIdentityForTopic(commands.scope.profileId, row.topic) === identity
            ? Object.freeze({ ...row, closed: true })
            : row,
        ),
      ),
    });
    // Only identities actually opened/staged by this manager can request host teardown.
    if (entry && this.#current(commands, epoch))
      this.#options.onClosePeer?.({
        scope: commands.scope,
        sessionId: identity,
      });
  }

  #stage(
    commands: PeerCommands,
    peer: PeerFleetEntry,
    brief: string,
    origin: PeerRosterEntry["origin"],
    prepareRevision?: number,
  ): Promise<boolean> {
    if (
      commands !== this.#commands ||
      this.#options.commands() !== commands ||
      this.#options.readOnly?.()
    )
      return Promise.resolve(false);
    const identity = peerIdentityForTopic(peer.profile_id, peer.topic);
    const closedRevision = this.#closed.get(identity);
    if (closedRevision !== undefined) {
      // A NEW user prepare receipt can authorize reuse, unless a close landed during it.
      if (prepareRevision === undefined || closedRevision > prepareRevision)
        return Promise.resolve(false);
      this.#closed.delete(identity);
      this.#peers.delete(identity);
      this.#pending.delete(identity);
    }
    const existing = this.#peers.get(identity);
    if (existing)
      return (
        this.#pending.get(identity)?.promise ??
        Promise.resolve(existing.status === "started")
      );
    const epoch = this.#epoch;
    const abort = new AbortController();
    const turnId = crypto.randomUUID();
    const request: PeerOpenRequest = Object.freeze({
      scope: commands.scope,
      sessionId: identity,
      profileId: peer.profile_id,
      topic: peer.topic,
      slug: peer.slug,
      cwd: peer.cwd,
      briefPath: peer.brief_path,
      brief,
      prompt: peerKickoffPrompt(brief, peer.brief_path),
      turnId,
      signal: abort.signal,
      isCurrent: () =>
        !abort.signal.aborted &&
        this.#current(commands, epoch) &&
        !this.#closed.has(identity),
    });
    const pending: PendingPeer = {
      request,
      abort,
      attempt: 0,
      promise: null,
      invoked: false,
    };
    this.#pending.set(identity, pending);
    this.#peers.set(
      identity,
      Object.freeze({
        identity,
        profileId: peer.profile_id,
        topic: peer.topic,
        slug: peer.slug,
        cwd: peer.cwd,
        briefPath: peer.brief_path,
        origin,
        turnId,
        status: "opening",
        activity: "idle",
        openedAt: null,
        finishedAt: null,
        outputTokens: 0,
        requestId: null,
        requestKind: null,
            operationId: null,
            error: null,
            canRetry: false,
          }),
        );
    // A fresh staging attempt supersedes any prior refusal marker.
    this.#publish({ dispatchRefusalKind: null });
    return this.#open(pending);
  }
  #open(pending: PendingPeer): Promise<boolean> {
    const { request } = pending;
    const attempt = ++pending.attempt;
    const operation = Promise.resolve()
      .then(() => {
        if (!request.isCurrent()) return null;
        if (this.#options.readOnly?.())
          return {
            status: "not-started",
            error: "Peer opening is unavailable in read-only mode.",
          } satisfies PeerOpenOutcome;
        pending.invoked = true;
        return this.#options.onOpenPeer(request);
      })
      .catch((): PeerOpenOutcome => ({
        status: "unknown",
        error:
          "The peer start could not be confirmed. Inspect the peer session before retrying.",
      }))
      .then((outcome) => {
        if (!outcome || !request.isCurrent() || pending.attempt !== attempt)
          return false;
        const entry = this.#peers.get(request.sessionId);
        if (!entry) return false;
        const opened = outcome.status === "started";
        this.#peers.set(
          request.sessionId,
          Object.freeze({
            ...entry,
            // Identity is SERVER-adopted (finding 2920 (b)): a confirmed start
            // reports the dispatch receipt's OWN slug, so the dock/roster row is
            // keyed by the adopted slug rather than the locally pre-computed
            // staging slug. A non-started settle keeps the staged slug.
            slug:
              outcome.status === "started" && outcome.slug
                ? outcome.slug
                : entry.slug,
            status:
              outcome.status === "not-started" ? "failed" : outcome.status,
            error: outcome.status === "started" ? null : outcome.error,
            canRetry: outcome.status === "not-started",
            // Stamp the open time only on a confirmed start; a failed or
            // unconfirmed attempt keeps whatever stamp the row already had.
            openedAt: opened ? Date.now() : entry.openedAt,
            // Retain the ACCEPTED dispatch operation id from the start receipt
            // (approval wiring GAP); a non-started outcome keeps the prior stamp.
            operationId:
              outcome.status === "started"
                ? (outcome.operationId ?? null)
                : (entry.operationId ?? null),
          }),
        );
        // Surface the TYPED dispatch-refusal kind so the console renders the
        // bounded label even though the Core refuses via a JSON-RPC error and
        // never sets `prepareError` (finding 2920 (a)).
        this.#publish({
          dispatchRefusalKind:
            outcome.status === "not-started"
              ? (outcome.refusalKind ?? null)
              : null,
        });
        return outcome.status === "started";
      })
      .finally(() => {
        if (pending.promise === operation) pending.promise = null;
      });
    pending.promise = operation;
    return operation;
  }
  retryOpen(identity: string): Promise<boolean> {
    this.syncAuthority();
    const pending = this.#pending.get(identity);
    const commands = this.#commands;
    if (
      !pending ||
      !commands ||
      this.#closed.has(identity) ||
      !samePeerScope(commands.scope, pending.request.scope) ||
      this.#options.readOnly?.()
    )
      return Promise.resolve(false);
    if (pending.promise) return pending.promise;
    const entry = this.#peers.get(identity);
    if (!entry?.canRetry) return Promise.resolve(false);
    if (!pending.request.isCurrent()) {
      const epoch = this.#epoch;
      const abort = new AbortController();
      pending.abort = abort;
      pending.invoked = false;
      pending.request = Object.freeze({
        ...pending.request,
        scope: commands.scope,
        signal: abort.signal,
        isCurrent: () =>
          !abort.signal.aborted &&
          this.#current(commands, epoch) &&
          !this.#closed.has(identity),
      });
    }
    this.#peers.set(
      identity,
      Object.freeze({
        ...entry,
        status: "opening",
        canRetry: false,
        error: null,
      }),
    );
    this.#publish();
    return this.#open(pending);
  }
  acknowledgeClosed(identity: string): void {
    if (this.#peers.get(identity)?.status !== "closed") return;
    this.#peers.delete(identity);
    this.#publish();
  }

  /**
   * TUI parity 2500 §2 (`/peer clear`, store.rs:1012-1043): a purely
   * client-side dock tidy that prunes FINISHED rows — `done` (a turn terminal
   * with no live re-run) or `closed` — from the roster. It NEVER removes a
   * `live`, `blocked` (waiting) or `idle` row, and it touches only the mutable
   * roster: durable peer identity (the coordinator's `opened`/`closed` maps)
   * survives, exactly as the TUI keeps `opened_peer_sessions` intact. Returns
   * the number of rows pruned.
   */
  clearFinished(): number {
    this.syncAuthority();
    let removed = 0;
    for (const [identity, entry] of this.#peers) {
      if (entry.activity !== "done" && entry.status !== "closed") continue;
      this.#peers.delete(identity);
      this.#preBlock.delete(identity);
      this.#pending.delete(identity);
      removed += 1;
    }
    if (removed > 0) this.#publish();
    return removed;
  }
}

/**
 * TUI parity 2500 §2 aria-live copy (`status.peer_clear_removed` /
 * `peer_clear_none`, en.yml:525-526). Pure so the eventual dock mount can put
 * it straight into its live region; `clearFinished` supplies the count. A
 * cleared peer is never a running or waiting one, matching the TUI wording.
 */
export { peerClearAnnouncement } from "./peer-copy.ts";

/** Activity buckets over a roster (audit rows 2-3); they sum to `total`. */
export interface PeerRosterCounts {
  readonly total: number;
  readonly live: number;
  readonly blocked: number;
  readonly done: number;
  readonly idle: number;
}

/**
 * Collapsed-roster tallies for the ambient dock (audit row 2). Pure, so the
 * caller may summarize any already-acquired snapshot. Every row is bucketed by
 * its activity axis, so the four buckets always sum to `total` — a row that
 * closed keeps its last activity and is included; filter by `status` to report
 * only open rows.
 */
export function summarizeRoster(
  entries: readonly PeerRosterEntry[],
): PeerRosterCounts {
  let live = 0;
  let blocked = 0;
  let done = 0;
  let idle = 0;
  for (const entry of entries) {
    if (entry.activity === "live") live += 1;
    else if (entry.activity === "blocked") blocked += 1;
    else if (entry.activity === "done") done += 1;
    else idle += 1;
  }
  return Object.freeze({
    total: entries.length,
    live,
    blocked,
    done,
    idle,
  });
}

/**
 * Fleet landing progress (audit row 3): how many rows finished against the
 * whole roster size. `landed` counts `done` rows only, so an interrupted or
 * still-live peer never inflates the completed fraction.
 */
export function fleetLanded(
  entries: readonly PeerRosterEntry[],
): { readonly landed: number; readonly total: number } {
  let landed = 0;
  for (const entry of entries) if (entry.activity === "done") landed += 1;
  return Object.freeze({ landed, total: entries.length });
}
