import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { FIXTURE_ORIGIN, connectAndStartWorkspace } from "./fixture-session.ts";
import {
  composer,
  newSessionIn,
  productNavigation,
  selectSession,
  selectedSessionId,
  sendPrompt,
} from "./sessions";
import { observeFrames, type WireFrame } from "./turn-observers";

const APPROVAL_TITLE = "Run product checks?";
const QUESTION_TITLE = "Choose verification depth";

// v0.10.0's QueuedPrompts replaced our pre-rebase `.prompt-queue` div with
// `<section aria-label="Queued prompts">` under CSS-module class names
// (apps/web/src/features/composer/QueuedPrompts.tsx:14). Target the accessible
// name — the stable contract — never a module-hashed class.
const promptQueue = (page: Page) =>
  page.getByRole("region", { name: "Queued prompts" });

type Frames = ReturnType<typeof observeFrames>;

/** Every approval/respond and user_question/respond frame sent, in order. */
const responds = (frames: Frames): WireFrame[] =>
  frames.sent.filter(
    (frame) =>
      frame.method === "approval/respond" ||
      frame.method === "user_question/respond",
  );

async function injectScopeProbe(
  request: APIRequestContext,
  page: Page,
  sessionId: string,
  event: string,
) {
  const query = new URLSearchParams({ session_id: sessionId, event });
  expect(
    (
      await request.post(`${FIXTURE_ORIGIN}/__test__/scope/inject?${query}`)
    ).status(),
  ).toBe(204);
  await expect(
    page.getByText(`Scope ownership barrier: ${event}`, { exact: true }),
  ).toBeVisible();
}

interface PendingQuestion {
  sessionId: string;
  questionId: string;
  turnId: string;
}

/**
 * Take the next not-yet-seen `user_question/requested` frame off the wire.
 * Requires an exact `method` match, all three ids present/non-empty/typed,
 * and that the captured (session_id, turn_id) pair is backed by EXACTLY ONE
 * real observed `turn/start` from the probe — uniqueness of ids alone is not
 * accepted as evidence of ownership.
 */
async function nextPendingQuestion(
  frames: Frames,
  seen: Set<string>,
): Promise<PendingQuestion> {
  const fresh = (): WireFrame[] =>
    frames
      .events("user_question/requested")
      .filter(
        (frame) =>
          typeof frame.params?.question_id === "string" &&
          !seen.has(frame.params.question_id),
      );
  await expect.poll(() => fresh().length).toBeGreaterThan(0);
  const frame = fresh()[0]!;
  const sessionId: unknown = frame.params?.session_id;
  const questionId: unknown = frame.params?.question_id;
  const turnId: unknown = frame.params?.turn_id;
  if (
    typeof sessionId !== "string" ||
    typeof questionId !== "string" ||
    typeof turnId !== "string" ||
    sessionId.length === 0 ||
    questionId.length === 0 ||
    turnId.length === 0
  ) {
    throw new Error(
      "Expected non-empty typed session_id, question_id and turn_id",
    );
  }
  // The question must be owned by a real turn the client actually started:
  // exactly one observed turn/start carries this (session_id, turn_id).
  const owningStarts = frames
    .calls("turn/start")
    .filter(
      (start) =>
        start.params?.session_id === sessionId &&
        start.params.turn_id === turnId,
    );
  expect(owningStarts).toHaveLength(1);
  seen.add(questionId);
  return { sessionId, questionId, turnId };
}

test("rejects same-base foreign-topic approval and terminal traffic without settling or poisoning the ordinary owner", async ({
  page,
  request,
}) => {
  const probe = observeFrames(page);
  await connectAndStartWorkspace(page, "/srv/work/topic-scope-approval");
  await expect(composer(page)).toBeEnabled();
  await sendPrompt(page, "Topic scope approval fixture");
  await expect.poll(() => probe.calls("turn/start").length).toBe(1);
  const { session_id: sessionId, turn_id: turnId } =
    probe.calls("turn/start")[0]!.params!;
  expect(typeof sessionId).toBe("string");
  expect(typeof turnId).toBe("string");
  if (typeof sessionId !== "string" || typeof turnId !== "string")
    throw new Error("Expected exact native owner identity");
  expect(sessionId).not.toContain("#");
  await sendPrompt(page, "Continue after the genuine owner interaction");
  await expect(promptQueue(page).locator("strong")).toHaveText("1 queued");
  const hydrationCount = probe.calls("session/hydrate").length;
  const ownerDialog = page.getByRole("dialog", {
    name: APPROVAL_TITLE,
  });
  const foreignDialog = page.getByRole("dialog", {
    name: "Foreign-topic approval must stay hidden",
  });

  await injectScopeProbe(request, page, sessionId, "foreign-request");
  await expect(foreignDialog).toHaveCount(0);
  await expect(ownerDialog).toHaveCount(0);
  expect(responds(probe)).toHaveLength(0);
  expect(probe.calls("turn/start")).toHaveLength(1);

  await injectScopeProbe(request, page, sessionId, "owner-request");
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-resolution");
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-cursor");
  expect(probe.calls("session/hydrate")).toHaveLength(hydrationCount);
  await expect(
    page.getByText("FOREIGN_TOPIC_OUTPUT_MUST_NOT_APPEAR", { exact: true }),
  ).toHaveCount(0);
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-terminal");
  await expect(ownerDialog).toBeVisible();
  // The interaction replaces the composer/queue preview while it is open;
  // wire admission and the later valid-owner drain prove queue ownership.
  expect(probe.calls("turn/start")).toHaveLength(1);
  expect(probe.calls("session/hydrate")).toHaveLength(hydrationCount);
  expect(responds(probe)).toHaveLength(0);

  await ownerDialog.getByRole("button", { name: /Allow once/ }).click();
  await expect(ownerDialog).toHaveCount(0);
  await expect.poll(() => probe.calls("turn/start").length).toBe(2);
  const answered = responds(probe);
  expect(answered).toHaveLength(1);
  expect(answered[0]!.method).toBe("approval/respond");
  expect(answered[0]!.params).toMatchObject({
    session_id: sessionId,
    approval_id: `approval-${turnId}`,
  });
  expect(answered[0]!.params).not.toHaveProperty("topic");
  expect(probe.calls("turn/start")[1]!.params!.session_id).toBe(sessionId);
  expect(probe.calls("turn/start")[1]!.params!.turn_id).not.toBe(turnId);
  await expect(
    page.locator(".entry-assistant").filter({
      hasText: "Completed with pnpm check and all tests passing.",
    }),
  ).toHaveCount(1);
  await expect(promptQueue(page)).toHaveCount(0);
  await expect(foreignDialog).toHaveCount(0);
  expect(probe.calls("session/hydrate")).toHaveLength(hydrationCount);
  const foreignRequests = probe
    .events("approval/requested")
    .filter((frame) => frame.params?.topic === "foreign-routing-topic");
  expect(foreignRequests).toHaveLength(1);
  expect(foreignRequests[0]!.params).toMatchObject({
    session_id: sessionId,
    turn_id: turnId,
    approval_id: `approval-${turnId}`,
  });
});

/**
 * Concurrent, cross-Session question ownership: three Sessions each park a
 * structured question at the SAME time. Every question stays bound to its own
 * Session and is restored when the user returns to it; answering out of order
 * (B, then A, then C) resolves exactly one question per Session with the exact
 * native session_id, question_id, original turn_id and the picked option,
 * every ACK is correlated to its own respond request id and echoes that
 * question, and each Session receives exactly one *completed* terminal for
 * its own original turn. Switching alone never answers, cancels, or
 * interrupts anything. It makes no reconnect-survival claim.
 */
test("keeps three concurrent parked questions bound to their Sessions and resolves them out of order", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const workspaceName = "three-questions-ownership";
  const cwd = `/srv/work/${workspaceName}`;
  const frames = observeFrames(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.locator('[role="treeitem"][data-session-id]');
  await expect(sessions).toHaveCount(1);
  const questionDialog = page.getByRole("dialog", { name: QUESTION_TITLE });
  const seen = new Set<string>();

  const aTitle = await selectedSessionId(sidebar);
  await sendPrompt(page, "Request question fixture");
  await expect(questionDialog).toBeVisible();
  const a = await nextPendingQuestion(frames, seen);

  const bTitle = await newSessionIn(sidebar, workspaceName);
  await expect(sessions).toHaveCount(2);
  await sendPrompt(page, "Request question fixture");
  await expect(questionDialog).toBeVisible();
  const b = await nextPendingQuestion(frames, seen);

  const cTitle = await newSessionIn(sidebar, workspaceName);
  await expect(sessions).toHaveCount(3);
  await sendPrompt(page, "Request question fixture");
  await expect(questionDialog).toBeVisible();
  const c = await nextPendingQuestion(frames, seen);

  // Three distinct Sessions, three distinct native question/turn ids, all
  // parked before any answer.
  expect(new Set([aTitle, bTitle, cTitle]).size).toBe(3);
  expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(3);
  expect(new Set([a.questionId, b.questionId, c.questionId]).size).toBe(3);
  expect(new Set([a.turnId, b.turnId, c.turnId]).size).toBe(3);
  expect(responds(frames)).toHaveLength(0);

  // Switching alone must not answer, cancel, interrupt, or emit a response.
  for (const title of [aTitle, bTitle, cTitle, aTitle]) {
    await selectSession(sidebar, title);
    await expect(questionDialog).toHaveCount(1);
  }
  expect(responds(frames)).toHaveLength(0);
  expect(frames.calls("turn/interrupt")).toHaveLength(0);

  const answerQuestion = async (
    title: string,
    expected: PendingQuestion,
  ): Promise<void> => {
    await selectSession(sidebar, title);
    await expect(questionDialog).toBeVisible({ timeout: 10_000 });
    await questionDialog.getByLabel(/Full/).check();
    await questionDialog.getByRole("button", { name: "Continue" }).click();
    await expect(questionDialog).toHaveCount(0);
    // Exactly one outgoing respond for THIS question, naming ITS Session.
    const respondsTo = () =>
      frames
        .calls("user_question/respond")
        .filter((frame) => frame.params?.question_id === expected.questionId);
    await expect.poll(() => respondsTo().length).toBe(1);
    const request = respondsTo()[0]!;
    expect(request.params!.session_id).toBe(expected.sessionId);
    // The answer carries the option the user picked.
    expect(request.params!.answers).toEqual([{ selected_labels: ["Full"] }]);
    // The JSON-RPC response to THAT request id must echo the same question.
    await frames.settled(request);
    const ack = frames.replyTo(request)!.result as {
      accepted?: unknown;
      question_id?: unknown;
    };
    expect(ack.accepted).toBe(true);
    expect(ack.question_id).toBe(expected.questionId);
  };

  // Out of order: B, then A, then C.
  await answerQuestion(bTitle, b);
  // B's resolution must not touch A or C: both still park their question.
  await selectSession(sidebar, aTitle);
  await expect(questionDialog).toHaveCount(1);
  await selectSession(sidebar, cTitle);
  await expect(questionDialog).toHaveCount(1);
  await answerQuestion(aTitle, a);
  await answerQuestion(cTitle, c);

  // Answers went out in the exact out-of-order sequence B, A, C, and every
  // one of the three requests got its own correlated ACK (no shared id).
  await expect
    .poll(() =>
      frames
        .calls("user_question/respond")
        .map((frame) => frame.params?.question_id),
    )
    .toEqual([b.questionId, a.questionId, c.questionId]);
  const acked = frames
    .calls("user_question/respond")
    .filter((frame) => frames.replyTo(frame)?.result);
  expect(new Set(acked.map((frame) => frame.id)).size).toBe(3);

  // Exactly THREE terminals total for the captured A/B/C turns AND all of
  // them completed. The all-terminal list holds ANY outcome, so an extra
  // errored/interrupted terminal for one of these turns would break the
  // total-count equality — a completed-only subset alone could hide it.
  // Delivery order is not guaranteed across Sessions, so compare sorted sets.
  const expectedTerminals = [a, b, c]
    .map((q) => `${q.sessionId}|${q.turnId}`)
    .sort();
  const capturedTurns = new Set(expectedTerminals);
  const terminals = () =>
    frames
      .events("projection/envelope")
      .filter((frame) => frame.params?.payload?.type === "turn_terminal");
  const terminalKey = (frame: WireFrame): string =>
    `${frame.params?.session_id}|${frame.params?.turn_id}`;
  const allTerminalsForCapturedTurns = (): string[] =>
    terminals()
      .map(terminalKey)
      .filter((key) => capturedTurns.has(key))
      .sort();
  const completedTerminalsForCapturedTurns = (): string[] =>
    terminals()
      .filter((frame) => frame.params?.payload?.data?.outcome === "completed")
      .map(terminalKey)
      .filter((key) => capturedTurns.has(key))
      .sort();
  await expect.poll(allTerminalsForCapturedTurns).toEqual(expectedTerminals);
  await expect
    .poll(completedTerminalsForCapturedTurns)
    .toEqual(expectedTerminals);
});
