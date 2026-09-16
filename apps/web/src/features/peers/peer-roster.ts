/**
 * Peer roster shape and the empty snapshot.
 *
 * `peer-manager.ts` owns the live manager: event folding, dispatch, retries.
 * The shell only needs the row shape and the empty snapshot to render a dock
 * with no peers, so those live here as a leaf module and the manager itself
 * stays behind `lazy-peer-manager.ts`.
 */
import type {
  PeerGatherEntry,
  PeerScope,
} from "@octos-org/octoscode-client/peers";

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
export type PeerControlAckAction =
  "steer" | "interrupt" | "answer" | "approval";

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
    Readonly<PeerApprovalDetail> | Readonly<PeerQuestionDetail> | null;
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
