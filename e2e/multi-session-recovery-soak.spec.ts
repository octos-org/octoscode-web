import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const SLOW_PREFIX = "Continue this turn while I open another Session";
const WORKSPACE_NAME = "multi-session-recovery-soak";
const WAVES = 2;
const WORKSPACE_PARKED = `${WORKSPACE_NAME}-parked`;
const WORKSPACE_STACKED = `${WORKSPACE_NAME}-stacked`;
const APPROVAL_TITLE = "Run product checks?";
const WORKSPACE_RECONNECT = `${WORKSPACE_NAME}-reconnect`;

// Every case must leave the fixture inert even when an assertion throws.
test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
});

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator('button[role="treeitem"]').filter({ hasText: title });
}

async function selectedSessionTitle(sidebar: Locator): Promise<string> {
  const title = await sidebar
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!title) throw new Error("Expected a selected Session title");
  return title;
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
  const chooser = page.getByRole("region", { name: /Choose a workspace|Add workspace/ });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible()) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: /Add & Start|Start session/ }).click();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
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

interface TransportObservation {
  live: () => number;
  created: () => number;
  peak: () => number;
}

/** Counts this page's pooled WebSocket transports: ONE open, no extras. */
function observeLiveTransports(page: Page): TransportObservation {
  const open = new Set<number>();
  let created = 0;
  let peak = 0;
  page.on("websocket", (socket) => {
    const id = ++created;
    open.add(id);
    peak = Math.max(peak, open.size);
    socket.on("close", () => open.delete(id));
  });
  return { live: () => open.size, created: () => created, peak: () => peak };
}

interface HydratedTurnSnapshot {
  sessionId: string;
  turns: Array<{ turn_id: string; state: string }>;
}

/** Captures each authoritative session/hydrate reconciliation this page receives. */
function observeHydratedTurns(page: Page): () => HydratedTurnSnapshot[] {
  const snapshots: HydratedTurnSnapshot[] = [];
  page.on("websocket", (socket) => {
    const pending = new Map<string, string>();
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        id?: string;
        method?: string;
        params?: { session_id?: string };
      };
      const params = frame.params;
      if (
        frame.method === "session/hydrate" &&
        typeof frame.id === "string" &&
        typeof params?.session_id === "string"
      ) {
        pending.set(frame.id, params.session_id);
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        id?: string;
        result?: { turns?: Array<{ turn_id?: string; state?: string }> };
      };
      const requestId = frame.id;
      if (typeof requestId !== "string") return;
      const sessionId = pending.get(requestId);
      if (!sessionId || !frame.result?.turns) return;
      pending.delete(requestId);
      snapshots.push({
        sessionId,
        turns: frame.result.turns.map((turn) => ({
          turn_id: turn.turn_id ?? "",
          state: turn.state ?? "",
        })),
      });
    });
  });
  return () => snapshots.slice();
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

interface DiagnosticsState {
  activeBySession: Record<string, { turn_id: string; owner: string } | null>;
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
    if (message.type() === "error") consoleErrors.push(message.text());
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
    '[role="treeitem"][aria-label="' + workspaceName + '"]',
  );
  // Creating a sibling selects it, but selection only moves a beat AFTER the
  // click. Capture the current selection first, then wait until it changes, so
  // we never read the previous Session's title as if it were the new sibling's.
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

async function selectSession(sidebar: Locator, title: string): Promise<void> {
  const row = sessionRowByTitle(sidebar, title);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page");
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill(text);
  await page.getByRole("button", { name: /^(Send|Queue) prompt$/ }).click();
}

test("runs bounded repeated waves across three progressing Sessions with per-Session queued followups", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const cwd = `/srv/work/${WORKSPACE_NAME}`;
  const started = observeStartedTurns(page);
  const terminals = observeTerminals(page);
  const interrupts = observeInterrupts(page);
  const errors = trackRuntimeErrors(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });

  const titles = [await selectedSessionTitle(sidebar)];
  for (let index = 0; index < 2; index += 1) {
    titles.push(await createSiblingSession(sidebar, WORKSPACE_NAME));
  }
  await expect(sessions).toHaveCount(3);
  expect(new Set(titles).size).toBe(3);

  for (let wave = 1; wave <= WAVES; wave += 1) {
    // One held terminal per Session: the primary parks at its tail and only
    // its queued followup may drain after an explicit per-Session release.
    await holdTerminals(request, 3);
    // Fixture records the FULL prompt text on turn/start, so the oracle must
    // key on exactly what sendPrompt transmits (SLOW_PREFIX included).
    const primary = [0, 1, 2].map(
      (index) => `${SLOW_PREFIX} w${wave}-s${index}1`,
    );
    const queued = [0, 1, 2].map((index) => `w${wave}-s${index}2`);
    for (let index = 0; index < 3; index += 1) {
      await selectSession(sidebar, titles[index]!);
      await sendPrompt(page, primary[index]!);
      await expect(
        page.getByRole("button", { name: /^(Interrupt|Stop)$/ }),
      ).toBeVisible();
      await sendPrompt(page, queued[index]!);
      await expect(page.getByText(/\b1 queued\b/)).toBeVisible();
    }
    const active = await diagnostics(request);
    expect(
      Object.values(active.activeBySession).filter(
        (turn) => turn?.owner === "socket",
      ),
    ).toHaveLength(3);
    expect(interrupts()).toBe(0);

    // Release each Session's held terminal in turn; only that Session's queued
    // followup may start, and it must carry the SAME session id.
    for (let index = 0; index < 3; index += 1) {
      const sessionId = sessionIdForPrompt(started(), primary[index]!);
      await releaseHeldTerminal(request, sessionId);
      // A Session accumulates one primary+followup pair per completed wave,
      // so the exact expected history grows with the wave number.
      const history: string[] = [];
      for (let prior = 1; prior <= wave; prior += 1) {
        history.push(
          `${SLOW_PREFIX} w${prior}-s${index}1`,
          `w${prior}-s${index}2`,
        );
      }
      await expect
        .poll(() =>
          started()
            .filter((turn) => turn.sessionId === sessionId)
            .map((turn) => turn.text),
        )
        .toEqual(history);
      await expect
        .poll(
          () =>
            terminals().filter(
              (terminal) =>
                terminal.sessionId === sessionId &&
                terminal.outcome === "completed",
            ).length,
        )
        .toBe(wave * 2);
    }

    // Exactly six admissions this wave, all distinct — no duplicate kickoff
    // and no automatic re-start of an already-terminal turn.
    const waveStarts = started().filter((turn) =>
      turn.text.includes(`w${wave}-s`),
    );
    expect(waveStarts).toHaveLength(6);
    expect(new Set(waveStarts.map((turn) => turn.turnId)).size).toBe(6);
  }

  for (let index = 0; index < 3; index += 1) {
    await selectSession(sidebar, titles[index]!);
    for (let wave = 1; wave <= WAVES; wave += 1) {
      await expect(
        page.getByText(`${SLOW_PREFIX} w${wave}-s${index}1`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(`w${wave}-s${index}2`, { exact: true }),
      ).toBeVisible();
    }
    for (let other = 0; other < 3; other += 1) {
      if (other === index) continue;
      await expect(
        page.getByText(new RegExp(`w\\d-s${other}[12]`)),
      ).toHaveCount(0);
    }
  }
  expect(interrupts()).toBe(0);
  expect(started()).toHaveLength(WAVES * 6);
  // Real fixture counters: 12 admitted turns (WAVES x 3 Sessions x 2), all
  // routed to exactly three concurrently progressing Session ids.
  expect(new Set(started().map((turn) => turn.sessionId)).size).toBe(3);
  expect(new Set(started().map((turn) => turn.turnId)).size).toBe(WAVES * 6);
  const settled = await diagnostics(request);
  expect(
    Object.values(settled.activeBySession).filter(
      (turn) => turn?.owner === "socket",
    ),
  ).toHaveLength(0);
  expect(errors().unhandled).toEqual([]);
  expect(errors().consoleErrors).toEqual([]);
});

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
  // The composer — and the `.prompt-queue` strip it renders — is mounted only
  // while NO interaction owns the surface: the shipped contract swaps in
  // ApprovalPanel/UserQuestionPanel and replaces `.composer` outright
  // (local-preferences.spec.ts:112-117, interaction-ownership.spec.ts:442,
  // modal-a11y.spec.ts:98). The "1 queued" observation therefore has to happen
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
  await dialog.getByRole("button", { name: /Yes/ }).click();
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

test("resolves three concurrent parked background approvals out of order without cross-Session leakage", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = `/srv/work/${WORKSPACE_STACKED}`;
  const started = observeStartedTurns(page);
  const terminals = observeTerminals(page);
  const interrupts = observeInterrupts(page);
  const requests = observeInteractionRequests(page);
  const responds = observeRespondFrames(page);
  const errors = trackRuntimeErrors(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const dialog = page.getByRole("dialog", { name: APPROVAL_TITLE });

  const titles = [await selectedSessionTitle(sidebar)];
  for (let index = 0; index < 2; index += 1) {
    titles.push(await createSiblingSession(sidebar, WORKSPACE_STACKED));
  }
  expect(new Set(titles).size).toBe(3);

  // Park one approval per Session, then leave all three pending at once.
  for (const title of titles) {
    await selectSession(sidebar, title);
    await sendPrompt(page, "Request approval fixture");
    await expect(dialog).toBeVisible();
  }
  await expect.poll(() => requests().length).toBe(3);
  const parked = requests().map((frame) => {
    const { session_id, approval_id, turn_id } = frame.params;
    if (
      typeof session_id !== "string" ||
      typeof approval_id !== "string" ||
      typeof turn_id !== "string" ||
      turn_id.length === 0
    ) {
      throw new Error(
        "approval/requested must carry real session_id/approval_id/turn_id",
      );
    }
    return { sessionId: session_id, approvalId: approval_id, turnId: turn_id };
  });
  expect(new Set(parked.map((entry) => entry.sessionId)).size).toBe(3);
  expect(new Set(parked.map((entry) => entry.approvalId)).size).toBe(3);
  // Each parked approval must name exactly ONE observed turn/start with the
  // same Session and turn, and the three parked turns must be distinct.
  for (const entry of parked) {
    expect(
      started().filter(
        (turn) =>
          turn.sessionId === entry.sessionId && turn.turnId === entry.turnId,
      ),
    ).toHaveLength(1);
  }
  expect(new Set(parked.map((entry) => entry.turnId)).size).toBe(3);
  const active = await diagnostics(request);
  expect(
    Object.values(active.activeBySession).filter(
      (turn) => turn?.owner === "socket",
    ),
  ).toHaveLength(3);
  expect(interrupts()).toBe(0);

  // Resolve C, then B, then A: each response must carry that Session's own ids.
  for (const index of [2, 1, 0]) {
    await selectSession(sidebar, titles[index]!);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Yes/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => responds().length).toBe(3 - index);
  }

  const resolved = responds().filter(
    (frame) => frame.method === "approval/respond",
  );
  expect(resolved).toHaveLength(3);
  const pair = (sessionId: unknown, approvalId: unknown) =>
    `${String(sessionId)}|${String(approvalId)}`;
  expect(
    resolved
      .map((frame) => pair(frame.params.session_id, frame.params.approval_id))
      .sort(),
  ).toEqual(
    parked.map((entry) => pair(entry.sessionId, entry.approvalId)).sort(),
  );

  for (const entry of parked) {
    await expect
      .poll(
        () =>
          terminals().filter(
            (terminal) =>
              terminal.sessionId === entry.sessionId &&
              terminal.turnId === entry.turnId &&
              terminal.outcome === "completed",
          ).length,
      )
      .toBe(1);
  }
  expect(started()).toHaveLength(3);
  expect(new Set(started().map((turn) => turn.sessionId)).size).toBe(3);
  expect(interrupts()).toBe(0);
  expect(errors().unhandled).toEqual([]);
  expect(errors().consoleErrors).toEqual([]);
});

test("keeps exactly ONE live transport while an active A and its queued A2 recover across a transport disconnect", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const cwd = `/srv/work/${WORKSPACE_RECONNECT}`;
  const started = observeStartedTurns(page);
  const terminals = observeTerminals(page);
  const interrupts = observeInterrupts(page);
  const hydrates = observeHydratedTurns(page);
  const transports = observeLiveTransports(page);
  const errors = trackRuntimeErrors(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);

  // A owns the ONE active turn; its terminal is held so A2 cannot drain yet.
  const a1Prompt = "A-reconnect-active";
  const a2Prompt = "A-reconnect-queued";
  await holdTerminals(request, 1);
  const titleA = await selectedSessionTitle(sidebar);
  await sendPrompt(page, a1Prompt);
  await expect(
    page.getByRole("button", { name: /^(Interrupt|Stop)$/ }),
  ).toBeVisible();
  await sendPrompt(page, a2Prompt);
  await expect(page.getByText(/\b1 queued\b/)).toBeVisible();

  // BEFORE the disconnect the REAL dispatch state — not a quiescent reload — is
  // proven from captured frames + the live fixture: A is active on its exact
  // captured turn id and A2 is still queued (never admitted).
  const sessionA = sessionIdForPrompt(started(), a1Prompt);
  const turnA1 = started().find((turn) => turn.text === a1Prompt)!.turnId;
  expect(started().map((turn) => turn.text)).toEqual([a1Prompt]);
  const activeBefore = await diagnostics(request);
  expect(activeBefore.activeBySession[sessionA] ?? null).toMatchObject({
    turn_id: turnA1,
    owner: "socket",
  });
  // The pooled client already holds exactly ONE live transport.
  expect(transports.live()).toBe(1);
  const createdBeforeDisconnect = transports.created();

  // B and C make real progress concurrently while A stays active + queued.
  const titleB = await createSiblingSession(sidebar, WORKSPACE_RECONNECT);
  await sendPrompt(page, "B-reconnect-progress");
  const titleC = await createSiblingSession(sidebar, WORKSPACE_RECONNECT);
  await sendPrompt(page, "C-reconnect-progress");
  expect(new Set([titleA, titleB, titleC]).size).toBe(3);
  await expect
    .poll(
      () =>
        started().filter((turn) => turn.text === "B-reconnect-progress").length,
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        started().filter((turn) => turn.text === "C-reconnect-progress").length,
    )
    .toBe(1);
  const turnB = started().find((turn) => turn.text === "B-reconnect-progress")!;
  const turnC = started().find((turn) => turn.text === "C-reconnect-progress")!;
  const completedFor = (turn: StartedTurn) =>
    terminals().filter(
      (terminal) =>
        terminal.sessionId === turn.sessionId &&
        terminal.turnId === turn.turnId &&
        terminal.outcome === "completed",
    );
  await expect.poll(() => completedFor(turnB).length).toBe(1);
  await expect.poll(() => completedFor(turnC).length).toBe(1);
  // Switching Sessions must NOT multiply transports: still one pooled socket.
  expect(transports.live()).toBe(1);

  // Kill the owner transport: the fixture terminates owner-socket active turns.
  expect(
    (await request.post(FIXTURE_ORIGIN + "/__test__/disconnect")).status(),
  ).toBe(204);

  // The client replaces its single transport and re-hydrates. The authoritative
  // hydrate must report A1 as INTERRUPTED — a fabricated completed terminal is
  // exactly what this case forbids.
  await expect
    .poll(
      () =>
        hydrates().some(
          (snapshot) =>
            snapshot.sessionId === sessionA &&
            snapshot.turns.some(
              (turn) => turn.turn_id === turnA1 && turn.state === "interrupted",
            ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect.poll(() => transports.live(), { timeout: 20_000 }).toBe(1);
  // Successive replacement was allowed, but never two open at once.
  expect(transports.peak()).toBeLessThanOrEqual(1);
  expect(transports.created()).toBeGreaterThan(createdBeforeDisconnect);

  // A2 drains against A's SAME captured Session id, exactly once, with its own
  // turn id distinct from A1's — no duplicate start, no cross-Session delivery.
  await expect
    .poll(
      () =>
        started()
          .filter((turn) => turn.sessionId === sessionA)
          .map((turn) => turn.text),
      { timeout: 20_000 },
    )
    .toEqual([a1Prompt, a2Prompt]);
  const a2Turns = started().filter((turn) => turn.text === a2Prompt);
  expect(a2Turns).toHaveLength(1);
  const turnA2 = a2Turns[0]!.turnId;
  expect(turnA2).not.toBe(turnA1);
  const aTerminals = () => terminals().filter((t) => t.sessionId === sessionA);
  // A1 never fabricates success: no completed terminal for its id.
  expect(
    aTerminals().filter(
      (terminal) =>
        terminal.turnId === turnA1 && terminal.outcome === "completed",
    ),
  ).toHaveLength(0);
  // A2 is the ONE ordinary turn that completes on A after recovery.
  await expect
    .poll(
      () =>
        aTerminals().filter(
          (terminal) =>
            terminal.turnId === turnA2 && terminal.outcome === "completed",
        ).length,
      { timeout: 20_000 },
    )
    .toBe(1);

  // Exactly four real admissions (A1, A2, B, C), all distinct, over three
  // Sessions; B/C were untouched by A's transport loss.
  expect(started()).toHaveLength(4);
  expect(new Set(started().map((turn) => turn.turnId)).size).toBe(4);
  expect(new Set(started().map((turn) => turn.sessionId)).size).toBe(3);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnB.sessionId)
      .map((turn) => turn.text),
  ).toEqual(["B-reconnect-progress"]);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnC.sessionId)
      .map((turn) => turn.text),
  ).toEqual(["C-reconnect-progress"]);
  // No user-initiated interrupt: A1 died by connection_closed, not by Stop.
  expect(interrupts()).toBe(0);
  const settled = await diagnostics(request);
  expect(
    Object.values(settled.activeBySession).filter(
      (turn) => turn?.owner === "socket",
    ),
  ).toHaveLength(0);
  expect(transports.live()).toBe(1);
  // No uncaught page errors across the reconnect (reconnect warnings are legit).
  expect(errors().unhandled).toEqual([]);
});
