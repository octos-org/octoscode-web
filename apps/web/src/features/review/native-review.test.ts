import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  OctosUiClient,
  isRecord,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { createHistoryCommands } from "@octos-org/octoscode-client/history";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import { createNativeReviewBinding } from "./native-review.ts";
import { appuiCaps } from "../../test-fixtures/caps.ts";
import {
  UNOBSERVED_RECORD_EVENTS,
  connectedClient,
  openRecord,
} from "../../test-fixtures/connected-client.ts";

const caps: UiProtocolCapabilities = appuiCaps({
  methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.REVIEW_START,
  ],
  features: [CORE_UI_FEATURES.REVIEW_START_V1],
});
async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}
function harness(capabilities = caps) {
  const { client, notifications, start } = connectedClient(
    capabilities,
    (sessionId) => ({
      session_id: sessionId,
      cursor: { stream: sessionId, seq: 1 },
      turns: [],
      messages: [],
    }),
  );
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
    ...UNOBSERVED_RECORD_EVENTS,
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
  const open = (sessionId: string) => openRecord(manager, client, sessionId);
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
