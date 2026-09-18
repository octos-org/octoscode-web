import { describe, expect, it } from "vitest";
import type { SessionHydrateResult } from "@octos-org/octoscode-client";
import { conversationCheckpoints, resolveCheckpoint } from "./checkpoints.ts";

const thread = (prompts: string[]): SessionHydrateResult => ({
  session_id: "session-a",
  cursor: { stream: "s1", seq: 0 },
  messages: prompts.flatMap((content, index) => [
    {
      seq: index * 2,
      role: "user",
      thread_id: `thread-${index}`,
      content,
      message_id: `user-${index}`,
      persisted_at: "2026-09-06T00:00:00Z",
      media: [],
    },
    {
      seq: index * 2 + 1,
      role: "assistant",
      thread_id: `thread-${index}`,
      content: "answer",
      persisted_at: "2026-09-06T00:00:00Z",
      media: [],
    },
  ]),
});
describe("canonical conversation checkpoints", () => {
  it("counts user-rooted threads once and does not target unthreaded messages", () => {
    const data = thread(["earlier", "target", "additional input"]);
    data.messages![4]!.thread_id = "thread-1";
    data.messages![5]!.thread_id = "thread-1";
    data.messages!.push({
      seq: 6,
      role: "user",
      content: "unthreaded legacy input",
      persisted_at: "2026-09-06T00:00:00Z",
      media: [],
    });
    const rows = conversationCheckpoints(data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      checkpoint: 2,
      prefill: "target",
      userMessageCount: 2,
    });
    expect(resolveCheckpoint(data, rows[0]!)).toEqual({
      numTurns: 1,
      prefill: "target",
    });
    expect(resolveCheckpoint(data, rows[1]!)?.numTurns).toBe(2);
    expect(rows.some((row) => row.prefill.includes("legacy"))).toBe(false);
  });
  it("keeps duplicate prompt rows distinct and lists newest first", () => {
    const rows = conversationCheckpoints(thread(["same", "same", "third"]));
    expect(rows.map((row) => row.checkpoint)).toEqual([3, 2, 1]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(
      resolveCheckpoint(thread(["same", "same", "third"]), rows[1]!),
    ).toEqual({ numTurns: 2, prefill: "same" });
  });
  it("recomputes drop count after more turns arrive, rejects replaced history", () => {
    const selected = conversationCheckpoints(thread(["first", "second"]))[1]!;
    expect(
      resolveCheckpoint(thread(["first", "second", "later"]), selected)
        ?.numTurns,
    ).toBe(3);
    expect(
      resolveCheckpoint(thread(["replaced", "second"]), selected),
    ).toBeNull();
    expect(resolveCheckpoint(thread([]), selected)).toBeNull();
  });
});
