import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

test("uses the DSH-aligned product sidebar and grouped or flat session views", async ({
  page,
}) => {
  await connectAndStartWorkspace(page);
  const sidebar = productNavigation(page);

  await expect(sidebar.getByText("Octoscode", { exact: true })).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "New session", exact: true }).last(),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("tree", { name: "Workspaces and sessions" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("treeitem", { name: "octoscode-web", exact: true }),
  ).toBeVisible();
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
