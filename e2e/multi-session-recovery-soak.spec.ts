import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session.ts";
import {
  observeStartedTurns,
  observeInterrupts,
  type StartedTurn,
} from "./turn-observers";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const WORKSPACE_NAME = "multi-session-recovery-soak";
const WORKSPACE_PARKED = `${WORKSPACE_NAME}-parked`;
const APPROVAL_TITLE = "Run product checks?";

// Every case must leave the fixture inert even when an assertion throws.
test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
});

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function sessionRowById(sidebar: Locator, sessionId: string): Locator {
  return sidebar.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(sessionId)}]`,
  );
}

async function selectedSessionTitle(sidebar: Locator): Promise<string> {
  const sessionId = await sidebar
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  if (!sessionId) throw new Error("Expected a selected Session id");
  return sessionId;
}

interface SentFrame {
  method: string;
  params: Record<string, unknown>;
}

/** Capture the exact approval/question ids the fixture asks this page to own. */
function observeInteractionRequests(page: Page): () => SentFrame[] {
  const requests: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as SentFrame;
      if (
        frame.method === "approval/requested" ||
        frame.method === "user_question/requested"
      ) {
        requests.push({ method: frame.method, params: frame.params ?? {} });
      }
    });
  });
  return () => requests.slice();
}

/** Capture every approval/respond and user_question/respond frame sent. */
function observeRespondFrames(page: Page): () => SentFrame[] {
  const frames: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const raw = String(payload);
      if (
        !raw.includes('"method":"approval/respond"') &&
        !raw.includes('"method":"user_question/respond"')
      ) {
        return;
      }
      const frame = JSON.parse(raw) as SentFrame;
      frames.push({ method: frame.method, params: frame.params ?? {} });
    });
  });
  return () => frames.slice();
}

interface TerminalEvent {
  sessionId: string;
  turnId: string;
  seq: number;
  cursorSeq: number;
  outcome: string;
}

/** Records every canonical terminal envelope fanned to this page's socket. */
function observeTerminals(page: Page): () => TerminalEvent[] {
  const terminals: TerminalEvent[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: {
          session_id?: string;
          turn_id?: string;
          seq?: number;
          cursor?: { seq?: number };
          payload?: { type?: string; data?: { outcome?: string } };
        };
      };
      if (frame.method !== "projection/envelope") return;
      const params = frame.params;
      if (params?.payload?.type !== "turn_terminal") return;
      terminals.push({
        sessionId: params.session_id ?? "",
        turnId: params.turn_id ?? "",
        seq: params.seq ?? 0,
        cursorSeq: params.cursor?.seq ?? 0,
        outcome: params.payload.data?.outcome ?? "",
      });
    });
  });
  return () => terminals.slice();
}

async function holdTerminals(
  request: APIRequestContext,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    expect(
      (
        await request.post(FIXTURE_ORIGIN + "/__test__/terminal/hold-next")
      ).status(),
    ).toBe(204);
  }
}

async function heldSessions(
  request: APIRequestContext,
): Promise<Array<{ session_id: string; turn_id: string }>> {
  const state = (await (
    await request.get(FIXTURE_ORIGIN + "/__test__/terminal/state")
  ).json()) as {
    held: Array<{ session_id: string; turn_id: string }>;
  };
  return state.held;
}

async function releaseHeldTerminal(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await heldSessions(request)).some(
          (held) => held.session_id === sessionId,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/terminal/release?session_id=${encodeURIComponent(sessionId)}`,
      )
    ).status(),
  ).toBe(204);
}

interface ActiveTurn {
  turn_id: string;
  owner: string;
  profile_id?: string;
  workspace_root?: string;
}

interface DiagnosticsState {
  activeBySession: Record<string, ActiveTurn | null>;
  socketsBySession: Record<string, number>;
}

async function diagnostics(
  request: APIRequestContext,
): Promise<DiagnosticsState> {
  return (await (
    await request.get(FIXTURE_ORIGIN + "/__test__/diagnostics/state")
  ).json()) as DiagnosticsState;
}

interface RuntimeErrors {
  unhandled: string[];
  consoleErrors: string[];
}

/** Track uncaught page errors and console errors for one case. */
function trackRuntimeErrors(page: Page): () => RuntimeErrors {
  const unhandled: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => unhandled.push(error.message));
  page.on("console", (message) => {
    // §Discovery probes the last origin this browser saw for /pair/info, and a
    // fixture that does not implement pairing answers 404. The contract calls a
    // failed probe silent, and the app treats it as "pairing not supported" —
    // but the BROWSER still logs the response, which is not a defect in the
    // code under soak. Every other console error still fails the run.
    if (message.type() !== "error") return;
    const text = message.text();
    if (message.location().url.endsWith("/pair/info") && text.includes("404"))
      return;
    consoleErrors.push(text);
  });
  return () => ({
    unhandled: unhandled.slice(),
    consoleErrors: consoleErrors.slice(),
  });
}

/** The Session id that admitted the ONE turn whose prompt text is `text`. */
function sessionIdForPrompt(started: StartedTurn[], text: string): string {
  const matched = started.filter((turn) => turn.text === text);
  if (matched.length !== 1) {
    throw new Error(
      `Expected exactly one turn/start for ${text}, saw ${matched.length}`,
    );
  }
  return matched[0]!.sessionId;
}

async function createSiblingSession(
  sidebar: Locator,
  workspaceName: string,
): Promise<string> {
  const workspace = sidebar.locator(
    `[data-workspace-name=${JSON.stringify(workspaceName)}]`,
  );
  // Creating a sibling selects it, but selection only moves a beat AFTER the
  // click. Capture the current selection first, then wait until it changes, so
  // we never read the previous Session's id as if it were the new sibling's.
  const previous = await selectedSessionTitle(sidebar);
  await workspace
    .getByRole("button", { name: workspaceName, exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: `New session in ${workspaceName}` })
    .click();
  // No fixed sleeps: poll the selected row until it is a DIFFERENT Session.
  await expect
    .poll(async () => selectedSessionTitle(sidebar).catch(() => previous), {
      timeout: 15_000,
    })
    .not.toBe(previous);
  return selectedSessionTitle(sidebar);
}

async function selectSession(
  sidebar: Locator,
  sessionId: string,
): Promise<void> {
  const row = sessionRowById(sidebar, sessionId);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page");
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill(text);
  await page.getByRole("button", { name: /^(Send|Queue) prompt$/ }).click();
}

test("parks a background approval on its owning Session across A/B/C switching, drains its queued followup, and survives an observer reconnect", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = `/srv/work/${WORKSPACE_PARKED}`;
  const started = observeStartedTurns(page);
  const terminals = observeTerminals(page);
  const interrupts = observeInterrupts(page);
  const requests = observeInteractionRequests(page);
  const responds = observeRespondFrames(page);
  const errors = trackRuntimeErrors(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const trace = "A-after-parked-approval";

  const titleA = await selectedSessionTitle(sidebar);
  // The composer — and the "N queued" strip it renders (v0.10.0's QueuedPrompts,
  // `<section aria-label="Queued prompts">`) — is mounted only
  // while NO interaction owns the surface: the shipped contract swaps in
  // ApprovalPanel/UserQuestionPanel and replaces `.composer` outright
  // (see the takeover branch in App.tsx). The "1 queued" observation therefore has to happen
  // BEFORE the approval parks, never behind it.
  //
  // Hold the approval turn's turn/start acknowledgement: the fixture raises
  // approval/requested from streamTurn(), which the held-admission path only
  // reaches once the acknowledgement is released, so the composer stays mounted.
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/hold-next")
    ).status(),
  ).toBe(204);
  await sendPrompt(page, "Request approval fixture");
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();

  // A queued followup admitted behind the not-yet-raised approval must not
  // start yet.
  await sendPrompt(page, trace);
  await expect(page.getByText(/\b1 queued\b/)).toBeVisible();

  // Admit the held approval turn: it raises approval/requested, the panel takes
  // over the composer, and `trace` stays queued behind the parked interaction.
  //
  // Use /release, not /admit: /admit calls the raw admit() closure and leaves
  // `heldTurnStart` set for session A (mock-ui-server.mjs:1057 never reaches
  // takeHeldTurnStart()). The turn/start guard then rejects EVERY later
  // turn/start for A — including the queued `trace` — through its
  // `heldTurnStart?.sessionId === sessionId` disjunct (mock-ui-server.mjs:2767)
  // as "the Session is already active", so trace never starts and never
  // consumes the armed terminal hold. /release clears the held record via
  // takeHeldTurnStart() and admits in one step (mock-ui-server.mjs:1102-1114).
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/release")
    ).status(),
  ).toBe(204);
  const dialog = page.getByRole("dialog", { name: APPROVAL_TITLE });
  await expect(dialog).toBeVisible();
  const approval = requests().find(
    (frame) => frame.method === "approval/requested",
  )!;
  const sessionA = String(approval.params.session_id);

  const titleB = await createSiblingSession(sidebar, WORKSPACE_PARKED);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  const titleC = await createSiblingSession(sidebar, WORKSPACE_PARKED);
  expect(new Set([titleA, titleB, titleC]).size).toBe(3);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  expect(started().map((turn) => turn.text)).not.toContain(trace);

  // correction2150 gap: B/C previously only created the parked A/B/C shape but
  // never ran real work there. Each now runs ONE independent ordinary
  // (non-approval) turn while A stays parked, and must reach ITS EXACT
  // captured (session_id, turn_id) completed terminal exactly once.
  const promptB = "B-independent-turn";
  const promptC = "C-independent-turn";
  await selectSession(sidebar, titleB);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await sendPrompt(page, promptB);
  await selectSession(sidebar, titleC);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await sendPrompt(page, promptC);
  await expect
    .poll(() => started().filter((turn) => turn.text === promptB).length)
    .toBe(1);
  await expect
    .poll(() => started().filter((turn) => turn.text === promptC).length)
    .toBe(1);
  const turnB = started().find((turn) => turn.text === promptB)!;
  const turnC = started().find((turn) => turn.text === promptC)!;
  // B and C own DIFFERENT native ids, each distinct from the parked Session A.
  expect(turnB.sessionId).not.toBe(turnC.sessionId);
  expect(turnB.sessionId).not.toBe(sessionA);
  expect(turnC.sessionId).not.toBe(sessionA);
  expect(turnB.turnId).not.toBe(turnC.turnId);
  const completedTerminals = (turn: StartedTurn) =>
    terminals().filter(
      (terminal) =>
        terminal.sessionId === turn.sessionId &&
        terminal.turnId === turn.turnId &&
        terminal.outcome === "completed",
    );
  await expect.poll(() => completedTerminals(turnB).length).toBe(1);
  await expect.poll(() => completedTerminals(turnC).length).toBe(1);
  // No output leaks either way: A authored no terminal yet, and each B/C
  // Session admitted ONLY its own prompt.
  expect(
    terminals().filter((terminal) => terminal.sessionId === sessionA),
  ).toHaveLength(0);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnB.sessionId)
      .map((turn) => turn.text),
  ).toEqual([promptB]);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnC.sessionId)
      .map((turn) => turn.text),
  ).toEqual([promptC]);
  // Pre-return control on real fixture diagnostics: A is still parked on its
  // ORIGINAL turn, B/C are idle, nothing was approved, and A's queued followup
  // was never admitted.
  const parkedState = await diagnostics(request);
  expect(parkedState.activeBySession[sessionA] ?? null).toMatchObject({
    turn_id: approval.params.turn_id,
    owner: "socket",
  });
  expect(parkedState.activeBySession[turnB.sessionId] ?? null).toBeNull();
  expect(parkedState.activeBySession[turnC.sessionId] ?? null).toBeNull();
  expect(
    responds().filter((frame) => frame.method === "approval/respond"),
  ).toHaveLength(0);
  expect(
    responds().filter((frame) => frame.method === "user_question/respond"),
  ).toHaveLength(0);
  expect(
    requests().filter((frame) => frame.method === "approval/requested"),
  ).toHaveLength(1);
  expect(started().map((turn) => turn.text)).not.toContain(trace);

  // Returning to A restores the parked interaction: the panel replaces the
  // composer again, so the queued strip is NOT re-rendered here (`trace` is
  // still waiting behind the untouched parked record).
  await selectSession(sidebar, titleA);
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await holdTerminals(request, 1);
  await dialog.getByRole("button", { name: /Allow once/ }).click();
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  const respond = responds().filter(
    (frame) => frame.method === "approval/respond",
  );
  expect(respond).toHaveLength(1);
  expect(respond[0]!.params).toMatchObject({
    session_id: sessionA,
    approval_id: approval.params.approval_id,
  });

  await expect
    .poll(() => started().filter((turn) => turn.text === trace).length)
    .toBe(1);
  expect(sessionIdForPrompt(started(), trace)).toBe(sessionA);
  // The terminal arm is consumed at turn START (mock-ui-server.mjs:2796-2798),
  // so once `trace` has started the fixture must report `armed: 0` and hold
  // exactly `trace`'s turn_id. Assert that binding explicitly: a stray `armed`
  // (arm never consumed) or a held turn_id that is not trace's means the hold
  // was bound to the wrong turn, and failing here names the ids instead of a
  // bare 20s poll timeout in releaseHeldTerminal.
  const traceTurn = started().find((turn) => turn.text === trace)!;
  const terminalHold = async () =>
    (await (
      await request.get(FIXTURE_ORIGIN + "/__test__/terminal/state")
    ).json()) as {
      armed: number;
      held: Array<{ session_id: string; turn_id: string }>;
    };
  await expect
    .poll(
      async () =>
        (await terminalHold()).held.some(
          (entry) => entry.turn_id === traceTurn.turnId,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect((await terminalHold()).armed).toBe(0);
  await releaseHeldTerminal(request, sessionA);
  await expect
    .poll(
      () =>
        terminals().filter(
          (terminal) =>
            terminal.sessionId === sessionA && terminal.outcome === "completed",
        ).length,
    )
    .toBe(2);
  expect(interrupts()).toBe(0);

  // Observer reconnect: the transcript and admission count must be stable.
  const admissionCount = started().length;
  await page.reload();
  const restored = productNavigation(page);
  await selectSession(restored, titleA);
  await expect(page.getByText(trace, { exact: true })).toBeVisible();
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await selectSession(restored, titleB);
  await expect(page.getByText(trace, { exact: true })).toHaveCount(0);
  expect(started()).toHaveLength(admissionCount);
  expect(errors().unhandled).toEqual([]);
  expect(errors().consoleErrors).toEqual([]);
});
