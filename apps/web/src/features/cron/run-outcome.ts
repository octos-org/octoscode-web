import type { CronJob } from "@octos-org/octoscode-client/cron";
import type {
  HydratedMessage,
  HydratedTurn,
  ProjectionEnvelopeV2,
} from "@octos-org/octoscode-client/protocol";

/**
 * How a job's last run went.
 *
 * `last_status: "ok"` only says the Session accepted the delivery: a run whose
 * model call then failed still reports ok. So the outcome comes from the turn
 * that delivery started in the job's Session, and only `undelivered` from the
 * job itself.
 *
 * Core records no link from a run to its turn, so a turn is only taken as a
 * run's when nothing else fits: a turn the server started (never one a person
 * started), beginning within seconds of the run, that no other run could
 * claim. Anything less certain is `unlinked`, with why; `unconfirmed` means
 * the Session's turns could not be read at all.
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
      kind: "unlinked";
      at: number;
      /**
       * `no-turn`: the server started no turn after the run (a reminder that
       * only delivers its text does this). `ambiguous`: more than one run or
       * turn could match. `late`: a turn started, but too long after the run
       * to say it was this one.
       */
      why: "no-turn" | "ambiguous" | "late";
    }
  | {
      kind: "running" | "succeeded" | "failed" | "interrupted";
      at: number;
      turnId: string;
    };

/** An outcome tied to one turn. */
export type LinkedOutcome = Extract<RunOutcome, { turnId: string }>;

/** A turn can start just before the service stamps the delivery it came from. */
export const START_TOLERANCE_MS = 1_000;
/**
 * A delivered run starts its turn within seconds on an idle Session: Core
 * b95e756f admitted it 0.9 to 1.7 s after the run in the T-0369 walks (its
 * continuation tick is about 2 s). A turn later than this may be anyone's,
 * and two runs closer than this on one Session cannot be told apart.
 */
export const LINK_WINDOW_MS = 15_000;
/** A turn later than the window, but before this, may be the run's, late. */
const LATE_LIMIT_MS = 10 * 60_000;
/** A run still going is read again, at most this often. */
const REREAD_MS = 5_000;

function timestamp(value: string | null | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

/** Who started a turn: a person (it opens with their message) or the server. */
export type TurnStarter = "person" | "system";

/**
 * Reads who started each turn from a hydrate with `threads` and `messages`.
 * A person's turn opens with their message; a scheduled run's prompt is not
 * kept as a message, so its thread opens with the reply. A turn whose opening
 * cannot be read is left out, and treated as possibly anyone's.
 */
export function turnStarters(result: {
  turns?: readonly HydratedTurn[] | undefined;
  threads?: readonly unknown[] | undefined;
  messages?: readonly HydratedMessage[] | undefined;
}): Map<string, TurnStarter> {
  const roles = new Map<number, string>();
  const personTurns = new Set<string>();
  for (const message of result.messages ?? []) {
    roles.set(message.seq, message.role);
    if (message.role === "user" && message.turn_id)
      personTurns.add(message.turn_id);
  }
  const threadStarter = new Map<string, TurnStarter>();
  for (const thread of result.threads ?? []) {
    if (typeof thread !== "object" || thread === null) continue;
    const { thread_id: id, root_seq: root } = thread as {
      thread_id?: unknown;
      root_seq?: unknown;
    };
    if (typeof id !== "string" || typeof root !== "number") continue;
    const role = roles.get(root);
    if (role) threadStarter.set(id, role === "user" ? "person" : "system");
  }
  const starters = new Map<string, TurnStarter>();
  for (const turn of result.turns ?? []) {
    if (personTurns.has(turn.turn_id)) {
      starters.set(turn.turn_id, "person");
      continue;
    }
    const starter = threadStarter.get(turn.thread_id ?? turn.turn_id);
    if (starter) starters.set(turn.turn_id, starter);
  }
  return starters;
}

export interface SessionTurns {
  readonly turns: readonly HydratedTurn[];
  readonly starters: ReadonlyMap<string, TurnStarter>;
}

export interface RunTiming {
  /**
   * The earliest the server's clock can be now, from `cron/list`, or null
   * when no job gives it away. Never this browser's clock.
   */
  readonly serverEarliest: number | null;
  /** How long this page has known about a run, by its own steady clock. */
  knownFor(key: string): number;
}

/** One run of one job: the job and the server time it ran. */
export function runKey(jobId: string, at: number): string {
  return `${jobId}@${at}`;
}

/**
 * The window a run's turn must start in has passed, by the server's clock
 * (from the list, or a turn the server started after it), or by the time
 * this page has known about the run.
 */
function windowClosed(
  at: number,
  key: string,
  turns: readonly HydratedTurn[],
  timing: RunTiming,
): boolean {
  const end = at + LINK_WINDOW_MS;
  if (timing.serverEarliest !== null && timing.serverEarliest > end)
    return true;
  if (turns.some((turn) => (timestamp(turn.started_at) ?? -Infinity) > end))
    return true;
  return timing.knownFor(key) > LINK_WINDOW_MS + START_TOLERANCE_MS;
}

/**
 * Outcomes for every job. `confirmed` holds links already made, by run key,
 * with their last known outcome: they stand even when a later read lacks the
 * fields that made them, and their turns are never offered to another run.
 */
export function runOutcomes(
  jobs: readonly CronJob[],
  sessions: ReadonlyMap<string, SessionTurns>,
  timing: RunTiming,
  confirmed: ReadonlyMap<string, LinkedOutcome> = new Map(),
): Map<string, RunOutcome> {
  const outcomes = new Map<string, RunOutcome>();
  const delivered: { job: CronJob; at: number; session: string | null }[] = [];
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
      delivered.push({ job, at, session: job.originSessionId ?? null });
    }
  }
  const taken = new Set([...confirmed.values()].map((link) => link.turnId));
  const inWindow = (at: number, started: number | null) =>
    started !== null &&
    started >= at - START_TOLERANCE_MS &&
    started <= at + LINK_WINDOW_MS;

  for (const { job, at, session } of delivered) {
    const known = session ? sessions.get(session) : undefined;
    const key = runKey(job.id, at);
    const linked = confirmed.get(key);
    if (linked) {
      const turn = known?.turns.find((each) => each.turn_id === linked.turnId);
      // A read that no longer lists the turn, or its state, keeps what was known.
      outcomes.set(job.id, outcomeOf(turn, linked.turnId, at) ?? linked);
      continue;
    }
    if (!known) {
      outcomes.set(job.id, { kind: "unconfirmed", at });
      continue;
    }
    const rivals = delivered.filter(
      (other) => other.job !== job && other.session === session,
    );
    // Turns that could be this run's: not a person's, not already linked,
    // started in the window. A turn whose starter is unknown might be either.
    const near = known.turns.filter(
      (turn) =>
        !taken.has(turn.turn_id) &&
        known.starters.get(turn.turn_id) !== "person" &&
        inWindow(at, timestamp(turn.started_at)),
    );
    const system = near.filter(
      (turn) => known.starters.get(turn.turn_id) === "system",
    );
    const contested = system.some((turn) =>
      rivals.some((other) => inWindow(other.at, timestamp(turn.started_at))),
    );
    if (system.length === 1 && near.length === 1 && !contested) {
      const turn = system[0]!;
      outcomes.set(
        job.id,
        outcomeOf(turn, turn.turn_id, at) ?? { kind: "unconfirmed", at },
      );
      continue;
    }
    if (near.length > 0) {
      outcomes.set(job.id, { kind: "unlinked", at, why: "ambiguous" });
      continue;
    }
    if (!windowClosed(at, key, known.turns, timing)) {
      outcomes.set(job.id, { kind: "pending", at });
      continue;
    }
    // A turn after the window, before the Session's next run and not long
    // after, that no other run accounts for may be this run's, late.
    const until = Math.min(
      at + LATE_LIMIT_MS,
      ...rivals.filter((other) => other.at > at).map((other) => other.at),
    );
    const later = known.turns.some((turn) => {
      const started = timestamp(turn.started_at);
      return (
        started !== null &&
        started > at + LINK_WINDOW_MS &&
        started < until &&
        !taken.has(turn.turn_id) &&
        known.starters.get(turn.turn_id) !== "person" &&
        !rivals.some((other) => inWindow(other.at, started))
      );
    });
    outcomes.set(job.id, {
      kind: "unlinked",
      at,
      why: later ? "late" : "no-turn",
    });
  }
  return outcomes;
}

function outcomeOf(
  turn: HydratedTurn | undefined,
  turnId: string,
  at: number,
): LinkedOutcome | null {
  switch (turn?.state) {
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
      return null;
  }
}

/** Every outcome that names a turn, by run key. */
export function linksOf(
  jobs: readonly CronJob[],
  outcomes: ReadonlyMap<string, RunOutcome>,
): Map<string, LinkedOutcome> {
  const links = new Map<string, LinkedOutcome>();
  for (const job of jobs) {
    const outcome = outcomes.get(job.id);
    if (outcome && "turnId" in outcome)
      links.set(runKey(job.id, outcome.at), outcome);
  }
  return links;
}

export interface SessionTurnsRead {
  /** When this page read them, by its own steady clock (`performance.now()`). */
  readAt: number;
  /** The newest run the read was for, by the server's clock. */
  forRun: number;
}

/**
 * Whether a run needs its Session's turns read (again). A settled run costs
 * nothing, so the list can stay open. The server's run times are only ever
 * compared with each other, and read times only with this page's steady
 * clock, so no clock difference can make it read in a loop.
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
