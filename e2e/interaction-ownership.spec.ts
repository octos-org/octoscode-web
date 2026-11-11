import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const APPROVAL_TITLE = "Run product checks?";
const QUESTION_TITLE = "Choose verification depth";

// v0.10.0's QueuedPrompts replaced our pre-rebase `.prompt-queue` div with
// `<section aria-label="Queued prompts">` under CSS-module class names
// (apps/web/src/features/composer/QueuedPrompts.tsx:14). Target the accessible
// name — the stable contract — never a module-hashed class.
const promptQueue = (page: Page) =>
  page.getByRole("region", { name: "Queued prompts" });

function productNavigation(page: Page): Locator {
  // A ModalSurface dialog sets aria-hidden on main.workspace-grid — the required
  // a11y contract (ModalSurface.tsx:50-60) — which hides the product nav from
  // ROLE queries. Resolve the nav through a CSS locator that ignores
  // aria-hidden so the session tree stays addressable under an open dialog.
  return page.locator('aside[aria-label="Product navigation"]');
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(title)}]`,
  );
}

async function selectedSessionTitle(sidebar: Locator): Promise<string> {
  const title = await sidebar
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  if (!title) throw new Error("Expected a selected Session title");
  return title;
}

interface SentFrame {
  method: string;
  params: Record<string, unknown>;
}

function observeInteractionRequests(page: Page): SentFrame[] {
  const requests: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as SentFrame;
      if (
        frame.method === "approval/requested" ||
        frame.method === "user_question/requested"
      )
        requests.push(frame);
    });
  });
  return requests;
}

function observeScopeProbe(page: Page) {
  const sent: SentFrame[] = [];
  const received: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      sent.push(JSON.parse(String(payload)) as SentFrame),
    );
    socket.on("framereceived", ({ payload }) =>
      received.push(JSON.parse(String(payload)) as SentFrame),
    );
  });
  return {
    sent,
    received,
    starts: () => sent.filter((frame) => frame.method === "turn/start"),
    hydrates: () => sent.filter((frame) => frame.method === "session/hydrate"),
  };
}

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

/** Capture every approval/respond and user_question/respond frame sent. */
function observeRespondFrames(page: Page): () => SentFrame[] {
  const frames: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (
        !frame.includes('"method":"approval/respond"') &&
        !frame.includes('"method":"user_question/respond"')
      ) {
        return;
      }
      try {
        const request = JSON.parse(frame) as {
          method?: unknown;
          params?: Record<string, unknown>;
        };
        if (
          typeof request.method === "string" &&
          request.params &&
          typeof request.params === "object"
        ) {
          frames.push({ method: request.method, params: request.params });
        }
      } catch {
        // ignore malformed frames
      }
    });
  });
  return () => frames.slice();
}

/** Capture the terminal envelopes a Session receives. */
function observeTerminalSessions(
  page: Page,
): () => Array<{ session_id: string; turn_id: string }> {
  const sessions: Array<{ session_id: string; turn_id: string }> = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"type":"turn_terminal"')) return;
      try {
        const message = JSON.parse(frame) as {
          params?: { session_id?: unknown; turn_id?: unknown };
        };
        if (
          typeof message.params?.session_id === "string" &&
          typeof message.params.turn_id === "string"
        ) {
          sessions.push({
            session_id: message.params.session_id,
            turn_id: message.params.turn_id,
          });
        }
      } catch {
        // ignore malformed frames
      }
    });
  });
  return () => sessions.slice();
}

async function createSiblingSessionExpecting(
  sidebar: Locator,
  workspaceName: string,
  expectedCount: number,
): Promise<string> {
  // Modal-safe: `sidebar` is CSS and every row below is addressed with CSS
  // (ignoring aria-hidden), so sibling creation still works while an
  // approval/question dialog hides the nav from ROLE queries. The workspace
  // treeitem is the only `role="treeitem"` carrying an aria-label (section in
  // ProductSidebar.tsx:570-576); session rows are unlabelled buttons.
  const workspace = sidebar.locator(`[data-workspace-name="${workspaceName}"]`);
  await workspace.locator("button").filter({ hasText: workspaceName }).hover();
  await sidebar
    .locator(`button[aria-label="New session in ${workspaceName}"]`)
    .click();
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(expectedCount);
  return selectedSessionTitle(sidebar);
}

async function selectSessionRow(
  sidebar: Locator,
  title: string,
): Promise<void> {
  const row = sessionRowByTitle(sidebar, title);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page");
}

interface PendingQuestion {
  sessionId: string;
  questionId: string;
  turnId: string;
}

interface QuestionRespondRequest {
  /** The JSON-RPC id this outgoing `user_question/respond` was sent under. */
  id: unknown;
  sessionId: string;
  questionId: string;
}

interface QuestionRespondAck {
  accepted: unknown;
  answeredQuestionId: unknown;
}

/**
 * Capture outgoing `user_question/respond` requests keyed by JSON-RPC id and
 * the responses keyed by that SAME id. Nothing is accepted merely for being
 * shaped `{accepted, question_id}` — an ACK only counts once it is correlated
 * to the exact request id, and the caller then asserts the echoed
 * `question_id` equals the id captured on that request.
 */
function observeQuestionRespondRpc(page: Page) {
  const sent: QuestionRespondRequest[] = [];
  const responses = new Map<unknown, QuestionRespondAck>();
  page.on("websocket", (socket) => {
    // The JSON-RPC ids this socket sent `user_question/respond` under.
    // Only responses carrying one of these ids may be recorded, so unrelated
    // replies (session/open, session/hydrate, turn/start, …) can never enter
    // the responses map and inflate its size.
    const requestIdsOnSocket = new Set<unknown>();
    socket.on("framesent", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as {
          id?: unknown;
          method?: unknown;
          params?: Record<string, unknown>;
        };
        if (message.method !== "user_question/respond") return;
        if (!("id" in message) || !message.params) return;
        const sessionId = message.params.session_id;
        const questionId = message.params.question_id;
        if (typeof sessionId !== "string" || typeof questionId !== "string")
          return;
        requestIdsOnSocket.add(message.id);
        sent.push({ id: message.id, sessionId, questionId });
      } catch {
        // ignore malformed frames
      }
    });
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as {
          id?: unknown;
          result?: { accepted?: unknown; question_id?: unknown };
        };
        if (!("id" in message)) return;
        if (!requestIdsOnSocket.has(message.id)) return;
        if (!message.result || typeof message.result !== "object") return;
        responses.set(message.id, {
          accepted: message.result.accepted,
          answeredQuestionId: message.result.question_id,
        });
      } catch {
        // ignore malformed frames
      }
    });
  });
  return {
    sent: () => sent.slice(),
    responses: () => new Map(responses),
  };
}

/**
 * Capture canonical `projection/envelope` terminals whose payload is a
 * `turn_terminal` with `data.outcome === "completed"`. Unlike a bare
 * "any terminal" observer this can only ever match a real completed outcome —
 * an `interrupted` terminal (disconnect / interrupt) is not collected.
 */
function observeCompletedTerminals(
  page: Page,
): () => Array<{ session_id: string; turn_id: string }> {
  const completed: Array<{ session_id: string; turn_id: string }> = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as {
          method?: unknown;
          params?: {
            session_id?: unknown;
            turn_id?: unknown;
            payload?: { type?: unknown; data?: { outcome?: unknown } };
          };
        };
        if (message.method !== "projection/envelope") return;
        const params = message.params;
        if (params?.payload?.type !== "turn_terminal") return;
        if (params.payload.data?.outcome !== "completed") return;
        if (
          typeof params.session_id !== "string" ||
          typeof params.turn_id !== "string"
        )
          return;
        completed.push({
          session_id: params.session_id,
          turn_id: params.turn_id,
        });
      } catch {
        // ignore malformed frames
      }
    });
  });
  return () => completed.slice();
}

/**
 * Take the next not-yet-seen `user_question/requested` frame off the wire.
 * Requires an exact `method` match, all three ids present/non-empty/typed,
 * and that the captured (session_id, turn_id) pair is backed by EXACTLY ONE
 * real observed `turn/start` from the probe — uniqueness of ids alone is not
 * accepted as evidence of ownership.
 */
async function nextPendingQuestion(
  requests: SentFrame[],
  seen: Set<string>,
  starts: () => SentFrame[],
): Promise<PendingQuestion> {
  const fresh = (): SentFrame[] =>
    requests.filter(
      (frame) =>
        frame.method === "user_question/requested" &&
        typeof frame.params.question_id === "string" &&
        !seen.has(frame.params.question_id as string),
    );
  await expect.poll(() => fresh().length).toBeGreaterThan(0);
  const frame = fresh()[0]!;
  const sessionId = frame.params.session_id;
  const questionId = frame.params.question_id;
  const turnId = frame.params.turn_id;
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
  const owningStarts = starts().filter(
    (start) =>
      start.params.session_id === sessionId && start.params.turn_id === turnId,
  );
  expect(owningStarts).toHaveLength(1);
  seen.add(questionId);
  return { sessionId, questionId, turnId };
}

test("rejects same-base foreign-topic approval and terminal traffic without settling or poisoning the ordinary owner", async ({
  page,
  request,
}) => {
  const probe = observeScopeProbe(page);
  await connectAndStartWorkspace(page, "/srv/work/topic-scope-approval");
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await expect(composer).toBeEnabled();
  await composer.fill("Topic scope approval fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect.poll(() => probe.starts().length).toBe(1);
  const { session_id: sessionId, turn_id: turnId } = probe.starts()[0]!.params;
  expect(typeof sessionId).toBe("string");
  expect(typeof turnId).toBe("string");
  if (typeof sessionId !== "string" || typeof turnId !== "string")
    throw new Error("Expected exact native owner identity");
  expect(sessionId).not.toContain("#");
  await composer.fill("Continue after the genuine owner interaction");
  await page.getByRole("button", { name: "Queue prompt" }).click();
  await expect(promptQueue(page).locator("strong")).toHaveText("1 queued");
  const hydrationCount = probe.hydrates().length;
  const ownerDialog = page.getByRole("dialog", {
    name: APPROVAL_TITLE,
  });
  const foreignDialog = page.getByRole("dialog", {
    name: "Foreign-topic approval must stay hidden",
  });

  await injectScopeProbe(request, page, sessionId, "foreign-request");
  await expect(foreignDialog).toHaveCount(0);
  await expect(ownerDialog).toHaveCount(0);
  expect(
    probe.sent.filter(
      (frame) =>
        frame.method === "approval/respond" ||
        frame.method === "user_question/respond",
    ),
  ).toHaveLength(0);
  expect(probe.starts()).toHaveLength(1);

  await injectScopeProbe(request, page, sessionId, "owner-request");
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-resolution");
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-cursor");
  expect(probe.hydrates()).toHaveLength(hydrationCount);
  await expect(
    page.getByText("FOREIGN_TOPIC_OUTPUT_MUST_NOT_APPEAR", { exact: true }),
  ).toHaveCount(0);
  await expect(ownerDialog).toBeVisible();
  await injectScopeProbe(request, page, sessionId, "foreign-terminal");
  await expect(ownerDialog).toBeVisible();
  // The interaction replaces the composer/queue preview while it is open;
  // wire admission and the later valid-owner drain prove queue ownership.
  expect(probe.starts()).toHaveLength(1);
  expect(probe.hydrates()).toHaveLength(hydrationCount);
  expect(
    probe.sent.filter(
      (frame) =>
        frame.method === "approval/respond" ||
        frame.method === "user_question/respond",
    ),
  ).toHaveLength(0);

  await ownerDialog.getByRole("button", { name: /Allow once/ }).click();
  await expect(ownerDialog).toHaveCount(0);
  await expect.poll(() => probe.starts().length).toBe(2);
  const responds = probe.sent.filter(
    (frame) =>
      frame.method === "approval/respond" ||
      frame.method === "user_question/respond",
  );
  expect(responds).toHaveLength(1);
  expect(responds[0]!.method).toBe("approval/respond");
  expect(responds[0]!.params).toMatchObject({
    session_id: sessionId,
    approval_id: `approval-${turnId}`,
  });
  expect(responds[0]!.params).not.toHaveProperty("topic");
  expect(probe.starts()[1]!.params.session_id).toBe(sessionId);
  expect(probe.starts()[1]!.params.turn_id).not.toBe(turnId);
  await expect(
    page.locator(".entry-assistant").filter({
      hasText: "Completed with pnpm check and all tests passing.",
    }),
  ).toHaveCount(1);
  await expect(promptQueue(page)).toHaveCount(0);
  await expect(foreignDialog).toHaveCount(0);
  expect(probe.hydrates()).toHaveLength(hydrationCount);
  const foreignRequests = probe.received.filter(
    (frame) =>
      frame.method === "approval/requested" &&
      frame.params?.topic === "foreign-routing-topic",
  );
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
  const respondFrames = observeRespondFrames(page);
  const requests = observeInteractionRequests(page);
  const completedTerminals = observeCompletedTerminals(page);
  const terminalSessions = observeTerminalSessions(page);
  const rpc = observeQuestionRespondRpc(page);
  const probe = observeScopeProbe(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.locator('[role="treeitem"][data-session-id]');
  await expect(sessions).toHaveCount(1);
  const questionDialog = page.getByRole("dialog", { name: QUESTION_TITLE });
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  const seen = new Set<string>();

  const aTitle = await selectedSessionTitle(sidebar);
  await composer.fill("Request question fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(questionDialog).toBeVisible();
  const a = await nextPendingQuestion(requests, seen, probe.starts);

  const bTitle = await createSiblingSessionExpecting(sidebar, workspaceName, 2);
  await composer.fill("Request question fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(questionDialog).toBeVisible();
  const b = await nextPendingQuestion(requests, seen, probe.starts);

  const cTitle = await createSiblingSessionExpecting(sidebar, workspaceName, 3);
  await composer.fill("Request question fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(questionDialog).toBeVisible();
  const c = await nextPendingQuestion(requests, seen, probe.starts);

  // Three distinct Sessions, three distinct native question/turn ids, all
  // parked before any answer.
  expect(new Set([aTitle, bTitle, cTitle]).size).toBe(3);
  expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(3);
  expect(new Set([a.questionId, b.questionId, c.questionId]).size).toBe(3);
  expect(new Set([a.turnId, b.turnId, c.turnId]).size).toBe(3);
  expect(respondFrames()).toHaveLength(0);

  // Switching alone must not answer, cancel, interrupt, or emit a response.
  for (const title of [aTitle, bTitle, cTitle, aTitle]) {
    await selectSessionRow(sidebar, title);
    await expect(questionDialog).toHaveCount(1);
  }
  expect(respondFrames()).toHaveLength(0);
  expect(
    probe.sent.filter((frame) => frame.method === "turn/interrupt"),
  ).toHaveLength(0);

  const answerQuestion = async (
    title: string,
    expected: PendingQuestion,
  ): Promise<void> => {
    await selectSessionRow(sidebar, title);
    await expect(questionDialog).toBeVisible({ timeout: 10_000 });
    await questionDialog.getByLabel(/Full/).check();
    await questionDialog.getByRole("button", { name: "Continue" }).click();
    await expect(questionDialog).toHaveCount(0);
    // Exactly one outgoing respond for THIS question, naming ITS Session.
    await expect
      .poll(
        () =>
          rpc.sent().filter((entry) => entry.questionId === expected.questionId)
            .length,
      )
      .toBe(1);
    const request = rpc
      .sent()
      .find((entry) => entry.questionId === expected.questionId)!;
    expect(request.sessionId).toBe(expected.sessionId);
    // The answer carries the option the user picked.
    expect(
      respondFrames().find(
        (frame) => frame.params.question_id === expected.questionId,
      )?.params.answers,
    ).toEqual([{ selected_labels: ["Full"] }]);
    // The JSON-RPC response to THAT request id must echo the same question.
    await expect.poll(() => rpc.responses().has(request.id)).toBe(true);
    const ack = rpc.responses().get(request.id)!;
    expect(ack.accepted).toBe(true);
    expect(ack.answeredQuestionId).toBe(expected.questionId);
  };

  // Out of order: B, then A, then C.
  await answerQuestion(bTitle, b);
  // B's resolution must not touch A or C: both still park their question.
  await selectSessionRow(sidebar, aTitle);
  await expect(questionDialog).toHaveCount(1);
  await selectSessionRow(sidebar, cTitle);
  await expect(questionDialog).toHaveCount(1);
  await answerQuestion(aTitle, a);
  await answerQuestion(cTitle, c);

  // Answers went out in the exact out-of-order sequence B, A, C, and every
  // one of the three requests got its own correlated ACK (no shared id).
  await expect
    .poll(() => rpc.sent().map((entry) => entry.questionId))
    .toEqual([b.questionId, a.questionId, c.questionId]);
  expect(rpc.responses().size).toBe(3);

  // Exactly THREE terminals total for the captured A/B/C turns AND all of
  // them completed. The all-terminal observer records ANY outcome, so an
  // extra errored/interrupted terminal for one of these turns would break the
  // total-count equality — a completed-only subset alone could hide it.
  // Delivery order is not guaranteed across Sessions, so compare sorted sets.
  const expectedTerminals = [a, b, c]
    .map((q) => `${q.sessionId}|${q.turnId}`)
    .sort();
  const capturedTurns = new Set(expectedTerminals);
  const terminalKey = (entry: {
    session_id: string;
    turn_id: string;
  }): string => `${entry.session_id}|${entry.turn_id}`;
  const allTerminalsForCapturedTurns = (): string[] =>
    terminalSessions()
      .map(terminalKey)
      .filter((key) => capturedTurns.has(key))
      .sort();
  const completedTerminalsForCapturedTurns = (): string[] =>
    completedTerminals()
      .map(terminalKey)
      .filter((key) => capturedTurns.has(key))
      .sort();
  await expect.poll(allTerminalsForCapturedTurns).toEqual(expectedTerminals);
  await expect
    .poll(completedTerminalsForCapturedTurns)
    .toEqual(expectedTerminals);
});
