import type { CronJob } from "@octos-org/octoscode-client/cron";

/**
 * The server's clock, as far as `cron/list` gives it away. Each job carries
 * `next_run` (server ms) and `next_in`, which the server worked out from its
 * own now and rounded down ("42s", "5m", "2h 5m", "overdue"). Together they
 * pin the server's now to a range without trusting this browser's clock.
 */
export interface ServerTimeRange {
  /** The server's now is at least this, when the list was read. */
  readonly earliest: number;
  /** ...and at most this. */
  readonly latest: number;
  /** `performance.now()` when the list arrived; the range moves with it. */
  readonly readAt: number;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** What `next_in` says is left, and how much it may have rounded away. */
export function parseNextIn(
  nextIn: string | null | undefined,
): { left: number; rounding: number } | "overdue" | null {
  const text = nextIn?.trim() ?? "";
  if (text === "overdue") return "overdue";
  let match = /^(\d+)s$/u.exec(text);
  if (match) return { left: Number(match[1]) * SECOND, rounding: SECOND - 1 };
  match = /^(\d+)m$/u.exec(text);
  if (match) return { left: Number(match[1]) * MINUTE, rounding: MINUTE - 1 };
  match = /^(\d+)h (\d+)m$/u.exec(text);
  if (match)
    return {
      left: Number(match[1]) * HOUR + Number(match[2]) * MINUTE,
      rounding: MINUTE - 1,
    };
  return null;
}

/** The narrowest range every job in one list agrees on, or null. */
export function serverTimeRange(
  jobs: readonly CronJob[],
  readAt: number,
): ServerTimeRange | null {
  let earliest = -Infinity;
  let latest = Infinity;
  for (const job of jobs) {
    if (typeof job.nextRun !== "number" || !Number.isFinite(job.nextRun))
      continue;
    const left = parseNextIn(job.nextIn);
    if (left === "overdue") {
      earliest = Math.max(earliest, job.nextRun);
    } else if (left) {
      earliest = Math.max(earliest, job.nextRun - left.left - left.rounding);
      latest = Math.min(latest, job.nextRun - left.left);
    }
  }
  if (!Number.isFinite(earliest) || earliest > latest) return null;
  return { earliest, latest, readAt };
}

/** The range as it stands now, moved on by the time that has passed here. */
export function serverNow(
  range: ServerTimeRange | null,
  monotonicNow: number,
): { earliest: number; latest: number } | null {
  if (!range) return null;
  const passed = Math.max(0, monotonicNow - range.readAt);
  return {
    earliest: range.earliest + passed,
    latest: range.latest + passed,
  };
}

/**
 * A now to show times against: this browser's clock while it agrees with the
 * server's, and the nearest edge of the server's range when it does not. A
 * browser an hour off then still says "5 min ago" for a run five minutes old.
 * Null when the list does not pin the server's clock from both sides (every
 * job turned off, say): then times are shown as dates, which no clock
 * difference can make wrong.
 */
export function displayNow(
  range: ServerTimeRange | null,
  wallNow: number,
  monotonicNow: number,
): number | null {
  const server = serverNow(range, monotonicNow);
  if (!server || !Number.isFinite(server.latest)) return null;
  return Math.min(Math.max(wallNow, server.earliest), server.latest);
}
