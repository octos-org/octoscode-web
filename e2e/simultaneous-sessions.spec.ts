import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";
import {
  observeStartedTurns,
  observeInterrupts,
  observeTransports,
} from "./turn-observers";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
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
 * Finality: the fixture streams deltas for an assistant segment AFTER Core
 * persisted it. The persisted text is final; late deltas never change what A
 * shows. The queued A2 starts against A's Session only after A1's terminal,
 * while B stays selected with none of A's text, and nothing is interrupted.
 */
test("preserves native persisted segment finality across late deltas and the next background FIFO turn", async ({
  page,
  request,
}) => {
  const firstPrompt = "Fixture native persisted-before-delta first";
  const secondPrompt = "Fixture native persisted-before-delta second";
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);
  const hydrateSessions: string[] = [];
  const envelopes: Array<{ turn_id: string; payload: { type: string } }> = [];
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
  await expect(bodies).toHaveText([
    "STREAM_ORDER_FIRST_COMPLETE",
    "STREAM_ORDER_SECOND_COMPLETE",
  ]);
  await expect(page.locator(".timeline .running-label")).toHaveCount(0);
  for (const prompt of [firstPrompt, secondPrompt])
    await expect(
      conversation(page).getByText(prompt, { exact: true }),
    ).toHaveCount(1);
  expect(started()).toHaveLength(2);
  expect(interrupts()).toBe(0);
});
