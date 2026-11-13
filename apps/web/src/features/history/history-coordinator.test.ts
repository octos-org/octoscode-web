import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  OctosUiClient,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { APPUI_SNAPSHOT_METHODS } from "@octos-org/octoscode-client/history";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import { conversationCheckpoints } from "./checkpoints.ts";
import {
  createHistoryBinding,
  type HistoryCommands,
} from "./history-binding.ts";
import { HistoryCoordinator } from "./history-coordinator.ts";
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
    CORE_UI_METHODS.SESSION_ROLLBACK,
    CORE_UI_METHODS.SESSION_FORK,
    CORE_UI_METHODS.TURN_START,
    APPUI_SNAPSHOT_METHODS.LIST,
    APPUI_SNAPSHOT_METHODS.RESTORE,
  ],
});
const A = "coding:local:A";
function thread(
  sessionId: string,
  prompts = ["earlier", "target"],
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 10 },
    turns: [],
    messages: prompts.map((content, index) => ({
      seq: index,
      role: "user",
      thread_id: `thread-${index}`,
      message_id: `message-${index}`,
      content,
      persisted_at: "2026-09-06T00:00:00Z",
      media: [],
    })),
  };
}

/** Real client public-method spies; real record manager/runtime/controller/queue. */
function harness(capabilities = caps) {
  const histories = new Map<string, SessionHydrateResult>();
  const { client } = connectedClient(
    capabilities,
    (sessionId) => histories.get(sessionId) ?? thread(sessionId),
  );
  const pool = { client, epoch: 1, allowStart: true };
  const commandsBySession = new Map<string, HistoryCommands>();
  function commandsFor(sessionId: string) {
    let commands = commandsBySession.get(sessionId);
    if (commands) return commands;
    commands = {
      listSnapshots: vi.fn(async () => ({
        session_id: sessionId,
        enabled: true,
        available: true,
        snapshots: [
          { id: "snapshot-1", label: "Before edit", timestamp_unix: 1 },
        ],
      })),
      restoreSnapshot: vi.fn(async (snapshotId: string) => ({
        session_id: sessionId,
        restored: snapshotId,
        snapshots: [],
      })),
      rewind: vi.fn(async (numTurns: number) => {
        const prior = histories.get(sessionId) ?? thread(sessionId);
        const next = {
          ...prior,
          messages: prior.messages?.slice(0, -numTurns) ?? [],
        };
        histories.set(sessionId, next);
        return { dropped_turns: numTurns, thread: next };
      }),
      fork: vi.fn(async (name: string) => {
        const child = `coding:local:${name}`;
        const prior = histories.get(sessionId) ?? thread(sessionId);
        histories.set(child, {
          ...prior,
          session_id: child,
          cursor: { stream: child, seq: 10 },
        });
        return {
          parent_session_id: sessionId,
          new_session_id: child,
          copied_messages: prior.messages?.length ?? 0,
        };
      }),
      startReview: vi.fn(async () => {
        throw new Error("Review is outside history");
      }),
    };
    commandsBySession.set(sessionId, commands);
    return commands;
  }
  const factory = vi
    .spyOn(client, "historyCommands")
    .mockImplementation(async (sessionId) => commandsFor(sessionId));
  let manager: SessionRecordManager<OctosUiClient>;
  manager = new SessionRecordManager({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    ...UNOBSERVED_RECORD_EVENTS,
    controllerDependencies: (scope, recordClient) => {
      const ready = () =>
        manager.get(scope)?.runtime.getSnapshot().phase === "ready";
      return {
        client: recordClient,
        sessionId: () => scope.sessionId,
        canEnqueue: ready,
        canStart: () => ready() && pool.allowStart,
        canInterrupt: ready,
        setTimeline: () => {
          throw new Error("Escaped record reducer");
        },
        setConnectionError: () => undefined,
      };
    },
  });
  const open = (sessionId: string) => openRecord(manager, client, sessionId);
  return { pool, factory, commandsFor, manager, open };
}

describe("record-scoped history coordinator", () => {
  it("blocks active and queued work before sending any history RPC", async () => {
    const h = harness();
    const record = await h.open(A);
    h.pool.allowStart = false;
    record.controller.enqueueTurn({ turnId: "first", text: "first" });
    record.controller.enqueueTurn({ turnId: "second", text: "second" });
    const before = record.queue.snapshot();
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    await coordinator.apply({
      mode: "rewind",
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    });
    expect(h.factory).not.toHaveBeenCalled();
    expect(record.queue.snapshot()).toEqual(before);
    expect(coordinator.getSnapshot().error).toContain("queued prompts");
  });

  it("does not replay an ambiguous rollback, even on repeated confirm", async () => {
    const h = harness();
    const record = await h.open(A);
    vi.mocked(h.commandsFor(A).rewind).mockRejectedValue(
      new Error("response lost"),
    );
    const coordinator = new HistoryCoordinator(
      createHistoryBinding({ manager: h.manager, record }),
      "rewind",
    );
    const selection = {
      mode: "rewind" as const,
      checkpoint: conversationCheckpoints(thread(A))[0]!,
    };
    await coordinator.apply(selection);
    await coordinator.apply(selection);
    expect(h.commandsFor(A).rewind).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot()).toMatchObject({
      uncertain: true,
      completed: false,
    });
  });
});
