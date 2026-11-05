import { useEffect, useMemo, useRef, useState } from "react";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import {
  failureReason,
  linksOf,
  needsTurnsRead,
  runKey,
  runOutcomes,
  turnStarters,
  type LinkedOutcome,
  type RunOutcome,
  type SessionTurns,
  type SessionTurnsRead,
} from "./run-outcome.ts";
import { serverNow, type ServerTimeRange } from "./server-clock.ts";

interface SessionRead extends SessionTurns, SessionTurnsRead {
  /** Which read this was; an older answer arriving late is dropped. */
  sequence: number;
}

const steadyNow = () => performance.now();

/**
 * Reads each job's Session only while its last run is unsettled. `tick`
 * re-evaluates on the page's beat; times are the server's (from the list)
 * and this page's steady clock, never this browser's wall clock.
 */
export function useRunOutcomes(
  client: OctosUiClient,
  jobs: readonly CronJob[] | null,
  serverRange: ServerTimeRange | null,
  tick: number,
) {
  const [sessions, setSessions] = useState<ReadonlyMap<string, SessionRead>>(
    new Map(),
  );
  const [reasons, setReasons] = useState<ReadonlyMap<string, string | null>>(
    new Map(),
  );
  const reading = useRef(new Set<string>());
  const sequence = useRef(0);
  const firstSeen = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, LinkedOutcome>());
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    reading.current = new Set();
    firstSeen.current = new Map();
    confirmed.current = new Map();
    setSessions(new Map());
    setReasons(new Map());
  }, [client]);

  const outcomes = useMemo(() => {
    const now = steadyNow();
    for (const job of jobs ?? []) {
      const at = Date.parse(job.lastRun ?? "");
      if (!Number.isFinite(at)) continue;
      const key = runKey(job.id, at);
      if (!firstSeen.current.has(key)) firstSeen.current.set(key, now);
    }
    return runOutcomes(
      jobs ?? [],
      sessions,
      {
        serverEarliest: serverNow(serverRange, now)?.earliest ?? null,
        knownFor: (key) => now - (firstSeen.current.get(key) ?? now),
      },
      confirmed.current,
    );
    // `tick` moves the windows on without a new list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, sessions, serverRange, tick]);

  // A link, once made, stands: later reads may lack what made it.
  useEffect(() => {
    for (const [key, link] of linksOf(jobs ?? [], outcomes))
      confirmed.current.set(key, link);
  }, [jobs, outcomes]);

  useEffect(() => {
    const newestRun = new Map<string, number>();
    for (const job of jobs ?? []) {
      const outcome = outcomes.get(job.id);
      if (job.originSessionId && outcome && "at" in outcome && outcome.at) {
        newestRun.set(
          job.originSessionId,
          Math.max(newestRun.get(job.originSessionId) ?? 0, outcome.at),
        );
      }
    }
    const readNow = steadyNow();
    for (const job of jobs ?? []) {
      const sessionId = job.originSessionId;
      const outcome = outcomes.get(job.id);
      if (
        !sessionId ||
        !outcome ||
        !needsTurnsRead(outcome, sessions.get(sessionId), readNow) ||
        reading.current.has(sessionId)
      )
        continue;
      reading.current.add(sessionId);
      const reader = reading.current;
      const forRun = newestRun.get(sessionId) ?? 0;
      const order = ++sequence.current;
      void client
        .hydrateSession({
          session_id: sessionId,
          // Threads and messages say who opened each turn.
          include: ["turns", "threads", "messages"],
        })
        .then(
          (result) => {
            if (clientRef.current !== client) return;
            setSessions((current) => {
              const previous = current.get(sessionId);
              if (previous && previous.sequence > order) return current;
              return new Map(current).set(sessionId, {
                turns: result.turns ?? [],
                starters: turnStarters(result),
                readAt: readNow,
                forRun,
                sequence: order,
              });
            });
          },
          () => {
            // The row keeps what it knew; the next beat reads again.
          },
        )
        .finally(() => reader.delete(sessionId));
    }
  }, [client, jobs, outcomes, sessions]);

  useEffect(() => {
    for (const job of jobs ?? []) {
      const sessionId = job.originSessionId;
      const outcome = outcomes.get(job.id);
      if (!sessionId || outcome?.kind !== "failed") continue;
      const { turnId } = outcome;
      if (reasons.has(turnId)) continue;
      setReasons((current) => new Map(current).set(turnId, null));
      // Only the full snapshot retains a turn's terminal record.
      void client
        .hydrateSession({
          session_id: sessionId,
          include: ["messages", "turns"],
        })
        .then((result) => {
          if (clientRef.current !== client) return;
          const reason = failureReason(
            result.replayed_projection_envelopes,
            turnId,
          );
          setReasons((current) => new Map(current).set(turnId, reason));
        })
        .catch(() => {
          // The row still says it failed; the Session has the details.
        });
    }
  }, [client, jobs, outcomes, reasons]);

  return { outcomes, reasons } as {
    outcomes: ReadonlyMap<string, RunOutcome>;
    reasons: ReadonlyMap<string, string | null>;
  };
}
