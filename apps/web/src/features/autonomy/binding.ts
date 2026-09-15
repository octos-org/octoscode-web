import type {
  OctosUiClient,
  RpcNotification,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { SessionAutonomyCommands } from "./client-contract.ts";

export type AutonomyClient = Pick<
  OctosUiClient,
  "autonomyCommands" | "subscribeNotifications"
>;

/** Resolve once per authority. No network/model mutations are performed here. */
export function loadAutonomyCommands(
  client: AutonomyClient,
  sessionId: string,
  capabilities: UiProtocolCapabilities,
  accept: (commands: SessionAutonomyCommands) => void,
  fail: () => void,
): () => void {
  let active = true;
  void client
    .autonomyCommands(sessionId, capabilities)
    .then((commands) => {
      if (!active) return;
      if (commands.sessionId !== sessionId) {
        fail();
        return;
      }
      accept(commands);
    })
    .catch(() => {
      if (active) fail();
    });
  return () => {
    active = false;
  };
}

/** Subscribe before refresh. Each effect owns its own irreversible fence;
 * a later StrictMode effect must not reactivate an old source callback. */
export function bindAutonomyNotifications(
  client: AutonomyClient,
  observe: (notification: RpcNotification) => void,
  refresh: () => Promise<void>,
): () => void {
  let active = true;
  const unsubscribe = client.subscribeNotifications((notification) => {
    if (active) observe(notification);
  });
  // Store.refresh owns family-specific read errors and stale-response guards.
  void refresh();
  return () => {
    active = false;
    unsubscribe();
  };
}
