import { useEffect, useState } from "react";
import {
  applyContextNotification,
  parseTokenCostUpdate,
  type ContextSnapshot,
  type RpcNotification,
} from "@octos-org/octoscode-client/protocol";

/**
 * The session's context as the server last described it. `session/status/read`
 * gives the value when the session opened; `context/*` notifications keep it
 * moving during and after turns. The newer generation wins; at the same
 * generation the notification wins, since it came later.
 */
export function pickContext(
  opened: ContextSnapshot | null | undefined,
  live: ContextSnapshot | null,
  sessionId: string | null | undefined,
): ContextSnapshot | null {
  if (!sessionId) return null;
  const seed = opened?.state.session_id === sessionId ? opened : null;
  const latest = live?.state.session_id === sessionId ? live : null;
  if (!latest) return seed;
  if (!seed) return latest;
  return latest.state.generation >= seed.state.generation ? latest : seed;
}

/** What the server has said about one session since this page connected. */
export interface SessionContextFacts {
  readonly context: ContextSnapshot | null;
  /** The model's context window from the session's last usage report. */
  readonly window: number | null;
}

const NO_FACTS: SessionContextFacts = { context: null, window: null };

/** Enough for every session a person switches between; the oldest goes first. */
export const REMEMBERED_SESSIONS = 32;

/**
 * Folds one notification into the per-session record. Unrelated events return
 * the same map, so they cause no render. Memory only: nothing here is stored.
 */
export function rememberContext(
  known: ReadonlyMap<string, SessionContextFacts>,
  event: RpcNotification,
): ReadonlyMap<string, SessionContextFacts> {
  const usage = parseTokenCostUpdate(event);
  const sessionId =
    usage?.sessionId ??
    (event.method.startsWith("context/") &&
    typeof event.params === "object" &&
    event.params !== null &&
    "session_id" in event.params &&
    typeof event.params.session_id === "string"
      ? event.params.session_id
      : null);
  if (!sessionId) return known;
  const previous = known.get(sessionId) ?? NO_FACTS;
  const window =
    usage?.contextWindow !== undefined && usage.contextWindow > 0
      ? usage.contextWindow
      : previous.window;
  const context = usage
    ? previous.context
    : applyContextNotification(previous.context, event, sessionId);
  if (window === previous.window && context === previous.context) return known;
  const next = new Map(known);
  next.delete(sessionId);
  next.set(sessionId, { context, window });
  if (next.size > REMEMBERED_SESSIONS) next.delete(next.keys().next().value!);
  return next;
}

/**
 * The open session's context and window. Facts are kept per session for as
 * long as the page stays on one server, so leaving a session and coming back
 * shows its latest report, not the older value read when it reopened.
 */
export function useLiveContext(
  client: {
    subscribeNotifications(
      listener: (event: RpcNotification) => void,
    ): () => void;
  } | null,
  sessionId: string | null | undefined,
  opened: ContextSnapshot | null | undefined,
): { snapshot: ContextSnapshot | null; window: number | null } {
  const [known, setKnown] = useState<ReadonlyMap<string, SessionContextFacts>>(
    () => new Map(),
  );
  useEffect(() => {
    setKnown(new Map());
    if (!client) return;
    return client.subscribeNotifications((event) =>
      setKnown((current) => rememberContext(current, event)),
    );
  }, [client]);
  const facts = (sessionId && known.get(sessionId)) || NO_FACTS;
  return {
    snapshot: pickContext(opened, facts.context, sessionId),
    window: sessionId ? facts.window : null,
  };
}
