import { useEffect, useState } from "react";
import {
  applyContextNotification,
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

export function useLiveContext(
  client: {
    subscribeNotifications(
      listener: (event: RpcNotification) => void,
    ): () => void;
  } | null,
  sessionId: string | null | undefined,
  opened: ContextSnapshot | null | undefined,
): ContextSnapshot | null {
  const [live, setLive] = useState<ContextSnapshot | null>(null);
  useEffect(() => {
    setLive(null);
    if (!client || !sessionId) return;
    // Unrelated events return the same object, so they cause no render.
    return client.subscribeNotifications((event) =>
      setLive((current) => applyContextNotification(current, event, sessionId)),
    );
  }, [client, sessionId]);
  return pickContext(opened, live, sessionId);
}
