import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const DEFAULT_WORKSPACE = "/workspace/octoscode-web";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function productNavigation(page: Page): Locator {
  return page.getByRole("complementary", { name: "Product navigation" });
}

async function connectServer(
  page: Page,
  token = "tab-scoped-e2e-token",
): Promise<Locator> {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page.getByLabel("Session id")).toHaveCount(0);
  await expect(page.getByLabel("Profile id")).toHaveCount(0);
  await expect(page.getByLabel("Server workspace")).toHaveCount(0);

  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const navigation = productNavigation(page);
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(navigation).toBeVisible();
  await expect(chooser).toBeVisible();
  await expect(
    chooser.getByRole("heading", { name: "Choose a workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Session views" }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeHidden();
  await expect(navigation.getByRole("treeitem")).toHaveCount(0);
  return chooser;
}

async function requestInitialWorkspace(page: Page, cwd: string): Promise<void> {
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace).toBeVisible();
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Add & Start" }).click();
  await expect(addWorkspace).toBeHidden();
}

async function startWorkspace(
  page: Page,
  cwd = DEFAULT_WORKSPACE,
): Promise<void> {
  await requestInitialWorkspace(page, cwd);
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
}

async function connectAndStartWorkspace(
  page: Page,
  cwd = DEFAULT_WORKSPACE,
  token = "tab-scoped-e2e-token",
): Promise<void> {
  await connectServer(page, token);
  await startWorkspace(page, cwd);
}

async function openSettings(page: Page): Promise<Locator> {
  await productNavigation(page)
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

function sessionRowByTitle(sidebar: Locator, title: string): Locator {
  return sidebar.locator('button[role="treeitem"]').filter({ hasText: title });
}

interface ObservedSessionOpen {
  sessionId: string;
}

interface TurnStartControlState {
  armed: boolean;
  held: { session_id: string; turn_id: string } | null;
}

function observeSessionOpens(page: Page): ObservedSessionOpen[] {
  const opened: ObservedSessionOpen[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"method":"session/open"')) return;
      const request = JSON.parse(frame) as {
        params?: { session_id?: unknown };
      };
      if (typeof request.params?.session_id === "string") {
        opened.push({ sessionId: request.params.session_id });
      }
    });
  });
  return opened;
}

async function holdNextTurnStart(request: APIRequestContext): Promise<void> {
  const reset = await request.post(
    `${FIXTURE_ORIGIN}/__test__/turn-start/reset`,
  );
  expect(reset.status()).toBe(204);
  const armed = await request.post(
    `${FIXTURE_ORIGIN}/__test__/turn-start/hold-next`,
  );
  expect(armed.status()).toBe(204);
}

async function waitForHeldTurnStart(
  request: APIRequestContext,
): Promise<TurnStartControlState> {
  let state: TurnStartControlState | null = null;
  await expect
    .poll(async () => {
      const response = await request.get(
        `${FIXTURE_ORIGIN}/__test__/turn-start/state`,
      );
      expect(response.ok()).toBe(true);
      state = (await response.json()) as TurnStartControlState;
      return state.held?.turn_id ?? null;
    })
    .not.toBeNull();
  if (!state) throw new Error("Expected a held turn/start acknowledgement");
  return state;
}

async function settleHeldTurnStart(
  request: APIRequestContext,
  outcome: "release" | "reject",
): Promise<void> {
  const response = await request.post(
    `${FIXTURE_ORIGIN}/__test__/turn-start/${outcome}`,
  );
  expect(response.status()).toBe(204);
}

async function rejectNextSessionOpen(
  request: APIRequestContext,
): Promise<void> {
  const reset = await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-open/reset`,
  );
  expect(reset.status()).toBe(204);
  const armed = await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-open/reject-next`,
  );
  expect(armed.status()).toBe(204);
}

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reset`);
  await request.post(`${FIXTURE_ORIGIN}/__test__/session-open/reset`);
});

test("uses the DSH-aligned product sidebar and grouped or flat session views", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const sidebar = productNavigation(page);

  await expect(sidebar.getByText("Octoscode", { exact: true })).toBeVisible();
  const primaryNewSession = sidebar
    .getByRole("button", { name: "New session", exact: true })
    .last();
  await expect(primaryNewSession).toBeVisible();
  await expect(primaryNewSession.locator("[data-octopus-logo]")).toHaveCount(1);
  await expect(
    sidebar.getByRole("tree", { name: "Workspaces and sessions" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("treeitem", { name: "octoscode-web", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar
      .locator('button[aria-label="New session in octoscode-web"]')
      .locator("[data-octopus-logo]"),
  ).toHaveCount(1);
  await expect(
    sidebar.locator('[role="treeitem"][aria-current="page"]'),
  ).toContainText("Session ");

  await sidebar.getByRole("button", { name: "Session view options" }).click();
  let menu = sidebar.getByRole("menu", { name: "Session view options" });
  await expect(
    menu.getByRole("menuitemradio", { name: "Workspace" }),
  ).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "In one list" }).click();

  await expect(sidebar.getByRole("tree", { name: "Sessions" })).toBeVisible();
  await expect(sidebar.getByText("Sessions", { exact: true })).toBeVisible();
  await expect(
    sidebar.getByRole("treeitem", { name: "octoscode-web", exact: true }),
  ).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Session view options" }).click();
  menu = sidebar.getByRole("menu", { name: "Session view options" });
  await menu.getByRole("menuitemradio", { name: "Workspace" }).click();
  await expect(
    sidebar.getByRole("tree", { name: "Workspaces and sessions" }),
  ).toBeVisible();
});

test("authenticates before any session and owns workspace selection in the hero", async ({
  page,
}) => {
  const openedMethods: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (frame.includes('"method":"session/open"')) {
        openedMethods.push(frame);
      }
    });
  });

  const chooser = await connectServer(page);

  expect(openedMethods).toEqual([]);
  await expect(
    page.getByText("Ship octoscode-web", { exact: true }),
  ).toHaveCount(0);
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  await expect(
    page.getByRole("region", { name: "Add workspace" }),
  ).toBeVisible();
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
  await expect(page.getByLabel("Session id")).toHaveCount(0);
  await expect(page.getByLabel("Profile id")).toHaveCount(0);
});

test("keeps authentication when a remembered Session can no longer open", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/stale-restore");
  await page.request.post(`${FIXTURE_ORIGIN}/__test__/reject-opened`);

  let restoreOpenCount = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"session/open"')) {
        restoreOpenCount += 1;
      }
    });
  });

  await page.reload();
  await expect(productNavigation(page)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Choose a workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Choose a workspace" }).getByRole("alert"),
  ).toContainText("saved Session is no longer available");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toHaveCount(0);
  await expect.poll(() => restoreOpenCount).toBe(1);

  await page.reload();
  await expect(productNavigation(page)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Choose a workspace" }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  expect(restoreOpenCount).toBe(1);

  await requestInitialWorkspace(page, "/srv/work/recovered-after-stale");
  await expect(
    page.getByText("/srv/work/recovered-after-stale", { exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
});

test("keeps multiple confirmed Sessions in one Workspace and can reopen either", async ({
  page,
}) => {
  const cwd = "/srv/work/per-workspace-session";
  let deleteRequests = 0;
  const openedSessions: Array<{ sessionId: string; profileId?: string }> = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (frame.includes('"method":"session/delete"')) {
        deleteRequests += 1;
      }
      if (!frame.includes('"method":"session/open"')) return;
      const request = JSON.parse(frame) as {
        params?: { session_id?: unknown; profile_id?: unknown };
      };
      if (typeof request.params?.session_id === "string") {
        openedSessions.push({
          sessionId: request.params.session_id,
          ...(typeof request.params.profile_id === "string"
            ? { profileId: request.params.profile_id }
            : {}),
        });
      }
    });
  });
  await connectServer(page);
  await startWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const workspace = sidebar.getByRole("treeitem", {
    name: "per-workspace-session",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  const openSessions = sidebar.getByRole("treeitem", {
    name: /Session /,
  });
  await expect(openSessions).toHaveCount(1);
  const originalTitle = await openSessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalTitle) throw new Error("Expected a confirmed Session title");

  await workspace
    .getByRole("button", { name: "per-workspace-session", exact: true })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in per-workspace-session",
    })
    .click();

  await expect(openSessions).toHaveCount(2);
  await expect.poll(() => openedSessions.length).toBeGreaterThanOrEqual(2);
  expect(openedSessions[0]?.sessionId).not.toBe(openedSessions[1]?.sessionId);
  await expect(openSessions.first()).toHaveAttribute("aria-current", "page");
  const originalSession = sessionRowByTitle(sidebar, originalTitle);
  await originalSession.click();
  await expect(originalSession).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => openedSessions.at(-1)?.sessionId)
    .toBe(openedSessions[0]?.sessionId);
  expect(openedSessions.at(-1)?.profileId).toBe(openedSessions[0]?.profileId);
  await expect(openSessions).toHaveCount(2);
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  expect(deleteRequests).toBe(0);

  await page.reload();
  const restoredSessions = productNavigation(page).getByRole("treeitem", {
    name: /Session /,
  });
  await expect(restoredSessions).toHaveCount(2);
  await expect(
    sessionRowByTitle(productNavigation(page), originalTitle),
  ).toHaveAttribute("aria-current", "page");
});

test("keeps a server-accepted turn running while another Session is focused", async ({
  page,
}) => {
  const cwd = "/srv/work/background-session";
  let ownerSocketSeen = false;
  let ownerSocketClosed = false;
  let ownerSocketReopens = 0;
  page.on("websocket", (socket) => {
    let ownsStartedTurn = false;
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (ownsStartedTurn && frame.includes('"method":"session/open"')) {
        ownerSocketReopens += 1;
      }
      if (frame.includes('"method":"turn/start"')) {
        ownsStartedTurn = true;
        ownerSocketSeen = true;
      }
    });
    socket.on("close", () => {
      if (ownsStartedTurn) ownerSocketClosed = true;
    });
  });

  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  const originalTitle = await sessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalTitle) throw new Error("Expected a confirmed Session title");

  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Continue this turn while I open another Session");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect.poll(() => ownerSocketSeen).toBe(true);

  const workspace = sidebar.getByRole("treeitem", {
    name: "background-session",
    exact: true,
  });
  await workspace
    .getByRole("button", { name: "background-session", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in background-session" })
    .click();

  await expect(sessions).toHaveCount(2);
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible();
  expect(ownerSocketClosed).toBe(false);
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toHaveCount(0);

  const backgroundSession = sessionRowByTitle(sidebar, originalTitle);
  await backgroundSession.click();
  await expect(backgroundSession).toHaveAttribute("aria-current", "page");
  expect(ownerSocketClosed).toBe(false);
  expect(ownerSocketReopens).toBeGreaterThanOrEqual(1);

  // Reclaiming a terminal owner must preserve its tail lease. Switching away
  // again without starting another turn must park the same socket, not close it.
  const siblingSession = sessions.filter({ hasNotText: originalTitle }).first();
  await siblingSession.click();
  await expect(siblingSession).toHaveAttribute("aria-current", "page");
  expect(ownerSocketClosed).toBe(false);
  await backgroundSession.click();
  await expect(backgroundSession).toHaveAttribute("aria-current", "page");
  expect(ownerSocketClosed).toBe(false);
  expect(ownerSocketReopens).toBeGreaterThanOrEqual(2);

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => ownerSocketClosed).toBe(true);
});

test("queues one New Session click until turn/start is accepted", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/delayed-turn-start-new-session";
  const sessionOpens = observeSessionOpens(page);
  let interruptRequests = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/interrupt"')) {
        interruptRequests += 1;
      }
    });
  });
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const originalTitle = await sessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalTitle) throw new Error("Expected a confirmed Session title");

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Continue this turn while I open another Session");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  const held = await waitForHeldTurnStart(request);
  expect(held.armed).toBe(false);

  await composer.fill("/stop");
  await page.getByRole("button", { name: "Queue prompt" }).click();
  await expect(
    page.getByText("Turn is still starting", { exact: true }),
  ).toBeVisible();
  expect(interruptRequests).toBe(0);

  const opensBeforeNavigation = sessionOpens.length;
  const workspace = sidebar.getByRole("treeitem", {
    name: "delayed-turn-start-new-session",
    exact: true,
  });
  await workspace
    .getByRole("button", {
      name: "delayed-turn-start-new-session",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in delayed-turn-start-new-session",
    })
    .click();

  await expect(sessions).toHaveCount(1);
  expect(sessionOpens).toHaveLength(opensBeforeNavigation);
  await expect(
    sidebar.getByRole("alert").filter({
      hasText: "Wait for Octos to accept the current turn",
    }),
  ).toHaveCount(0);

  await settleHeldTurnStart(request, "release");

  await expect(sessions).toHaveCount(2);
  await expect.poll(() => sessionOpens.length).toBe(opensBeforeNavigation + 1);
  const siblingSession = sessions.filter({ hasNotText: originalTitle });
  await expect(siblingSession).toHaveAttribute("aria-current", "page");
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible();
});

test("drops a queued Session creation when turn/start is rejected", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/rejected-turn-start-navigation";
  const sessionOpens = observeSessionOpens(page);
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const originalSession = sessions.first();

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Reject this fixture turn before it starts");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  await waitForHeldTurnStart(request);

  const opensBeforeNavigation = sessionOpens.length;
  const workspace = sidebar.getByRole("treeitem", {
    name: "rejected-turn-start-navigation",
    exact: true,
  });
  await workspace
    .getByRole("button", {
      name: "rejected-turn-start-navigation",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in rejected-turn-start-navigation",
    })
    .click();

  await settleHeldTurnStart(request, "reject");

  await expect(page.getByText("Turn rejected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Fixture rejected turn/start before acceptance", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Starting/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(sessions).toHaveCount(1);
  await expect(originalSession).toHaveAttribute("aria-current", "page");
  expect(sessionOpens).toHaveLength(opensBeforeNavigation);
  await expect(
    sidebar.getByRole("alert").filter({
      hasText: "Wait for Octos to accept the current turn",
    }),
  ).toHaveCount(0);
});

test("releases pending navigation when recovery proves the held start active", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/recovery-admits-held-turn";
  const sessionOpens = observeSessionOpens(page);
  const hydrateSessions: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      if (!frame.includes('"method":"session/hydrate"')) return;
      const hydrate = JSON.parse(frame) as {
        params?: { session_id?: unknown };
      };
      if (typeof hydrate.params?.session_id === "string") {
        hydrateSessions.push(hydrate.params.session_id);
      }
    });
  });
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill(
    "Recover this accepted turn before the RPC reply arrives",
  );
  await page.getByRole("button", { name: "Send prompt" }).click();
  const held = await waitForHeldTurnStart(request);
  if (!held.held) throw new Error("Expected the held Session identity");

  const opensBeforeNavigation = sessionOpens.length;
  const workspace = sidebar.getByRole("treeitem", {
    name: "recovery-admits-held-turn",
    exact: true,
  });
  await workspace
    .getByRole("button", { name: "recovery-admits-held-turn", exact: true })
    .hover();
  await sidebar
    .getByRole("button", { name: "New session in recovery-admits-held-turn" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "New Session opens next" }),
  ).toBeVisible();

  const hydratesBeforeRecovery = hydrateSessions.length;
  await request.post(`${FIXTURE_ORIGIN}/__test__/replay-lossy`);

  await expect(sessions).toHaveCount(2);
  await expect.poll(() => sessionOpens.length).toBe(opensBeforeNavigation + 1);
  await expect
    .poll(
      () =>
        hydrateSessions
          .slice(hydratesBeforeRecovery)
          .filter((sessionId) => sessionId === held.held?.session_id).length,
    )
    .toBe(1);
  await expect(page.getByRole("button", { name: /^Starting/ })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /opens next|recovery before/ }),
  ).toHaveCount(0);

  await settleHeldTurnStart(request, "release");
  await expect(sessions).toHaveCount(2);
  expect(sessionOpens).toHaveLength(opensBeforeNavigation + 1);
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible();
});

test("parks a recovery-admitted approval as Waiting, not Working", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/recovery-admits-waiting-turn";
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const originalTitle = await sessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalTitle) throw new Error("Expected the source Session title");

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Request approval fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await waitForHeldTurnStart(request);

  const workspace = sidebar.getByRole("treeitem", {
    name: "recovery-admits-waiting-turn",
    exact: true,
  });
  await workspace
    .getByRole("button", {
      name: "recovery-admits-waiting-turn",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in recovery-admits-waiting-turn",
    })
    .click();

  await request.post(`${FIXTURE_ORIGIN}/__test__/replay-lossy`);

  await expect(sessions).toHaveCount(2);
  await expect(sessionRowByTitle(sidebar, originalTitle)).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.locator('[title="Waiting for input"]')).toBeVisible();
  await expect(sidebar.locator('[title="Working in background"]')).toHaveCount(
    0,
  );

  await settleHeldTurnStart(request, "release");
  await expect(sidebar.locator('[title="Waiting for input"]')).toBeVisible();
});

for (const scenario of [
  {
    name: "request",
    prompt: "Buffer approval during recovery fixture",
    expectedStatus: "Waiting for input",
    staleStatus: "Working in background",
  },
  {
    name: "resolution",
    prompt: "Resolve approval during recovery fixture",
    expectedStatus: "Working in background",
    staleStatus: "Waiting for input",
  },
] as const) {
  test(`folds a buffered approval ${scenario.name} before parking the Session`, async ({
    page,
    request,
  }) => {
    const cwd = `/srv/work/recovery-buffered-approval-${scenario.name}`;
    await connectAndStartWorkspace(page, cwd);

    const sidebar = productNavigation(page);
    const sessions = sidebar.getByRole("treeitem", { name: /Session / });
    await expect(sessions).toHaveCount(1);
    const originalTitle = await sessions
      .first()
      .locator('[class*="sessionTitle"]')
      .textContent();
    if (!originalTitle) throw new Error("Expected the source Session title");

    await holdNextTurnStart(request);
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await composer.fill(scenario.prompt);
    await page.getByRole("button", { name: "Send prompt" }).click();
    await waitForHeldTurnStart(request);

    const workspaceName = `recovery-buffered-approval-${scenario.name}`;
    const workspace = sidebar.getByRole("treeitem", {
      name: workspaceName,
      exact: true,
    });
    await workspace
      .getByRole("button", { name: workspaceName, exact: true })
      .hover();
    await sidebar
      .getByRole("button", { name: `New session in ${workspaceName}` })
      .click();
    await request.post(`${FIXTURE_ORIGIN}/__test__/replay-lossy`);

    await expect(sessions).toHaveCount(2);
    await expect(sessionRowByTitle(sidebar, originalTitle)).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      sidebar.locator(`[title="${scenario.expectedStatus}"]`),
    ).toBeVisible();
    await expect(
      sidebar.locator(`[title="${scenario.staleStatus}"]`),
    ).toHaveCount(0);

    await settleHeldTurnStart(request, "release");
  });
}

test("cancels queued navigation without cancelling the held turn/start", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/cancel-delayed-turn-navigation";
  const sessionOpens = observeSessionOpens(page);
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  await expect(sessions).toHaveCount(1);
  const originalSession = sessions.first();

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Continue this turn while I open another Session");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  await waitForHeldTurnStart(request);

  const opensBeforeNavigation = sessionOpens.length;
  const workspace = sidebar.getByRole("treeitem", {
    name: "cancel-delayed-turn-navigation",
    exact: true,
  });
  await workspace
    .getByRole("button", {
      name: "cancel-delayed-turn-navigation",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in cancel-delayed-turn-navigation",
    })
    .click();

  const pending = page
    .getByRole("status")
    .filter({ hasText: "New Session opens next" });
  await expect(pending).toBeVisible();
  await pending
    .getByRole("button", { name: "Cancel pending Session navigation" })
    .click();
  await expect(pending).toHaveCount(0);

  await settleHeldTurnStart(request, "release");

  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(sessions).toHaveCount(1);
  await expect(originalSession).toHaveAttribute("aria-current", "page");
  expect(sessionOpens).toHaveLength(opensBeforeNavigation);
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toBeVisible();
  expect(sessionOpens).toHaveLength(opensBeforeNavigation);
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toHaveCount(0);
});

test("opens only the latest Session target after delayed turn/start acceptance", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/delayed-turn-start-latest-target";
  const sessionOpens = observeSessionOpens(page);
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  const workspace = sidebar.getByRole("treeitem", {
    name: "delayed-turn-start-latest-target",
    exact: true,
  });
  const newSession = sidebar.getByRole("button", {
    name: "New session in delayed-turn-start-latest-target",
  });
  const selectedSession = () =>
    sidebar.locator('button[role="treeitem"][aria-current="page"]');
  const selectedTitle = async () => {
    const title = await selectedSession()
      .locator('[class*="sessionTitle"]')
      .textContent();
    if (!title) throw new Error("Expected a selected Session title");
    return title;
  };
  const clickNewSession = async () => {
    await workspace
      .getByRole("button", {
        name: "delayed-turn-start-latest-target",
        exact: true,
      })
      .hover();
    await newSession.click();
  };

  await expect(sessions).toHaveCount(1);
  const originalTitle = await selectedTitle();
  await clickNewSession();
  await expect(sessions).toHaveCount(2);
  const middleTitle = await selectedTitle();
  const middleSessionId = sessionOpens.at(-1)?.sessionId;
  if (!middleSessionId) throw new Error("Expected the middle Session id");

  await clickNewSession();
  await expect(sessions).toHaveCount(3);
  const latestTitle = await selectedTitle();
  const latestSessionId = sessionOpens.at(-1)?.sessionId;
  if (!latestSessionId) throw new Error("Expected the latest Session id");

  const originalSession = sessionRowByTitle(sidebar, originalTitle);
  const middleSession = sessionRowByTitle(sidebar, middleTitle);
  const latestSession = sessionRowByTitle(sidebar, latestTitle);
  await originalSession.click();
  await expect(originalSession).toHaveAttribute("aria-current", "page");

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Continue this turn while I open another Session");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  await waitForHeldTurnStart(request);

  const opensBeforeNavigation = sessionOpens.length;
  await middleSession.click();
  await latestSession.click();
  await latestSession.click();
  expect(sessionOpens).toHaveLength(opensBeforeNavigation);

  await settleHeldTurnStart(request, "release");

  await expect(latestSession).toHaveAttribute("aria-current", "page");
  await expect(middleSession).not.toHaveAttribute("aria-current", "page");
  await expect(sessions).toHaveCount(3);
  await expect.poll(() => sessionOpens.length).toBe(opensBeforeNavigation + 1);
  expect(sessionOpens.slice(opensBeforeNavigation)).toEqual([
    { sessionId: latestSessionId },
  ]);
  expect(sessionOpens.slice(opensBeforeNavigation)).not.toContainEqual({
    sessionId: middleSessionId,
  });
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toBeVisible();
});

test("rolls a delayed-navigation candidate failure back to the turn owner", async ({
  page,
  request,
}) => {
  const cwd = "/srv/work/delayed-navigation-candidate-rollback";
  const sessionOpens = observeSessionOpens(page);
  let ownerSocketClosed = false;
  page.on("websocket", (socket) => {
    let ownsTurn = false;
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) ownsTurn = true;
    });
    socket.on("close", () => {
      if (ownsTurn) ownerSocketClosed = true;
    });
  });
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const sessions = sidebar.getByRole("treeitem", { name: /Session / });
  const originalTitle = await sessions
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalTitle) throw new Error("Expected a confirmed Session title");
  const originalSession = sessionRowByTitle(sidebar, originalTitle);

  await holdNextTurnStart(request);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Continue this turn while I open another Session");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();
  await waitForHeldTurnStart(request);

  const opensBeforeNavigation = sessionOpens.length;
  await rejectNextSessionOpen(request);
  const workspace = sidebar.getByRole("treeitem", {
    name: "delayed-navigation-candidate-rollback",
    exact: true,
  });
  await workspace
    .getByRole("button", {
      name: "delayed-navigation-candidate-rollback",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in delayed-navigation-candidate-rollback",
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "New Session opens next" }),
  ).toBeVisible();
  await settleHeldTurnStart(request, "release");

  const candidateError = sidebar.getByRole("alert");
  await expect(candidateError).toContainText(
    "Fixture rejected the candidate session/open",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "New Session opens next" }),
  ).toHaveCount(0);
  await expect(sessions).toHaveCount(1);
  await expect(originalSession).toHaveAttribute("aria-current", "page");
  await expect.poll(() => sessionOpens.length).toBe(opensBeforeNavigation + 1);
  expect(ownerSocketClosed).toBe(false);
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toBeVisible();
  await expect(
    sidebar.locator('[title="Completed in background"]'),
  ).toHaveCount(0);

  const retry = candidateError.getByRole("button", { name: "Retry" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(candidateError).toHaveCount(0);

  await workspace
    .getByRole("button", {
      name: "delayed-navigation-candidate-rollback",
      exact: true,
    })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in delayed-navigation-candidate-rollback",
    })
    .click();
  await expect(sessions).toHaveCount(2);
  expect(ownerSocketClosed).toBe(false);
});

test("does not project ambiguous legacy Session rows into a Workspace", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const sidebar = productNavigation(page);
  await expect(
    sidebar.getByRole("treeitem", { name: /Ship octoscode-web/ }),
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("treeitem", { name: /Review protocol drift/ }),
  ).toHaveCount(0);
  await expect(sidebar.getByRole("treeitem", { name: /Session / })).toHaveCount(
    1,
  );
  await expect(
    sidebar.getByText("Only the open session is shown.", { exact: true }),
  ).toHaveCount(0);
});

test("moves drafts only after a profile-choice Session transition commits", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("keep this draft in the original Session");

  const openCrossProfileWorkspace = async () => {
    await productNavigation(page)
      .getByRole("button", { name: "Add workspace" })
      .click();
    const addWorkspace = page.getByRole("dialog", { name: "Add workspace" });
    await addWorkspace
      .getByLabel("Server workspace path")
      .fill("/srv/work/cross");
    await addWorkspace.getByRole("button", { name: "Add & Start" }).click();
    await expect(
      page.getByRole("heading", { name: "Choose this workspace’s profile" }),
    ).toBeVisible();
  };

  await openCrossProfileWorkspace();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(composer).toHaveValue("keep this draft in the original Session");

  await openCrossProfileWorkspace();
  await page
    .getByRole("button", { name: /Start new session with review/ })
    .click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("");
});

test("restores the origin, tab credential, session, and workspace after refresh", async ({
  page,
}) => {
  const cwd = "/srv/work/remembered-product";
  await connectServer(page, "remember-this-tab-token");
  await startWorkspace(page, cwd);

  await page.reload();

  const restoredNavigation = productNavigation(page);
  await expect(restoredNavigation).toBeVisible();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  await expect(
    restoredNavigation.getByRole("treeitem", { name: /Session / }),
  ).toHaveAttribute("aria-current", "page");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Disconnect" }).click();

  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page.getByLabel("Server origin")).toHaveValue(FIXTURE_ORIGIN);
  await expect(page.getByLabel("Auth token")).toHaveValue(
    "remember-this-tab-token",
  );
});

test("offers whole permission presets and confirms full access", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);

  const permission = page.getByRole("button", {
    name: "Permission: Write · Network blocked",
  });
  await expect(permission).toBeVisible();
  await permission.click();
  const menu = page.getByRole("menu", { name: "Permission" });
  await expect(
    menu.getByRole("menuitemradio", { name: "Read · Network blocked" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitemradio", { name: "Write · Network allowed" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitemradio", {
      name: "Full access · Network allowed",
    }),
  ).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);

  await menu
    .getByRole("menuitemradio", {
      name: "Full access · Network allowed",
    })
    .click();
  const warning = page.getByRole("dialog", { name: "Enable full access?" });
  await expect(warning).toBeVisible();
  const enable = warning.getByRole("button", { name: "Enable full access" });
  await expect(enable).toBeDisabled();
  await warning
    .getByLabel("I understand that this session can make unrestricted changes.")
    .check();
  await enable.click();

  await expect(
    page.getByRole("button", {
      name: "Permission: Full access · Network allowed",
    }),
  ).toBeVisible();
});

test("separates the Session runtime from the Profile default model", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);

  const runtimeModel = page.getByRole("button", {
    name: /Runtime model: DeepSeek V4\./,
  });
  await expect(runtimeModel).toBeVisible();
  await runtimeModel.click();

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("heading", { name: "Profile model" }),
  ).toBeVisible();
  await expect(
    settings.getByText("Session runtime", { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByText("Session runtime", { exact: true }).locator(".."),
  ).toContainText("DeepSeek V4");
  await expect(
    settings.getByText("Profile default", { exact: true }),
  ).toBeVisible();

  const models = settings.getByRole("radiogroup", {
    name: "Profile default model",
  });
  const glm = models.getByRole("radio", { name: /GLM 5\.3 Flash/ });
  await expect(glm).toHaveAttribute("aria-checked", "true");
  const deepseek = models.getByRole("radio", { name: /DeepSeek V4 Pro/ });
  await deepseek.click();
  await expect(deepseek).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByRole("status")).toContainText(
    "Profile default is DeepSeek V4 Pro",
  );
  await expect(settings.getByRole("status")).toContainText(
    "still serving DeepSeek V4",
  );
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(
    page.getByRole("button", {
      name: /Runtime model: DeepSeek V4.*Profile default DeepSeek V4 Pro is pending an Octos restart/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("menu", { name: "Model" })).toHaveCount(0);
});

test("keeps server connection actions in General settings", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, DEFAULT_WORKSPACE, "forget-me-token");
  let settings = await openSettings(page);

  await expect(
    settings.getByText("Octos server", { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByText(FIXTURE_ORIGIN, { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByText("Current workspace", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByText("Profile", { exact: true })).toBeVisible();
  await expect(settings.getByText("_main", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("Auth token")).toHaveValue("forget-me-token");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(productNavigation(page)).toBeVisible();
  settings = await openSettings(page);
  await settings.getByRole("button", { name: "Forget server" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page.getByLabel("Auth token")).toHaveValue("");
});

test("owns plan and background work under the active session Trajectory", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const sessionViews = page.getByRole("navigation", { name: "Session views" });
  await expect(
    sessionViews.getByRole("button", { name: "Chat" }),
  ).toHaveAttribute("aria-current", "page");

  await sessionViews.getByRole("button", { name: "Trajectory" }).click();
  await expect(
    sessionViews.getByRole("button", { name: "Trajectory" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Trajectory" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Background tasks" }),
  ).toBeVisible();
  await expect(page.getByText("Validate product checks")).toBeVisible();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Activity" })).toHaveCount(0);

  await sessionViews.getByRole("button", { name: "Chat" }).click();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
  await expect(page.getByText("Durable coding transcript")).toBeVisible();
});

test("does not expose implementation and diagnostic concepts as product IA", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const sidebar = productNavigation(page);

  for (const label of [
    "Runtime",
    "Boundary",
    "One runtime, two clients",
    "Session files",
    "Activity",
  ]) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(sidebar).not.toContainText("Connection");
  await expect(sidebar).not.toContainText("Permissions");
});

test("sends prompts from the session composer", async ({ page }) => {
  await connectAndStartWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);

  await composer.fill("Run the product checks");
  await page.getByRole("button", { name: "Send prompt" }).click();

  await expect(
    page.getByText("Run the product checks", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Completed with pnpm check and all tests passing."),
  ).toBeVisible();
  await expect(
    page.getByTitle("13% of the model context window used"),
  ).toBeVisible();
});

test("recovers the durable session after disconnect and lossy replay", async ({
  page,
  request,
}) => {
  const rpcMethods: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = String(payload);
      for (const method of ["session/open", "session/hydrate"]) {
        if (frame.includes(`"method":"${method}"`)) rpcMethods.push(method);
      }
    });
  });
  await connectAndStartWorkspace(page);
  const transcript = page.getByText("Durable coding transcript");
  await expect(transcript).toBeVisible();

  const opensBeforeDisconnect = rpcMethods.filter(
    (method) => method === "session/open",
  ).length;
  await request.post(`${FIXTURE_ORIGIN}/__test__/disconnect`);
  await expect
    .poll(
      () => rpcMethods.filter((method) => method === "session/open").length,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(opensBeforeDisconnect);
  await expect(transcript).toHaveCount(1);

  const hydratesBeforeLossy = rpcMethods.filter(
    (method) => method === "session/hydrate",
  ).length;
  await request.post(`${FIXTURE_ORIGIN}/__test__/replay-lossy`);
  await expect
    .poll(
      () => rpcMethods.filter((method) => method === "session/hydrate").length,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(hydratesBeforeLossy);
  await expect(transcript).toHaveCount(1);
});

test("resolves approval and structured-question takeovers", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);

  await composer.fill("Request approval fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await expect(approval).toBeFocused();
  await expect(approval).toContainText("pnpm check");
  await page.keyboard.press("Shift+Tab");
  await expect(approval.getByRole("button", { name: /Yes/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(approval.getByRole("button", { name: /No/ })).toBeFocused();
  const approvalAccessibility = await new AxeBuilder({ page })
    .include(".approval-card")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(approvalAccessibility.violations).toEqual([]);
  await approval.getByRole("button", { name: /Yes/ }).click();
  await expect(approval).toBeHidden();

  await composer.fill("Request question fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  const question = page.getByRole("dialog", {
    name: "Choose verification depth",
  });
  await expect(question).toBeVisible();
  await question.getByLabel(/Full/).check();
  await question.getByRole("button", { name: "Continue" }).click();
  await expect(question).toBeHidden();
});

test("preserves workspace launch decisions without exposing profile ids in connect", async ({
  page,
}) => {
  await connectServer(page);
  await requestInitialWorkspace(page, "/srv/work/cross");

  const decision = page.getByRole("heading", {
    name: "Choose this workspace’s profile",
  });
  await expect(decision).toBeVisible();
  await page
    .getByRole("button", { name: /Start new session with review/ })
    .click();
  await expect(decision).toBeHidden();
  await expect(page.locator(".workspace-title small")).toHaveText(
    "/srv/work/cross",
  );
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
});

test("automatically activates an unambiguous fresh coding Workspace", async ({
  page,
}) => {
  await connectServer(page);
  await requestInitialWorkspace(page, "/srv/work/new");

  await expect(
    page.getByRole("heading", { name: "Activate this coding workspace?" }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /^Permission:/ }),
  ).toBeVisible();
});

test("onboards an empty solo server from workspace creation", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await connectServer(page);
  await requestInitialWorkspace(page, "/srv/work/no-profile");
  const onboarding = page.getByRole("dialog", {
    name: "Create your local coding profile",
  });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByLabel("Provider")).toHaveValue("zai");
  await expect(onboarding.getByLabel("Model")).toHaveValue("glm-5.3-flash");

  const apiKey = onboarding.getByLabel("API key");
  await apiKey.fill("sk-rejected-secret");
  await onboarding.getByRole("button", { name: "Test, save & open" }).click();
  const providerError = onboarding.getByRole("alert");
  await expect(providerError).toContainText(
    "Provider rejected the supplied credential",
  );
  await expect(providerError).not.toContainText("sk-rejected-secret");
  await expect(onboarding).toContainText(
    "A retry only repeats provider test and save",
  );

  await apiKey.fill("sk-e2e-valid");
  await onboarding.getByRole("button", { name: "Test, save & open" }).click();
  await expect(
    page.getByText("/srv/work/no-profile", { exact: true }),
  ).toBeVisible();
  await expect(onboarding).toBeHidden();
  await expect(page.locator(".shiki")).toBeVisible();
});

test("preserves Octoscode keyless-provider onboarding semantics", async ({
  page,
}) => {
  await connectServer(page);
  await requestInitialWorkspace(page, "/srv/work/no-profile");
  const onboarding = page.getByRole("dialog", {
    name: "Create your local coding profile",
  });
  await onboarding.getByLabel("Provider").selectOption("ollama");
  await expect(onboarding.getByLabel("Model")).toHaveValue("qwen3");
  await expect(onboarding.getByText("No API key required")).toBeVisible();
  await expect(onboarding.getByLabel("API key")).toHaveCount(0);
  await onboarding.getByRole("button", { name: "Test, save & open" }).click();
  await expect(
    page.getByText("/srv/work/no-profile", { exact: true }),
  ).toBeVisible();
  await expect(onboarding).toBeHidden();
});

test("keeps the DSH-aligned dark product shell WCAG A/AA clean", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await connectAndStartWorkspace(page);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  const settings = await openSettings(page);
  const settingsResults = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(settingsResults.violations).toEqual([]);
  await settings.getByRole("button", { name: "Close settings" }).click();
});
