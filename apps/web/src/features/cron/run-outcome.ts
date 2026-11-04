import type { CronJob } from "@octos-org/octoscode-client/cron";
import type {
  HydratedTurn,
  ProjectionEnvelopeV2,
} from "@octos-org/octoscode-client/protocol";

/**
 * How a job's last run went.
 *
 * `last_status: "ok"` only says the Session accepted the delivery: a run whose
 * model call then failed still reports ok. So the outcome comes from the turn
 * that delivery started in the job's Session, and only `undelivered` from the
 * job itself. `unconfirmed` means no such turn could be found.
 */
export type RunOutcome =
  | { kind: "never" }
  | {
      kind: "undelivered";
      at: number | null;
      reason: string | null;
      stopped: boolean;
    }
  | { kind: "pending" | "unconfirmed"; at: number }
  | {
      kind: "running" | "succeeded" | "failed" | "interrupted";
      at: number;
      turnId: string;
    };

/** A turn can start just before the service stamps the delivery it came from. */
const START_TOLERANCE_MS = 1_000;
/** A delivered run normally starts within seconds; past this it left no turn. */
const PENDING_LIMIT_MS = 120_000;
/** A run still going is read again, at most this often. */
const REREAD_MS = 5_000;

function timestamp(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A turn does not record which job started it, so each delivered run claims the
 * first unclaimed turn that started after it, oldest run first. Runs deliver in
 * order, which keeps two jobs on one Session apart. A person's turn started in
 * the moment between a delivery and its turn would be misread as that run.
 */
export function runOutcomes(
  jobs: readonly CronJob[],
  turnsBySession: ReadonlyMap<string, readonly HydratedTurn[]>,
  now: number,
): Map<string, RunOutcome> {
  const outcomes = new Map<string, RunOutcome>();
  const delivered: { job: CronJob; at: number }[] = [];
  for (const job of jobs) {
    const at = timestamp(job.lastRun);
    if (job.lastStatus === "error" || job.lastStatus === "disabled") {
      outcomes.set(job.id, {
        kind: "undelivered",
        at,
        reason: job.lastError ?? null,
        stopped: job.lastStatus === "disabled",
      });
    } else if (at === null) {
      outcomes.set(job.id, { kind: "never" });
    } else {
      delivered.push({ job, at });
    }
  }
  const claimed = new Set<string>();
  delivered.sort((left, right) => left.at - right.at);
  for (const { job, at } of delivered) {
    const turns = job.originSessionId
      ? turnsBySession.get(job.originSessionId)
      : undefined;
    const turn = turns?.find((candidate) => {
      const started = timestamp(candidate.started_at);
      return (
        started !== null &&
        started >= at - START_TOLERANCE_MS &&
        !claimed.has(candidate.turn_id)
      );
    });
    if (turn) claimed.add(turn.turn_id);
    outcomes.set(job.id, outcomeOf(turn, turns !== undefined, at, now));
  }
  return outcomes;
}

function outcomeOf(
  turn: HydratedTurn | undefined,
  turnsKnown: boolean,
  at: number,
  now: number,
): RunOutcome {
  if (!turn) {
    return turnsKnown && now - at < PENDING_LIMIT_MS
      ? { kind: "pending", at }
      : { kind: "unconfirmed", at };
  }
  const turnId = turn.turn_id;
  switch (turn.state) {
    case "active":
    case "interrupting":
      return { kind: "running", at, turnId };
    case "completed":
      return { kind: "succeeded", at, turnId };
    case "errored":
      return { kind: "failed", at, turnId };
    case "interrupted":
      return { kind: "interrupted", at, turnId };
    default:
      return { kind: "unconfirmed", at };
  }
}

export interface SessionTurnsRead {
  /** When this browser read them, by its own clock. */
  readAt: number;
  /** The newest run the read was for, by the server's clock. */
  forRun: number;
}

/**
 * Whether a run needs its Session's turns read (again). A settled run costs
 * nothing, so the list can stay open. The two clocks are never compared: with
 * a browser clock behind the server's, that would read in a tight loop.
 */
export function needsTurnsRead(
  outcome: RunOutcome,
  known: SessionTurnsRead | undefined,
  now: number,
): boolean {
  if (!("at" in outcome) || !outcome.at) return false;
  if (!known || known.forRun < outcome.at) return true;
  return (
    (outcome.kind === "pending" || outcome.kind === "running") &&
    now - known.readAt >= REREAD_MS
  );
}

/** The error a failed turn ended with, without the provider-routing trace. */
export function failureReason(
  envelopes: readonly ProjectionEnvelopeV2[] | undefined,
  turnId: string,
): string | null {
  for (const envelope of envelopes ?? []) {
    if (envelope.turn_id !== turnId) continue;
    if (envelope.payload.type !== "turn_terminal") continue;
    const error = (envelope.payload.data as { error?: { message?: unknown } })
      .error;
    if (typeof error?.message !== "string") return null;
    return error.message.replace(/\s*\[lanes:[\s\S]*$/, "").trim() || null;
  }
  return null;
}
