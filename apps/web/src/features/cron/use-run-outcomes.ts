import { useEffect, useMemo, useRef, useState } from "react";
import type { CronJob } from "@octos-org/octoscode-client/cron";
import type {
  HydratedTurn,
  OctosUiClient,
} from "@octos-org/octoscode-client/protocol";
import {
  failureReason,
  needsTurnsRead,
  runOutcomes,
  type RunOutcome,
  type SessionTurnsRead,
} from "./run-outcome.ts";

interface SessionTurns extends SessionTurnsRead {
  turns: readonly HydratedTurn[];
}

/** Reads each job's Session only while its last run is unsettled. */
export function useRunOutcomes(
  client: OctosUiClient,
  jobs: readonly CronJob[] | null,
  now: number,
) {
  const [sessions, setSessions] = useState<ReadonlyMap<string, SessionTurns>>(
    new Map(),
  );
  const [reasons, setReasons] = useState<ReadonlyMap<string, string | null>>(
    new Map(),
  );
  const reading = useRef(new Set<string>());
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    reading.current = new Set();
    setSessions(new Map());
    setReasons(new Map());
  }, [client]);

  const outcomes = useMemo(() => {
    const turns = new Map(
      [...sessions].map(([id, session]) => [id, session.turns]),
    );
    return runOutcomes(jobs ?? [], turns, now);
  }, [jobs, now, sessions]);

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
    const readNow = Date.now();
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
      void client
        .hydrateSession({ session_id: sessionId, include: ["turns"] })
        .then(
          (result) => {
            if (clientRef.current !== client) return;
            setSessions((current) =>
              new Map(current).set(sessionId, {
                turns: result.turns ?? [],
                readAt: readNow,
                forRun,
              }),
            );
          },
          () => {
            // The row stays unconfirmed; the next list refresh reads again.
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
