import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const SLOW_PREFIX = "Continue this turn while I open another Session";
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
});

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator('button[role="treeitem"]').filter({ hasText: title });
}

async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#connection-title")).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace
    .getByRole("button", { name: /Add & Start|Start session/ })
    .click();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
}

async function selectedSessionTitle(sidebar: Locator): Promise<string> {
  const title = await sidebar
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!title) throw new Error("Expected a selected Session title");
  return title;
}

interface StartedTurn {
  sessionId: string;
  turnId: string;
  text: string;
}

function observeStartedTurns(page: Page): () => StartedTurn[] {
  const started: StartedTurn[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"method":"turn/start"')) return;
      const request = JSON.parse(frame) as {
        params?: {
          session_id?: unknown;
          turn_id?: unknown;
          input?: Array<{ text?: unknown }>;
        };
      };
      if (
        typeof request.params?.session_id === "string" &&
        typeof request.params.turn_id === "string"
      ) {
        started.push({
          sessionId: request.params.session_id,
          turnId: request.params.turn_id,
          text:
            typeof request.params.input?.[0]?.text === "string"
              ? request.params.input[0].text
              : "",
        });
      }
    });
  });
  return () => started.slice();
}

function observeInterrupts(page: Page): () => number {
  let interrupts = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/interrupt"')) {
        interrupts += 1;
      }
    });
  });
  return () => interrupts;
}

async function holdNextTerminal(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  const response = await request.post(
    `${FIXTURE_ORIGIN}/__test__/terminal/hold-next`,
  );
  expect(response.status()).toBe(204);
}

async function releaseHeldTerminal(
  request: import("@playwright/test").APIRequestContext,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/terminal/state")
      ).json()) as {
        held: Array<{ session_id: string }>;
      };
      return state.held.some((held) => held.session_id === sessionId);
    })
    .toBe(true);
  const response = await request.post(
    `${FIXTURE_ORIGIN}/__test__/terminal/release?session_id=${encodeURIComponent(sessionId)}`,
  );
  expect(response.status()).toBe(204);
}

/**
 * P0 regression: A/B/C turns started in quick succession on one Workspace must
 * complete independently. Switching away parks a running turn; switching back
 * surfaces that Session's own transcript (including a terminal that landed
 * while parked) exactly once, with no cross-Session prompt text and no
 * duplicate turn/start on refocus.
 */
test("isolates independent turns across rapid Session switches", async ({
  page,
}) => {
  const cwd = "/srv/work/simultaneous-sessions";
  const aPrompt = `${SLOW_PREFIX} A-one-unique`;
  const bPrompt = "B-two-unique marker";
  const cPrompt = "C-three-unique marker";
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const aTitle = await selectedSessionTitle(sidebar);
  const sessionA = sessionRowByTitle(sidebar, aTitle);
  const workspace = sidebar.locator(
    '[role="treeitem"][aria-label="' + "simultaneous-sessions" + '"]',
  );
  const createSession = async () => {
    await workspace
      .getByRole("button", { name: "simultaneous-sessions", exact: true })
      .hover();
    await sidebar
      .getByRole("button", { name: "New session in simultaneous-sessions" })
      .click();
  };
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  const send = async (prompt: string) => {
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send prompt" }).click();
  };

  await send(aPrompt);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
    timeout: 10_000,
  });
  await createSession();
  await expect(sessions).toHaveCount(2);
  const bTitle = await selectedSessionTitle(sidebar);
  const sessionB = sessionRowByTitle(sidebar, bTitle);
  expect(bTitle).not.toBe(aTitle);

  await send(bPrompt);
  await expect(page.getByText(bPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toBeVisible({
    timeout: 10_000,
  });

  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("A-one-unique", { exact: false })).toHaveCount(0);

  await createSession();
  await expect(sessions).toHaveCount(3);
  const cTitle = await selectedSessionTitle(sidebar);
  const sessionC = sessionRowByTitle(sidebar, cTitle);
  expect(cTitle).not.toBe(aTitle);
  expect(cTitle).not.toBe(bTitle);
  await send(cPrompt);
  await expect(page.getByText(cPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toBeVisible({
    timeout: 10_000,
  });

  await sessionA.click();
  await expect(sessionA).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("A-one-unique", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(page.getByText(bPrompt, { exact: true })).toHaveCount(0);
  await expect(page.getByText(cPrompt, { exact: true })).toHaveCount(0);

  await sessionB.click();
  await expect(sessionB).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(bPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(page.getByText("A-one-unique", { exact: false })).toHaveCount(0);
  await expect(page.getByText(cPrompt, { exact: true })).toHaveCount(0);

  await sessionC.click();
  await expect(sessionC).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(cPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(page.getByText("A-one-unique", { exact: false })).toHaveCount(0);
  await expect(page.getByText(bPrompt, { exact: true })).toHaveCount(0);

  const startedTurns = started();
  expect(startedTurns).toHaveLength(3);
  expect(startedTurns.map((turn) => turn.text)).toEqual(
    expect.arrayContaining([aPrompt, bPrompt, cPrompt]),
  );
  expect(new Set(startedTurns.map((turn) => turn.turnId)).size).toBe(3);
  expect(interrupts()).toBe(0);
});

test("recovers an unacknowledged A1 behind B and drains A2 then A3 without replaying A1", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/busy-loss-fifo";
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);
  const recoveredSnapshots: Array<{
    sessionId: string;
    startsAtHydrate: number;
    turns: Array<{ turn_id: string; state: string }>;
  }> = [];
  page.on("websocket", (socket) => {
    const hydrates = new Map<string, string>();
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        id: string;
        method: string;
        params?: { session_id: string };
      };
      if (frame.method === "session/hydrate" && frame.params)
        hydrates.set(frame.id, frame.params.session_id);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        id: string;
        result?: { turns?: Array<{ turn_id: string; state: string }> };
      };
      const sessionId = hydrates.get(frame.id);
      if (sessionId && frame.result?.turns) {
        recoveredSnapshots.push({
          sessionId,
          startsAtHydrate: started().length,
          turns: frame.result.turns,
        });
        hydrates.delete(frame.id);
      }
    });
  });
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const aTitle = await selectedSessionTitle(sidebar);
  const a = sessionRowByTitle(sidebar, aTitle);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/hold-next");
  await holdNextTerminal(request);
  await composer.fill("A1-busy-loss");
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  for (const prompt of ["A2-busy-loss", "A3-busy-loss"]) {
    await composer.fill(prompt);
    await page
      .getByRole("button", { name: "Queue prompt", exact: true })
      .click();
  }
  await expect(page.getByText(/2 queued/)).toBeVisible();
  await sidebar
    .getByRole("treeitem", { name: "busy-loss-fifo", exact: true })
    .getByRole("button", { name: "busy-loss-fifo", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in busy-loss-fifo" })
    .click();
  await expect(sidebar.getByRole("treeitem", { name: /Session / })).toHaveCount(
    2,
  );
  await expect(a).not.toHaveAttribute("aria-current", "page");
  const b = sessionRowByTitle(sidebar, await selectedSessionTitle(sidebar));
  await expect(b).toHaveAttribute("aria-current", "page");
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/admit")
    ).status(),
  ).toBe(204);
  const first = started()[0]!;
  expect(first.text).toBe("A1-busy-loss");
  // Future A2/A3 stay server-active until their individual terminals release.
  await holdNextTerminal(request);
  await holdNextTerminal(request);
  expect(
    (await request.post(FIXTURE_ORIGIN + "/__test__/disconnect")).status(),
  ).toBe(204);
  await expect
    .poll(() => started().map((turn) => turn.text), { timeout: 20_000 })
    .toEqual(["A1-busy-loss", "A2-busy-loss"]);
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/A[123]-busy-loss/)).toHaveCount(0);
  expect(
    recoveredSnapshots.filter(
      (snapshot) =>
        snapshot.sessionId === first.sessionId &&
        snapshot.turns.some(
          (turn) =>
            turn.turn_id === first.turnId && turn.state === "interrupted",
        ),
    ),
  ).toEqual([
    {
      sessionId: first.sessionId,
      startsAtHydrate: 1,
      turns: [
        expect.objectContaining({
          turn_id: first.turnId,
          state: "interrupted",
        }),
      ],
    },
  ]);
  expect(started()[1]!.sessionId).toBe(first.sessionId);
  await releaseHeldTerminal(request, first.sessionId);
  await expect
    .poll(() => started().map((turn) => turn.text))
    .toEqual(["A1-busy-loss", "A2-busy-loss", "A3-busy-loss"]);
  expect(started().every((turn) => turn.sessionId === first.sessionId)).toBe(
    true,
  );
  expect(new Set(started().map((turn) => turn.turnId)).size).toBe(3);
  await releaseHeldTerminal(request, first.sessionId);
  await a.click();
  for (const prompt of ["A1-busy-loss", "A2-busy-loss", "A3-busy-loss"]) {
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  }
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  expect(interrupts()).toBe(0);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

/**
 * P0 regression (expected red on the old product): A2 is queued behind A1's
 * active turn. The ordering contract is: A1's terminal is HELD by the fixture
 * barrier; the user switches to B (B becomes selected while A1 is still
 * running server-side — allowed under the new persistent-record navigation
 * semantics); A1's terminal is then RELEASED; only after that may A2 be
 * accepted — and it must start against A's Session id while B STAYS selected.
 * No interrupt, no duplicate start, no queue corruption, no cross-Session
 * delivery.
 */
test("drains a queued A2 after a released A1 terminal while B stays selected", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/queued-fifo-a2";
  const a1Prompt = `${SLOW_PREFIX} A1-fifo-marker`;
  const a2Prompt = "A2-fifo-marker";
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const aTitle = await selectedSessionTitle(sidebar);
  const sessionA = sessionRowByTitle(sidebar, aTitle);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);

  // Hold A1's terminal before the turn starts so it cannot drain A2 early.
  await holdNextTerminal(request);

  await composer.fill(a1Prompt);
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({
    timeout: 10_000,
  });
  await composer.fill(a2Prompt);
  await page.getByRole("button", { name: "Queue prompt" }).click();
  await expect(page.getByText(/1 queued/)).toBeVisible();

  // Switch to B while A1 is still server-active (terminal held). This is the
  // new persistent-record navigation semantics: allowed even before A1's
  // terminal, and it must not interrupt A1 or drop A2.
  const workspace = sidebar.locator(
    '[role="treeitem"][aria-label="' + "queued-fifo-a2" + '"]',
  );
  await workspace
    .getByRole("button", { name: "queued-fifo-a2", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in queued-fifo-a2" })
    .click();
  await expect(sessions).toHaveCount(2);
  const bTitle = await selectedSessionTitle(sidebar);
  const sessionB = sessionRowByTitle(sidebar, bTitle);
  expect(bTitle).not.toBe(aTitle);
  await expect(sessionB).toHaveAttribute("aria-current", "page");

  // A2 must NOT have started yet: A1's terminal is still held.
  expect(started().filter((turn) => turn.text === a2Prompt)).toHaveLength(0);
  // No interrupt was ever sent while navigating away from a busy Session.
  expect(interrupts()).toBe(0);

  // Release A1's terminal: A2 drains against A's session id, B stays selected.
  const a1Start = started().find((turn) => turn.text === a1Prompt);
  expect(a1Start).toBeTruthy();
  await releaseHeldTerminal(request, a1Start!.sessionId);

  await expect
    .poll(
      () =>
        started().filter(
          (turn) =>
            turn.text === a2Prompt && turn.sessionId === a1Start!.sessionId,
        ).length,
      { timeout: 15_000 },
    )
    .toBe(1);
  await expect(sessionB).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(a2Prompt, { exact: true })).toHaveCount(0);
  await expect(page.getByText("A1-fifo-marker", { exact: false })).toHaveCount(
    0,
  );
  expect(interrupts()).toBe(0);

  // Refocus A: both prompts belong to A, each exactly once.
  await sessionA.click();
  await expect(sessionA).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("A1-fifo-marker", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(a2Prompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  const turnsAgainstA = started().filter(
    (turn) => turn.sessionId === a1Start!.sessionId,
  );
  expect(turnsAgainstA).toHaveLength(2);
});

/**
 * P0 regression: transcripts stay per-Session; reload restores the Session
 * that was current before reload, and re-opening a parked Session never
 * re-starts its completed turn.
 */
test("keeps per-Session transcripts distinct and restores the pre-reload Session", async ({
  page,
}) => {
  const cwd = "/srv/work/per-session-transcripts";
  const firstPrompt = "First-session-unique-prompt";
  const started = observeStartedTurns(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const firstTitle = await selectedSessionTitle(sidebar);
  const firstSession = sessionRowByTitle(sidebar, firstTitle);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);

  await composer.fill(firstPrompt);
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible();
  await expect(page.getByText(COMPLETION_TEXT)).toBeVisible({
    timeout: 10_000,
  });
  const turnsAfterFirst = started().length;

  const workspace = sidebar.locator(
    '[role="treeitem"][aria-label="' + "per-session-transcripts" + '"]',
  );
  await workspace
    .getByRole("button", { name: "per-session-transcripts", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in per-session-transcripts" })
    .click();
  await expect(sessions).toHaveCount(2);
  const secondTitle = await selectedSessionTitle(sidebar);
  await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(0);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(0);

  await page.reload();
  await expect(sessions).toHaveCount(2);
  await expect(
    sessionRowByTitle(productNavigation(page), secondTitle),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(0);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(0);
  await firstSession.click();
  await expect(firstSession).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(COMPLETION_TEXT)).toBeVisible();
  expect(started().length).toBe(turnsAfterFirst);
});

test("preserves native persisted segment finality across late deltas and the next background FIFO turn", async ({
  page,
  request,
}, testInfo) => {
  const firstPrompt = "Fixture native persisted-before-delta first";
  const secondPrompt = "Fixture native persisted-before-delta second";
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);
  const hydrateSessions: string[] = [];
  const envelopes: Array<{
    session_id: string;
    turn_id: string;
    seq: number;
    cursor: { seq: number };
    payload: {
      type: string;
      data: {
        text?: string;
        assistant_segment_id?: string;
        meta?: { message_id: string };
        outcome?: string;
      };
    };
  }> = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "session/hydrate")
        hydrateSessions.push(frame.params.session_id);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "projection/envelope") envelopes.push(frame.params);
    });
  });
  await connectAndStartWorkspace(
    page,
    "/srv/work/native-persisted-stream-order",
  );
  const sidebar = productNavigation(page);
  await expect(sidebar.getByRole("treeitem", { name: /Session / })).toHaveCount(
    1,
  );
  const aTitle = await selectedSessionTitle(sidebar);
  const a = sessionRowByTitle(sidebar, aTitle);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await holdNextTerminal(request);
  await composer.fill(firstPrompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await composer.fill(secondPrompt);
  await page.getByRole("button", { name: "Queue prompt", exact: true }).click();
  await expect(page.getByText("1 queued", { exact: true })).toBeVisible();
  await sidebar
    .locator(
      '[role="treeitem"][aria-label="' + "native-persisted-stream-order" + '"]',
    )
    .getByRole("button", { name: "native-persisted-stream-order", exact: true })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in native-persisted-stream-order",
      exact: true,
    })
    .click();
  await expect(sidebar.getByRole("treeitem", { name: /Session / })).toHaveCount(
    2,
  );
  await expect(a).not.toHaveAttribute("aria-current", "page");
  const b = sessionRowByTitle(sidebar, await selectedSessionTitle(sidebar));
  expect(started()).toHaveLength(1);
  const source = started()[0]!;
  await releaseHeldTerminal(request, source.sessionId);
  await expect.poll(() => started().length).toBe(2);
  await expect
    .poll(
      () =>
        envelopes.filter((event) => event.payload.type === "turn_terminal")
          .length,
    )
    .toBe(2);
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText(/STREAM_ORDER|Fixture native persisted-before-delta/),
  ).toHaveCount(0);
  expect(started().map((turn) => [turn.sessionId, turn.text])).toEqual([
    [source.sessionId, firstPrompt],
    [source.sessionId, secondPrompt],
  ]);
  expect(new Set(started().map((turn) => turn.turnId)).size).toBe(2);
  const firstEvents = envelopes.filter(
    (event) =>
      event.turn_id === source.turnId && event.payload.type !== "user_message",
  );
  expect(
    firstEvents.map((event) => [
      event.seq,
      event.cursor.seq,
      event.payload.type,
      event.payload.data.text ?? event.payload.data.outcome,
    ]),
  ).toEqual([
    [2, 2, "assistant_delta", "ST"],
    [3, 3, "assistant_delta", "REAM"],
    [4, 4, "assistant_delta", "_"],
    [5, 5, "assistant_delta", "ORDER"],
    [6, 6, "assistant_persisted", "STREAM_ORDER_FIRST_COMPLETE"],
    [7, 7, "assistant_delta", "_F"],
    [8, 8, "assistant_delta", "IR"],
    [9, 9, "assistant_delta", "ST"],
    [10, 10, "assistant_delta", "_COMP"],
    [11, 11, "assistant_delta", "L"],
    [12, 12, "assistant_delta", "ETE"],
    [13, 13, "turn_terminal", "completed"],
  ]);
  expect(
    new Set(
      firstEvents
        .slice(0, -1)
        .map((event) => event.payload.data.assistant_segment_id),
    ),
  ).toEqual(new Set([source.turnId + ":assistant:iteration:2"]));
  expect(firstEvents[4]!.payload.data.meta?.message_id).toBe(
    "message-" + source.turnId,
  );
  const firstTerminalIndex = envelopes.findIndex(
    (event) =>
      event.turn_id === source.turnId && event.payload.type === "turn_terminal",
  );
  const secondStartIndex = envelopes.findIndex(
    (event) =>
      event.turn_id === started()[1]!.turnId &&
      event.payload.type === "user_message",
  );
  expect(secondStartIndex).toBeGreaterThan(firstTerminalIndex);
  await a.click();
  await expect(a).toHaveAttribute("aria-current", "page");
  expect(
    hydrateSessions.filter((sessionId) => sessionId === source.sessionId),
  ).toEqual([source.sessionId]);
  const bodies = page.locator(
    ".entry-assistant .markdown-body, .entry-assistant .md-streaming",
  );
  await expect(bodies).toHaveCount(2);
  await testInfo.attach("native-persisted-stream-order", {
    body: JSON.stringify(
      {
        envelopes,
        started: started(),
        hydrateSessions,
        rendered: await bodies.allTextContents(),
        runningLabels: await page.locator(".timeline .running-label").count(),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await expect
    .soft(bodies)
    .toHaveText([
      "STREAM_ORDER_FIRST_COMPLETE",
      "STREAM_ORDER_SECOND_COMPLETE",
    ]);
  await expect.soft(page.locator(".timeline .running-label")).toHaveCount(0);
  for (const prompt of [firstPrompt, secondPrompt])
    await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  expect(started()).toHaveLength(2);
  expect(interrupts()).toBe(0);
});
