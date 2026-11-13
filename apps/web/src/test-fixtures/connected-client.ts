import { vi } from "vitest";
import {
  OctosUiClient,
  type RpcNotification,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import type { SessionRecordManager } from "../features/session/session-record-manager.ts";

/**
 * A real `OctosUiClient` that reports itself connected and answers
 * `config/capabilities/list`, `session/open`, `session/hydrate` and
 * `turn/start` from stubs. Notifications are delivered by calling the
 * listeners in `notifications`. Shared by the record-manager tests that
 * drive one record end to end (history, review).
 */
export function connectedClient(
  capabilities: UiProtocolCapabilities,
  hydrate: (sessionId: string) => SessionHydrateResult,
) {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
  const notifications = new Set<(event: RpcNotification) => void>();
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  vi.spyOn(client, "subscribeStatus").mockImplementation((listener) => {
    listener("connected");
    return () => undefined;
  });
  vi.spyOn(client, "subscribeErrors").mockReturnValue(() => undefined);
  vi.spyOn(client, "subscribeNotifications").mockImplementation((listener) => {
    notifications.add(listener);
    return () => {
      notifications.delete(listener);
    };
  });
  vi.spyOn(client, "listConfigCapabilities").mockResolvedValue({
    capabilities,
  });
  vi.spyOn(client, "openSession").mockImplementation(async (params) => ({
    opened: {
      session_id: params.session_id,
      active_profile_id: params.profile_id ?? "coding",
      workspace_root: params.cwd ?? "/srv/project",
      capabilities,
    },
  }));
  vi.spyOn(client, "hydrateSession").mockImplementation(async (params) =>
    hydrate(params.session_id),
  );
  const start = vi.spyOn(client, "startTurn").mockResolvedValue({});
  return { client, notifications, start };
}

/** `SessionRecordManager` callbacks a single-record test does not observe. */
export const UNOBSERVED_RECORD_EVENTS = {
  onSelectedEvent: () => undefined,
  onSelectedSnapshot: () => undefined,
  onBackgroundActivity: () => undefined,
  cursorFor: () => undefined,
  validateServerCapabilities: () => undefined,
  validateSessionCapabilities: () => undefined,
};

/** Opens `sessionId` (profile `coding`, cwd `/srv/project`) on its record. */
export function openRecord(
  manager: SessionRecordManager<OctosUiClient>,
  client: OctosUiClient,
  sessionId: string,
) {
  return manager.openOnRecord(
    {
      endpoint: "ws://server.test/ui",
      token: "",
      sessionId,
      profileId: "coding",
      cwd: "/srv/project",
    },
    client,
    new AbortController().signal,
  );
}
