import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";
import {
  observeStartedTurns,
  observeInterrupts,
  observeTransports,
} from "./turn-observers";

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

function conversation(page: Page): Locator {
  return page.getByRole("region", { name: "Conversation", exact: true });
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
  const sessions = sidebar.locator('[role="treeitem"][data-session-id]');
  await expect(sessions).toHaveCount(1);
  const aTitle = await selectedSessionTitle(sidebar);
  const sessionA = sessionRowByTitle(sidebar, aTitle);
  const workspace = sidebar.locator(
    '[data-workspace-name="simultaneous-sessions"]',
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
  await expect(
    conversation(page).getByText(bPrompt, { exact: true }),
  ).toBeVisible();
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toBeVisible({
    timeout: 10_000,
  });

  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    conversation(page).getByText("A-one-unique", { exact: false }),
  ).toHaveCount(0);

  await createSession();
  await expect(sessions).toHaveCount(3);
  const cTitle = await selectedSessionTitle(sidebar);
  const sessionC = sessionRowByTitle(sidebar, cTitle);
  expect(cTitle).not.toBe(aTitle);
  expect(cTitle).not.toBe(bTitle);
  await send(cPrompt);
  await expect(
    conversation(page).getByText(cPrompt, { exact: true }),
  ).toBeVisible();
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toBeVisible({
    timeout: 10_000,
  });

  await sessionA.click();
  await expect(sessionA).toHaveAttribute("aria-current", "page");
  await expect(
    conversation(page).getByText("A-one-unique", { exact: false }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    conversation(page).getByText(bPrompt, { exact: true }),
  ).toHaveCount(0);
  await expect(
    conversation(page).getByText(cPrompt, { exact: true }),
  ).toHaveCount(0);

  await sessionB.click();
  await expect(sessionB).toHaveAttribute("aria-current", "page");
  await expect(
    conversation(page).getByText(bPrompt, { exact: true }),
  ).toBeVisible();
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    conversation(page).getByText("A-one-unique", { exact: false }),
  ).toHaveCount(0);
  await expect(
    conversation(page).getByText(cPrompt, { exact: true }),
  ).toHaveCount(0);

  await sessionC.click();
  await expect(sessionC).toHaveAttribute("aria-current", "page");
  await expect(
    conversation(page).getByText(cPrompt, { exact: true }),
  ).toBeVisible();
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    conversation(page).getByText("A-one-unique", { exact: false }),
  ).toHaveCount(0);
  await expect(
    conversation(page).getByText(bPrompt, { exact: true }),
  ).toHaveCount(0);

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
  const transports = observeTransports(page);
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
    .locator('[data-workspace-name="busy-loss-fifo"]')
    .getByRole("button", { name: "busy-loss-fifo", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in busy-loss-fifo" })
    .click();
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(2);
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
  // Two Sessions share ONE pooled transport.
  expect(transports.live()).toBe(1);
  const createdBeforeDisconnect = transports.created();
  expect(
    (await request.post(FIXTURE_ORIGIN + "/__test__/disconnect")).status(),
  ).toBe(204);
  await expect
    .poll(() => started().map((turn) => turn.text), { timeout: 20_000 })
    .toEqual(["A1-busy-loss", "A2-busy-loss"]);
  // The transport was replaced, never two open at once.
  expect(transports.created()).toBeGreaterThan(createdBeforeDisconnect);
  expect(transports.peak()).toBeLessThanOrEqual(1);
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(conversation(page).getByText(/A[123]-busy-loss/)).toHaveCount(0);
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
    await expect(
      conversation(page).getByText(prompt, { exact: true }),
    ).toHaveCount(1);
  }
  await expect(conversation(page).getByText(COMPLETION_TEXT)).toHaveCount(2);
  expect(interrupts()).toBe(0);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

/**
 * Also the P0 queued-FIFO regression: A2 queued behind A1's HELD terminal must
 * not start while the user moves to B (no interrupt), must start against A's
 * Session id only after A1's terminal is released, and B stays selected with
 * none of A's text. Refocusing A shows both prompts exactly once.
 */
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
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(1);
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
    .locator('[data-workspace-name="native-persisted-stream-order"]')
    .getByRole("button", { name: "native-persisted-stream-order", exact: true })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in native-persisted-stream-order",
      exact: true,
    })
    .click();
  await expect(
    sidebar.locator('[role="treeitem"][data-session-id]'),
  ).toHaveCount(2);
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
    conversation(page).getByText(
      /STREAM_ORDER|Fixture native persisted-before-delta/,
    ),
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
    await expect(
      conversation(page).getByText(prompt, { exact: true }),
    ).toHaveCount(1);
  expect(started()).toHaveLength(2);
  expect(interrupts()).toBe(0);
});
