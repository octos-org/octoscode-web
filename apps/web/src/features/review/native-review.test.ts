import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  OctosUiClient,
  isRecord,
  type RpcNotification,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { createHistoryCommands } from "@octos-org/octoscode-client/history";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import { createNativeReviewBinding } from "./native-review.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.REVIEW_START,
  ],
  supported_notifications: [],
  supported_features: [CORE_UI_FEATURES.REVIEW_START_V1],
};
async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
function harness(capabilities = caps) {
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
      active_profile_id: "coding",
      workspace_root: "/srv/project",
      capabilities,
    },
  }));
  vi.spyOn(client, "hydrateSession").mockImplementation(async (params) => ({
    session_id: params.session_id,
    cursor: { stream: params.session_id, seq: 1 },
    turns: [],
    messages: [],
  }));
  const start = vi.spyOn(client, "startTurn").mockResolvedValue({});
  const rpc = vi.fn(async (method: string, params: unknown) => {
    if (method !== CORE_UI_METHODS.REVIEW_START || !isRecord(params))
      throw new Error("Unexpected review RPC");
    return {
      accepted: true,
      session_id: params.session_id,
      turn_id: params.turn_id,
      workflow: "code_review",
      backend: "native",
      agent_count: 3,
    };
  });
  const factory = vi
    .spyOn(client, "historyCommands")
    .mockImplementation(async (sessionId, confirmedCaps) =>
      createHistoryCommands({ request: rpc }, sessionId, confirmedCaps),
    );
  let manager: SessionRecordManager<OctosUiClient>;
  manager = new SessionRecordManager({
    pooledClient: () => client,
    authorityEpoch: () => 1,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: () => undefined,
    validateSessionCapabilities: () => undefined,
    controllerDependencies: (scope, recordClient) => ({
      client: recordClient,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline: () => {
        throw new Error("Escaped record reducer");
      },
      setConnectionError: () => undefined,
      async startReview(request) {
        const record = manager.get(scope);
        const authority = record?.runtime.currentAuthority();
        if (
          !record ||
          !authority?.capabilities ||
          authority.client !== request.client ||
          scope.sessionId !== request.sessionId
        )
          throw new Error("Review record unavailable");
        const commands = await request.client.historyCommands(
          request.sessionId,
          authority.capabilities,
        );
        if (
          !request.isCurrent() ||
          !record.runtime.isCurrent(authority) ||
          manager.get(scope) !== record
        )
          throw new Error("Review authority changed");
        request.markSent();
        return commands.startReview(request.turnId, request.prompt);
      },
    }),
  });
  const open = (sessionId: string) =>
    manager.openOnRecord(
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
  return { client, manager, factory, rpc, start, open, notifications };
}

describe("native review confirmed-record binding", () => {
  it("shares the real record FIFO and drains ordinary prompts on review terminal", async () => {
    const h = harness();
    const a = await h.open("coding:local:A");
    const b = await h.open("coding:local:B");
    h.manager.select(b.scope);
    const turnId = createNativeReviewBinding({
      manager: h.manager,
      record: a,
    }).start("");
    a.controller.enqueueTurn({ turnId: "next", text: "follow up" });
    await flush();
    expect(h.start).not.toHaveBeenCalled();
    for (const listener of h.notifications)
      listener({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.TURN_COMPLETED,
        params: { session_id: a.scope.sessionId, turn_id: turnId },
      });
    await flush();
    expect(h.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        session_id: a.scope.sessionId,
        turn_id: "next",
      }),
    );
    expect(h.manager.selected()).toBe(b);
    expect(a.controller.snapshot().active?.turnId).toBe("next");
  });
});
