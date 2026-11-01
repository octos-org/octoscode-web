import type {
  ExecutionEnvironmentResult,
  OctosUiClient,
} from "@octos-org/octoscode-client/protocol";
import { useEffect, useState } from "react";

export type ExecutionEnvironmentState =
  | { status: "loading" }
  | { status: "ready"; result: ExecutionEnvironmentResult }
  | { status: "unavailable" };

/** Read only when the pane is open and both feature and method are advertised.
 * The effect fence keeps a late probe from crossing Session or profile identity. */
export function useExecutionEnvironment({
  client,
  sessionId,
  profileId,
  available,
  enabled,
}: {
  client: OctosUiClient | null;
  sessionId: string | null;
  profileId: string | null;
  available: boolean;
  enabled: boolean;
}): ExecutionEnvironmentState | null {
  const [state, setState] = useState<ExecutionEnvironmentState | null>(null);
  useEffect(() => {
    if (!enabled || !available || !client || !sessionId) {
      setState(null);
      return;
    }
    let current = true;
    setState({ status: "loading" });
    void client
      .readExecutionEnvironment({
        session_id: sessionId,
        ...(profileId ? { profile_id: profileId } : {}),
      })
      .then((result) => {
        if (current) setState({ status: "ready", result });
      })
      .catch(() => {
        if (current) setState({ status: "unavailable" });
      });
    return () => {
      current = false;
    };
  }, [available, client, enabled, profileId, sessionId]);
  return state;
}
