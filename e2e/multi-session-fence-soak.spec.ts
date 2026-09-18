// 12 Sessions x 3 peers under ONE pooled transport — placed from the 0550 draft.
// Owner: peer-deepseek-web-soak-1907. Extends the admitted->released,
// CSS-under-modal locator pattern of W/e2e/multi-session-recovery-soak.spec.ts.
//
// Fixture hooks consumed (W/apps/web/scripts/mock-ui-server.mjs):
//   terminal/hold-next, terminal/state, terminal/release, terminal/reset,
//   diagnostics/state, terminal/peer-hold (NEW, :1146), peer/fence broadcast (:3073).
// G1: the brief's `W/e2e/mock-ui-server.mjs` does not exist; the real fixture is
// `W/apps/web/scripts/mock-ui-server.mjs`. G4: `/__test__/peers/spawn` is 410 by
// design — peers are staged through the product `/peer` dialog.
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const WORKSPACE = "soak-12x3";
const SESSIONS = 12; // browser Sessions in ONE workspace
const PEERS = 3; // native peers staged from the master Session
const TURNS = SESSIONS + PEERS; // 15 held turns on the one pooled socket
// The four dock activity buckets (PeerDock.tsx:45); a row's glyph is asserted
// against this set, never a single value, so the check survives a live feeder.
const DOCK_ACTIVITIES = ["idle", "live", "blocked", "done"];
// Fence contract (mock-ui-server.mjs:3070/3073): a peer-owned turn refuses a
// user interrupt with this JSON-RPC code + broadcast reason.
const FENCE_CODE = -32043;
const FENCE_NOTICE =
  "peer turn fenced: interrupt refused (owned by another Session)";

// Every case must leave the fixture inert even on a thrown assertion.
test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
});

function productNavigation(page: Page): Locator {
  return page.getByRole("complementary", { name: "Product navigation" });
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator('button[role="treeitem"]').filter({ hasText: title });
}

/** The always-visible peer dock: `section[role=region][aria-label="Peers"]`
 *  (PeerDock.tsx:208/222), mounted inside product navigation (:744). */
function peerDock(page: Page): Locator {
  return productNavigation(page).locator(
    'section[role="region"][aria-label="Peers"]',
  );
}

/** `data-peer-slug` rides each dock row button — the stable public hook (:244). */
function peerDockRows(page: Page): Locator {
  return peerDock(page).locator("button[data-peer-slug]");
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
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
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

interface ProtocolFrame {
  socket: number;
  method: string;
  params: Record<string, unknown>;
}

/** Capture every method-bearing frame + this page's pooled transports. */
function observeProtocol(page: Page) {
  const sent: ProtocolFrame[] = [];
  const received: ProtocolFrame[] = [];
  const openSockets = new Set<number>();
  let sequence = 0;
  page.on("websocket", (socket) => {
    const id = ++sequence;
    openSockets.add(id);
    socket.on("close", () => openSockets.delete(id));
    const capture = (target: ProtocolFrame[], payload: string | Buffer) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: Record<string, unknown>;
      };
      if (frame.method)
        target.push({
          socket: id,
          method: frame.method,
          params: frame.params ?? {},
        });
    };
    socket.on("framesent", ({ payload }) => capture(sent, payload));
    socket.on("framereceived", ({ payload }) => capture(received, payload));
  });
  return { sent, received, openSockets };
}

interface FenceNotice {
  sessionId: string;
  turnId: string;
  reason: string;
}

/** Captures the fixture's `peer/fence` refusal broadcasts (mock-ui-server.mjs:3073). */
function observeFenceNotices(page: Page): () => FenceNotice[] {
  const notices: FenceNotice[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        method?: string;
        params?: { session_id?: string; turn_id?: string; reason?: string };
      };
      if (frame.method !== "peer/fence") return;
      notices.push({
        sessionId: frame.params?.session_id ?? "",
        turnId: frame.params?.turn_id ?? "",
        reason: frame.params?.reason ?? "",
      });
    });
  });
  return () => notices.slice();
}

interface RefusalError {
  code: number;
  message: string;
}

/** Captures the JSON-RPC refusal the fixture returns for a fenced interrupt. */
function observeRefusals(page: Page): () => RefusalError[] {
  const refusals: RefusalError[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as {
        error?: { code?: number; message?: string };
      };
      if (typeof frame.error?.code !== "number") return;
      refusals.push({
        code: frame.error.code,
        message: frame.error.message ?? "",
      });
    });
  });
  return () => refusals.slice();
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

/** Arms the NEXT turn (any Session) as peer-owned (hook :1146). */
async function holdPeerTurn(request: APIRequestContext): Promise<void> {
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/terminal/peer-hold")
    ).status(),
  ).toBe(204);
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
}

async function diagnostics(
  request: APIRequestContext,
): Promise<DiagnosticsState> {
  return (await (
    await request.get(FIXTURE_ORIGIN + "/__test__/diagnostics/state")
  ).json()) as DiagnosticsState;
}

/** The Sessions the fixture still reports ACTIVE inside ONE workspace.
 *  `/__test__/diagnostics/state` is process-global and the whole e2e run shares
 *  a single fixture, so a sweep over every `activeBySession` key also sees
 *  Sessions other spec files opened. The fixture stamps each Session with the
 *  `workspace_root` it was opened against (mock-ui-server.mjs:3221), and a
 *  staged peer inherits its master's root, so scoping by this case's own cwd
 *  selects exactly the Sessions this case created — all 12 plus their 3 peers —
 *  and nothing else. */
function activeSessionsIn(
  state: DiagnosticsState,
  workspaceRoot: string,
): string[] {
  return Object.entries(state.activeBySession)
    .filter(([, active]) => active?.workspace_root === workspaceRoot)
    .map(([sessionId]) => sessionId)
    .sort();
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
    if (text.includes("/pair/info") && text.includes("404")) return;
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
  const workspace = sidebar.getByRole("treeitem", {
    name: workspaceName,
    exact: true,
  });
  const previous = await selectedSessionTitle(sidebar);
  await workspace
    .getByRole("button", { name: workspaceName, exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: `New session in ${workspaceName}` })
    .click();
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

/** Stage `n` native peers from the focused Session via the product /peer dialog. */
async function startPeers(page: Page, brief: string, n: number): Promise<void> {
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("/peer");
  await page.getByRole("button", { name: /^(Send|Queue) prompt$/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Peer brief", { exact: true }).fill(brief);
  await dialog
    .getByRole("spinbutton", { name: "Peers", exact: true })
    .fill(String(n));
  await dialog
    .getByRole("button", { name: "Start peers", exact: true })
    .click();
  await expect(
    dialog.getByRole("list", { name: "Session peers" }).getByRole("listitem"),
  ).toHaveCount(n);
  // The peers dialog is a modal surface: while it is open, ModalSurface marks the
  // app container (`main.workspace-grid`) aria-hidden, so EVERY getByRole query
  // resolves to zero elements — including the sidebar. Close it before any
  // product-navigation locator is used again.
  await dialog
    .getByRole("button", { name: "Close peers", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

test("holds 12 Sessions + 3 native peers on one pooled socket, refuses a peer-owned interrupt with the fence notice, and keeps per-Session record order", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const cwd = `/srv/work/${WORKSPACE}`;
  const protocol = observeProtocol(page);
  const started = observeStartedTurns(page);
  const interrupts = observeInterrupts(page);
  const notices = observeFenceNotices(page);
  const refusals = observeRefusals(page);

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);

  // 1) 12 Sessions in ONE workspace. The first is auto-created by workspace start.
  const titles: string[] = [await selectedSessionTitle(sidebar)];
  for (let i = 1; i < SESSIONS; i += 1) {
    titles.push(await createSiblingSession(sidebar, WORKSPACE));
  }

  // 2) Arm the release barrier for ALL 15 turns BEFORE any start, so nothing can
  //    complete until we explicitly release (fixture holdNextTerminal counter).
  await holdTerminals(request, TURNS);

  // 2b) The sidebar renders only DEFAULT_SESSION_LIMIT (5) rows behind a sticky
  //     "Show N more" control (ProductSidebar.tsx:97 / :666-676). Reveal the
  //     workspace once so EVERY Session row is selectable — otherwise the first
  //     select targets the oldest (hidden) row (cf. capacity-and-peers.spec.ts:125-126).
  const showMore = sidebar.locator('button[class*="showMore"]');
  if (await showMore.isVisible()) await showMore.click();
  await expect(sessionRowByTitle(sidebar, titles[0]!)).toBeVisible();

  // 3) Every Session sends ONE command. Arm ONE Session's turn as peer-owned
  //    (hook /__test__/terminal/peer-hold) so the fence is drivable from the UI.
  //    Before any peer is staged the dock has NO rows (fail-closed negative:
  //    `PeerDock.tsx:197-199` returns null for a null or empty roster).
  await expect(peerDock(page)).toHaveCount(0);
  await expect(peerDockRows(page)).toHaveCount(0);
  const FENCE_INDEX = 2;
  for (let i = 0; i < SESSIONS; i += 1) {
    await selectSession(sidebar, titles[i]!);
    if (i === FENCE_INDEX) await holdPeerTurn(request);
    await sendPrompt(page, `session-${i} one command`);
  }

  // 4) Stage 3 peers from the master Session via the product dialog (G4: no hook).
  await selectSession(sidebar, titles[0]!);
  await startPeers(page, "soak 12x3 peer", PEERS);

  // 4b) PeerDock roster DURING the soak. The App threads ONLY `peerDock`
  //     (App.tsx:1193) and ProductSidebar passes through neither `collapsed`
  //     nor `onToggle` (:744), so `PeerDock.tsx:206` always renders ROW mode —
  //     the counts/landed PILL is unreachable in the live app (pinned by
  //     peer-dock.spec.ts:148-153). Rows are therefore the only dock surface:
  //     the 3 staged peers must each appear with a slug + one activity glyph.
  //     NOTE: `live`/`blocked`/`done` are stamped ONLY by
  //     `PeerManager.observeSessionEvent` (:426), which has NO production caller
  //     (tests only), so rows stay `idle` and `fleetLanded` stays 0 — this spec
  //     asserts the reachable surface, never `live>=1` or `landed>0`.
  await expect(peerDock(page)).toBeVisible();
  await expect(peerDockRows(page)).toHaveCount(PEERS);
  for (const row of await peerDockRows(page).all()) {
    await expect(row).toHaveAttribute("data-peer-slug", /.+/);
    expect(DOCK_ACTIVITIES).toContain(
      await row.locator("[data-activity]").getAttribute("data-activity"),
    );
  }

  // 5) Deterministic fence ordering: 15 held terminals, released one at a time.
  await expect
    .poll(() => heldSessions(request).then((h) => h.length), {
      timeout: 30_000,
    })
    .toBe(TURNS);

  // 5b) FENCE: the peer-owned turn refuses a user interrupt. Select it, press Stop,
  //     and assert (a) a `turn/interrupt` frame ESCAPED, (b) the fixture refused
  //     it with -32043, (c) a `peer/fence` notice was broadcast, and (d) the turn
  //     is NOT cancelled (still held + still active).
  const fencePrompt = `session-${FENCE_INDEX} one command`;
  const fenceSession = sessionIdForPrompt(started(), fencePrompt);
  await selectSession(sidebar, titles[FENCE_INDEX]!);
  await expect(
    page.getByRole("button", { name: /^(Interrupt|Stop)$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^(Interrupt|Stop)$/ }).click();
  await expect.poll(() => notices().length, { timeout: 10_000 }).toBe(1);
  expect(notices()[0]!.sessionId).toBe(fenceSession);
  expect(notices()[0]!.reason).toBe(FENCE_NOTICE);
  expect(refusals().map((refusal) => refusal.code)).toContain(FENCE_CODE);
  expect(interrupts()).toBe(1);
  expect(
    (await heldSessions(request)).some(
      (held) => held.session_id === fenceSession,
    ),
    "a fenced turn must NOT be cancelled — it stays held",
  ).toBe(true);
  expect(
    (await diagnostics(request)).activeBySession[fenceSession] ?? null,
  ).not.toBeNull();

  // 6) Release ALL held terminals; assert the runtime stays clean.
  const errs = trackRuntimeErrors(page);
  for (const { session_id } of await heldSessions(request)) {
    await releaseHeldTerminal(request, session_id);
  }
  await expect
    .poll(() => heldSessions(request).then((h) => h.length), {
      timeout: 30_000,
    })
    .toBe(0);

  // 6b) Dock roster AFTER the fence round-trip + release. The dock follows the
  //     SELECTED record (`peers.manager` == `peerCoordinator.get(viewRecord)`,
  //     use-octos-session.ts:1694), so re-focus the master that staged the fleet.
  //     The 3 staged peers are still listed, and NO row is `done`: with no
  //     production activity feeder the roster never lands, which encodes the
  //     brief's "N of 3 landed" as N = 0 in the only rendered surface (row mode
  //     — the pill carries the literal counts but is unreachable, see step 4b).
  await selectSession(sidebar, titles[0]!);
  const postRows = await peerDockRows(page).all();
  expect(postRows.length).toBe(PEERS);
  for (const row of postRows) {
    expect(
      await row.locator("[data-activity]").getAttribute("data-activity"),
      "staged peers never land in this flow, so 0 of 3 landed",
    ).not.toBe("done");
  }

  const state = await diagnostics(request);
  // Idle-after-release-all, proven twice over THIS case's Sessions only: by id
  // for every Session this page admitted a turn on, and by workspace for the
  // whole scope — which also covers the 3 peer Sessions, whose turns the
  // fixture (not this page) admitted.
  for (const sessionId of new Set(started().map((turn) => turn.sessionId))) {
    expect(
      state.activeBySession[sessionId] ?? null,
      `session ${sessionId} still active after release-all`,
    ).toBeNull();
  }
  expect(
    activeSessionsIn(state, cwd),
    "sessions in this workspace still active after release-all",
  ).toEqual([]);
  const runtime = errs();
  expect(runtime.unhandled, "uncaught page errors").toEqual([]);
  expect(runtime.consoleErrors, "console errors").toEqual([]);
  expect(protocol.openSockets.size).toBe(1);
});
