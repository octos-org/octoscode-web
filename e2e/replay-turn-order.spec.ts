/**
 * T-0693 (N4-F01): a reload replays the server truth strictly in ledger order.
 * The override serves the N4 frame shape — per-turn seq restarting at 1 under
 * a session-global cursor — with turn 1 ending in a replay-only tool card that
 * has no durable twin row; it must never land after turn 2's prompt.
 */
import { expect, test } from "@playwright/test";
import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  runFolder,
} from "./fixture-session.ts";
import { productNavigation, selectedSessionId } from "./sessions.ts";

test("a reload never interleaves a later turn's prompt into the earlier turn", async ({
  page,
  request,
}) => {
  await connectAndStartWorkspace(page, runFolder("reload-turn-order"));
  // data-session-id is a composite key; the Session id is its last element.
  const navigation = productNavigation(page);
  const sessionId = JSON.parse(await selectedSessionId(navigation)).at(-1);

  let cursor = 0;
  const t1 = "turn-1";
  const t2 = "turn-2";
  const envelope = (
    turn: string,
    seq: number,
    type: string,
    data: unknown,
  ) => ({
    session_id: sessionId,
    thread_id: turn,
    turn_id: turn,
    seq,
    cursor: { stream: sessionId, seq: ++cursor },
    payload: { type, data },
  });
  const message = (
    seq: number,
    role: string,
    content: string,
    turn: string,
  ) => ({
    seq,
    role,
    content,
    media: [],
    turn_id: turn,
    thread_id: turn,
    persisted_at: "2026-11-26T00:00:00Z",
  });
  await request.post(`${FIXTURE_ORIGIN}/__test__/hydrate/override`, {
    data: {
      session_id: sessionId,
      cursor: { stream: sessionId, seq: 8 },
      messages: [
        message(0, "user", "Summarize the PDF", t1),
        message(1, "assistant", "Reading it now", t1),
        message(2, "user", "Clean this CSV", t2),
        message(3, "assistant", "Cleaned", t2),
      ],
      turns: [
        { turn_id: t1, thread_id: t1, state: "completed" },
        { turn_id: t2, thread_id: t2, state: "completed" },
      ],
      replayed_projection_envelopes: [
        envelope(t1, 1, "user_message", { text: "Summarize the PDF" }),
        envelope(t1, 2, "assistant_delta", { text: "Reading it now" }),
        envelope(t1, 3, "tool_start", {
          tool_call_id: "g1",
          name: "glob",
          arguments_preview: "**/*.pdf",
        }),
        envelope(t1, 4, "tool_end", {
          tool_call_id: "g1",
          status: "complete",
          output_preview: "Found 1 file(s): brief.pdf",
        }),
        envelope(t1, 5, "turn_terminal", { outcome: "completed" }),
        envelope(t2, 1, "user_message", { text: "Clean this CSV" }),
        envelope(t2, 2, "assistant_delta", { text: "Cleaned" }),
        envelope(t2, 3, "turn_terminal", { outcome: "completed" }),
      ],
      projection_thread_sequences: { [t1]: 5, [t2]: 3 },
    },
  });

  await page.reload();
  await expect(page.getByText("Clean this CSV", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const rows = await page
    .locator('[role="log"] > *')
    .evaluateAll((els) => els.map((el) => el.textContent ?? ""));
  const user2 = rows.findIndex((text) => text.includes("Clean this CSV"));
  const turn1Tool = rows.findIndex((text) => text.includes("Found 1 file(s)"));
  expect(user2).toBeGreaterThan(-1);
  expect(turn1Tool).toBeGreaterThan(-1);
  expect(user2).toBeGreaterThan(turn1Tool);
});
