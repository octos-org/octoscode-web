import { describe, expect, it, vi } from "vitest";
import {
  createHistoryCommands,
  parseSnapshotList,
  parseSnapshotRestore,
  parseRollbackResult,
  parseForkResult,
  parseReviewStartResult,
} from "../src/history.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";
const row = {
  id: "checkpoint-1",
  label: "Before patch",
  timestamp_unix: 12345,
};
const turnId = "00000000-0000-4000-8000-000000000001";
const capabilities = (
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: features,
});
describe("conversation and workspace history contracts", () => {
  it("rejects invalid topic bytes and out-of-range u32 counts before dispatch", async () => {
    const request = vi.fn();
    const commands = createHistoryCommands(
      { request },
      "s1",
      capabilities(["session/fork", "session/rollback"]),
    );
    for (const name of [
      "default",
      "DEFAULT",
      "bad:name",
      "bad/name",
      "bad#name",
      "bad\nname",
      "a".repeat(51),
      "中".repeat(17),
    ]) {
      await expect(commands.fork(name)).rejects.toThrow("Invalid");
    }
    await expect(commands.fork("valid", 0x1_0000_0000)).rejects.toThrow(
      "Invalid",
    );
    await expect(commands.rewind(0x1_0000_0000)).rejects.toThrow("positive");
    expect(request).not.toHaveBeenCalled();
  });
  it("distinguishes restore response from listing and availability from enabled", () => {
    expect(
      parseSnapshotList(
        { session_id: "s1", enabled: false, available: true, snapshots: [row] },
        "s1",
      ),
    ).toMatchObject({ enabled: false, available: true });
    expect(
      parseSnapshotRestore(
        { session_id: "s1", restored: row.id, snapshots: [row] },
        "s1",
        row.id,
      ),
    ).toMatchObject({ restored: row.id });
    expect(
      parseSnapshotRestore(
        { session_id: "s2", restored: row.id, snapshots: [row] },
        "s1",
        row.id,
      ),
    ).toBeNull();
    expect(
      parseSnapshotList(
        {
          session_id: "s1",
          enabled: true,
          available: true,
          snapshots: [row, row],
        },
        "s1",
      ),
    ).toBeNull();
  });
  it("accepts only the owning hydrated thread on rewind", () => {
    const thread = {
      session_id: "s1",
      cursor: { stream: "s1", seq: 1 },
      messages: [],
      threads: [],
      turns: [],
      pending_approvals: [],
      pending_questions: [],
    };
    expect(
      parseRollbackResult({ dropped_turns: 1, thread }, "s1"),
    ).toMatchObject({ dropped_turns: 1, thread: { session_id: "s1" } });
    expect(parseRollbackResult({ dropped_turns: 1, thread }, "s2")).toBeNull();
    expect(parseRollbackResult({ dropped_turns: -1, thread }, "s1")).toBeNull();
  });
  it("uses server-created branch identity and native review identity", () => {
    expect(
      parseForkResult(
        { parent_session_id: "s1", new_session_id: "s2", copied_messages: 4 },
        "s1",
      ),
    ).toMatchObject({ new_session_id: "s2" });
    expect(
      parseForkResult(
        { parent_session_id: "s1", new_session_id: "s1", copied_messages: 4 },
        "s1",
      ),
    ).toBeNull();
    const review = {
      accepted: true,
      session_id: "s1",
      turn_id: turnId,
      workflow: "code_review",
      backend: "native",
      agent_count: 3,
    };
    expect(parseReviewStartResult(review, "s1", turnId)).toEqual(review);
    expect(
      parseReviewStartResult({ ...review, backend: "prompt" }, "s1", turnId),
    ).toBeNull();
  });
  it("makes no unsupported or malformed mutation request", async () => {
    const request = vi.fn();
    const absent = createHistoryCommands({ request }, "s1", capabilities([]));
    await expect(absent.restoreSnapshot(row.id)).rejects.toThrow(
      "not advertised",
    );
    await expect(absent.startReview(turnId)).rejects.toThrow("not advertised");
    const commands = createHistoryCommands(
      { request },
      "s1",
      capabilities(["session/rollback", "review/start"]),
    );
    await expect(commands.rewind(0)).rejects.toThrow("positive");
    await expect(commands.startReview(turnId)).rejects.toThrow(
      "not advertised",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
