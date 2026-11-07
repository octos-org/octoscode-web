import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

// The phone remote control (`?view=remote`): on a 390×844 touch screen in
// Chinese, see what runs and what waits, approve or deny once, follow up and
// stop, and come back after the server was unreachable — all through the
// ordinary OUP client, with a second "desktop" client doing the work.

const ORIGIN = `http://127.0.0.1:${
  process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"
}`;
const TOKEN = "tab-scoped-e2e-token";

test.use({ channel: "chromium" });

test.afterEach(async ({ request }) => {
  await request.post(`${ORIGIN}/__test__/terminal/reset`);
  await request.post(`${ORIGIN}/__test__/session-list/reset`);
  await request.post(`${ORIGIN}/__test__/peers/reset`);
});

async function scoped(request: APIRequestContext, folder: string) {
  expect(
    (
      await request.post(
        `${ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
      )
    ).status(),
  ).toBe(204);
}

/**
 * `base` made unique to this attempt: the fixture keeps every Session it
 * created until the run ends, so a repeat or retry reusing a folder would
 * find the Sessions an earlier attempt left there.
 */
function runName(base: string) {
  const { repeatEachIndex, retry } = test.info();
  return `${base}-run${repeatEachIndex}-${retry}`;
}

/** A desktop client opens `folder` and sends `prompt` there. */
async function desktopSends(browser: Browser, folder: string, prompt: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible())
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(folder);
  await add.getByRole("button", { name: "Start session" }).click();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill(prompt);
  await composer.press("Enter");
  return page;
}

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  return context.newPage();
}

async function connectPhone(page: Page) {
  await page.goto("/?view=remote");
  await page.getByLabel("服务器地址").fill(ORIGIN);
  await page.getByLabel("访问令牌", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "已连接 Octos" }),
  ).toBeVisible();
}

async function watch(page: Page, folder: string) {
  await page.getByLabel("服务器上的文件夹路径").fill(folder);
  await page.getByRole("button", { name: "盯住" }).tap();
}

function section(page: Page, name: RegExp): Locator {
  return page.getByRole("region", { name });
}

async function expectTouchSize(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
}

test("the overview shows waiting work and allows it once", async ({
  browser,
  request,
}) => {
  const name = runName("remote-approve");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "Request approval fixture",
  );
  await expect(
    desktop.getByRole("dialog", { name: "Run product checks?" }),
  ).toBeVisible();

  const page = await phone(browser);
  await connectPhone(page);
  await expect(
    page.getByRole("heading", { name: "选择要盯的文件夹" }),
  ).toBeVisible();
  await watch(page, folder);

  const waiting = section(page, /^等你处理/);
  const row = waiting.getByRole("button", { name: /Run product checks\?/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(name);
  await expect(row).toContainText("shell");
  await expectTouchSize(row);
  await expectTouchSize(page.getByRole("button", { name: "刷新" }));
  expect(
    (await new AxeBuilder({ page }).include("main, section").analyze())
      .violations,
  ).toEqual([]);

  await row.tap();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("pnpm check");
  await expect(approval).toContainText("中风险");
  await expect(approval).toContainText("在手机上只能批准这一次");
  await expect(
    approval.getByRole("button", { name: /本会话都允许/ }),
  ).toHaveCount(0);
  const allow = approval.getByRole("button", { name: /允许一次/ });
  await expectTouchSize(allow);
  await expectTouchSize(approval.getByRole("button", { name: /拒绝/ }));
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await allow.tap();
  await expect(approval).toHaveCount(0);
  // The desktop sees the same decision: one approval, granted from the phone.
  await expect(
    desktop.getByRole("dialog", { name: "Run product checks?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  await expect(
    section(page, /^等你处理/).getByText("没有等你批准或回答的事。"),
  ).toBeVisible();
});

test("watching from the folder browser keeps waiting and running work in view", async ({
  browser,
  request,
}) => {
  // T-0351: the folder list lives below the status sections. Choosing a
  // folder there left the viewport mid-form ("Waiting for you" scrolled off
  // the top); adding must reveal the status sections again.
  test.setTimeout(120_000);
  const folder = "/srv/fixture/Projects/octoscode-web";
  await scoped(request, folder);
  const waitingDesktop = await desktopSends(
    browser,
    folder,
    "Request approval fixture",
  );
  await expect(
    waitingDesktop.getByRole("dialog", { name: "Run product checks?" }),
  ).toBeVisible();
  await request.post(`${ORIGIN}/__test__/terminal/hold-next`);
  const runningDesktop = await desktopSends(
    browser,
    folder,
    "Keep this draft while the status is unknown",
  );
  await expect(
    runningDesktop.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();

  const page = await phone(browser);
  // The browse affordance is advertised only to the browse fixture token.
  await page.goto("/?view=remote");
  await page.getByLabel("服务器地址").fill(ORIGIN);
  await page
    .getByLabel("访问令牌", { exact: true })
    .fill("workspace-browse-e2e-token");
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "已连接 Octos" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "浏览服务器文件夹", exact: true })
    .tap();
  await page.getByRole("button", { name: "打开文件夹 Projects" }).tap();
  // T-0347's real walk: the folder browser stays open and the user taps the
  // typed-path submit at the bottom of the page, so the viewport sits far
  // below the status sections when the add happens.
  const input = page.getByLabel("服务器上的文件夹路径");
  await input.scrollIntoViewIfNeeded();
  await input.fill(folder);
  // Adding must bring the status sections back instead of leaving them above
  // the viewport.
  await page.getByRole("button", { name: "盯住" }).tap();

  const waiting = section(page, /^等你处理/);
  await expect(waiting).toBeInViewport();
  await expect(
    waiting.getByRole("button", { name: /Run product checks\?/ }),
  ).toBeInViewport();
  const running = section(page, /^运行中/);
  await expect(running).toBeInViewport();
  await expect(running.getByRole("button").first()).toBeInViewport();

  // A data refresh must never steal the scroll position afterwards.
  const foldersSection = section(page, /^盯着的文件夹/);
  await foldersSection.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "刷新", exact: true }).tap();
  await page.waitForTimeout(1_200);
  await expect(foldersSection).toBeInViewport();
});

test("a phone can deny, and never widens permissions", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-deny")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "Request approval fixture",
  );
  await expect(
    desktop.getByRole("dialog", { name: "Run product checks?" }),
  ).toBeVisible();

  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^等你处理/)
    .getByRole("button", { name: /Run product checks\?/ })
    .tap();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await approval.getByRole("button", { name: /拒绝/ }).tap();
  await expect(approval).toHaveCount(0);
  await expect(
    desktop.getByRole("dialog", { name: "Run product checks?" }),
  ).toHaveCount(0);

  // The desktop may widen this session's access; the phone may only narrow
  // it ("write, no network" here), so full access and network never appear.
  await desktop
    .getByRole("button", { name: /^Permission:/ })
    .first()
    .click();
  await expect(desktop.getByRole("menu")).toContainText("Full access");
  await desktop.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^权限[:：]/ })
    .first()
    .tap();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("读取");
  await expect(menu).not.toContainText("完全访问");
  await expect(menu).not.toContainText("允许联网");
  await page.keyboard.press("Escape");

  // Leaving for the full app and coming back from its menu.
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  await page.getByRole("button", { name: "打开完整版" }).tap();
  await expect(page).not.toHaveURL(/view=remote/);
  await expect(page.getByRole("heading", { name: "手机遥控" })).toHaveCount(0);
  await page.getByRole("button", { name: "更多操作" }).tap();
  await page.getByRole("menuitem", { name: "手机遥控" }).tap();
  await expect(page).toHaveURL(/view=remote/);
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
});

test("a follow-up from the phone runs and can be stopped", async ({
  browser,
  request,
}) => {
  const name = runName("remote-stop");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "First pass from the desk",
  );
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^最近/).getByRole("button").first().tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toBeEnabled();

  expect(
    (await request.post(`${ORIGIN}/__test__/terminal/hold-next`)).status(),
  ).toBe(204);
  await composer.fill("Phone follow-up");
  await page.getByRole("button", { name: "发送提示" }).tap();
  const stop = page.getByRole("button", { name: "停止", exact: true });
  await expect(stop).toBeVisible();
  await expectTouchSize(stop);

  // The overview counts it as running while it runs.
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  await expect(
    section(page, /^运行中/).getByRole("button", { name: new RegExp(name) }),
  ).toBeVisible();
  await section(page, /^运行中/)
    .getByRole("button")
    .first()
    .tap();

  await page.getByRole("button", { name: "停止", exact: true }).tap();
  await expect(page.getByText("本轮已停止").first()).toBeVisible();
  // Sent once, shown once.
  await expect(
    page.getByRole("region", { name: "对话" }).getByText("Phone follow-up", {
      exact: true,
    }),
  ).toHaveCount(1);
});

test("a phone follow-up completes on the same session and survives a reload", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-follow-up")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "First pass from the desk",
  );
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^最近/).getByRole("button").first().tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toBeEnabled();
  await composer.fill("Phone follow-up for the summary");
  await page.getByRole("button", { name: "发送提示" }).tap();

  // The same session on the desktop runs it, once, to completion.
  await expect(
    desktop
      .getByRole("region", { name: "Conversation" })
      .getByText("Phone follow-up for the summary", { exact: true }),
  ).toBeVisible();
  await expect(desktop.getByText("Turn complete")).toHaveCount(2);
  await expect(page.getByText("本轮完成").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page
      .getByRole("region", { name: "对话" })
      .getByText("Phone follow-up for the summary", { exact: true }),
  ).toHaveCount(1);

  // A reload returns to the overview; reopening the session shows the same
  // follow-up and its result — nothing was sent twice.
  await page.reload();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  await section(page, /^最近/).getByRole("button").first().tap();
  await expect(
    page
      .getByRole("region", { name: "对话" })
      .getByText("Phone follow-up for the summary", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("本轮完成").first()).toBeVisible();
});

test("a read-only session shows the reason instead of a composer on the phone", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-readonly")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "First pass from the desk",
  );
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  const page = await phone(browser);
  const sentMethods: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method) sentMethods.push(frame.method);
    }),
  );
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^最近/).getByRole("button").first().tap();
  await expect(
    page.getByRole("textbox", { name: "给 Octos 发消息" }),
  ).toBeEnabled();

  // The phone may narrow access, never widen it; once the session is
  // read-only the composer must tell the truth instead of inviting work.
  await page
    .getByRole("button", { name: /^权限[:：]/ })
    .first()
    .tap();
  await page.getByRole("menuitemradio", { name: /读取/ }).tap();
  await expect(
    page.getByText(
      "此会话是只读权限。手机不能续发任务；请在电脑上把它切回可写后再发。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "给 Octos 发消息" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送提示" })).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(sentMethods.filter((method) => method === "turn/start")).toEqual([]);
});

test("a phone starts a new session in a watched folder, keeps a refused first task as a draft, and every screen sees it", async ({
  browser,
  request,
}) => {
  const name = runName("remote-create");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "First pass from the desk",
  );
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  const page = await phone(browser);
  const sentMethods: string[] = [];
  let createdSessionId = "";
  page.on("websocket", (ws) =>
    ws.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method) sentMethods.push(frame.method);
      if (frame.method === "session/open")
        createdSessionId = frame.params?.session_id ?? createdSessionId;
    }),
  );
  await connectPhone(page);
  await watch(page, folder);
  const create = page.getByRole("button", {
    name: `在 ${name} 中新建会话`,
  });
  await expect(create).toBeEnabled();
  // A double tap must mint exactly one session, never a parallel empty one.
  await create.evaluate((node: HTMLButtonElement) => {
    node.click();
    node.click();
  });
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toBeEnabled();
  expect(
    sentMethods.filter((method) => method === "session/open"),
  ).toHaveLength(1);

  // Core refuses the first task: the phone says so and keeps the draft.
  await request.post(`${ORIGIN}/__test__/turn-start/hold-next`);
  await composer.fill("Phone first task");
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(`${ORIGIN}/__test__/turn-start/state`)
      ).json()) as { held?: { turn_id?: string } | null };
      return state.held?.turn_id ?? null;
    })
    .not.toBeNull();
  await request.post(`${ORIGIN}/__test__/turn-start/reject`);
  await expect(page.getByText("本轮未被接受")).toBeVisible();
  await expect(composer).toHaveValue("Phone first task");
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect(page.getByText("本轮完成").first()).toBeVisible({
    timeout: 15_000,
  });

  // The desktop sees the very same session under the workspace — one new
  // row, not two — and opening it shows the phone's task and its result.
  // (The sidebar refetches the session list after a reload.)
  await desktop.reload();
  const desktopRows = desktop.locator('[role="treeitem"][data-session-id]');
  await expect(desktopRows).toHaveCount(2);
  expect(createdSessionId).not.toBe("");
  // The row key embeds the session id; the double tap minted no third row.
  const created = desktop.locator(
    `[role="treeitem"][data-session-id*=${JSON.stringify(createdSessionId)}]`,
  );
  await expect(created).toHaveCount(1);
  await created.click();
  await expect(
    desktop
      .getByRole("region", { name: "Conversation" })
      .getByText("Phone first task", { exact: true }),
  ).toBeVisible();
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  // After a reload the phone's overview lists both folder sessions under
  // 最近 (newest first — the phone-created one just finished) and reopening
  // shows the same task — nothing was created or sent twice.
  await page.reload();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  const recent = section(page, /^最近/).getByRole("button");
  await expect(recent).toHaveCount(2);
  await recent.first().tap();
  await expect(
    page
      .getByRole("region", { name: "对话" })
      .getByText("Phone first task", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("本轮完成").first()).toBeVisible();
});

test("a refused phone create says so, keeps nothing fake, and retries clean", async ({
  browser,
  request,
}) => {
  const name = runName("remote-create-refused");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const page = await phone(browser);
  const sentMethods: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method) sentMethods.push(frame.method);
    }),
  );
  await connectPhone(page);
  await watch(page, folder);
  const create = page.getByRole("button", {
    name: `在 ${name} 中新建会话`,
  });
  await expect(create).toBeEnabled();

  await request.post(`${ORIGIN}/__test__/session-open/reject-next`);
  await create.tap();
  await expect(page.getByText("新建会话失败，请重试。")).toBeVisible();
  // No fabricated session: the overview stays empty and the button is back.
  await expect(page.getByText("这些文件夹里还没有会话。")).toBeVisible();
  await expect(create).toBeEnabled();
  expect(
    sentMethods.filter((method) => method === "session/open"),
  ).toHaveLength(1);

  await request.post(`${ORIGIN}/__test__/session-open/reset`);
  await create.tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toBeEnabled();
  expect(
    sentMethods.filter((method) => method === "session/open"),
  ).toHaveLength(2);
  await expect(page.getByText("新建会话失败，请重试。")).toHaveCount(0);
});

test("a rejected phone follow-up keeps the draft and tells the truth", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-reject")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "First pass from the desk",
  );
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();

  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^最近/).getByRole("button").first().tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toBeEnabled();

  await request.post(`${ORIGIN}/__test__/turn-start/hold-next`);
  await composer.fill("Phone follow-up that gets rejected");
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(`${ORIGIN}/__test__/turn-start/state`)
      ).json()) as { held?: { turn_id?: string } | null };
      return state.held?.turn_id ?? null;
    })
    .not.toBeNull();
  await request.post(`${ORIGIN}/__test__/turn-start/reject`);

  await expect(page.getByText("本轮未被接受")).toBeVisible();
  await expect(composer).toHaveValue("Phone follow-up that gets rejected");
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
});

test("an unreachable server reads as offline, and the overview recovers", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-offline")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(browser, folder, "Offline drill");
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();
  await desktop.close();

  const page = await phone(browser);
  let refuse = false;
  await page.routeWebSocket(/ui-protocol/, (socket) => {
    if (refuse) socket.close({ code: 4000, reason: "unreachable" });
    else socket.connectToServer();
  });
  await connectPhone(page);
  await watch(page, folder);
  const recent = section(page, /^最近/).getByRole("button").first();
  await expect(recent).toBeVisible();
  // Open the session and come back first: the opened session's profile must
  // not swap the overview's store, or the outage below starts from nothing.
  await recent.tap();
  await expect(
    page.getByRole("region", { name: "对话" }).getByText("Offline drill", {
      exact: true,
    }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  await expect(recent).toBeEnabled();

  refuse = true;
  await request.post(`${ORIGIN}/__test__/disconnect`);
  const status = page.getByRole("status").filter({ hasText: "Octos" }).first();
  await expect(status).toContainText("连不上 Octos", { timeout: 15_000 });
  await expect(status).toContainText("恢复之前不会发送任何内容");
  // The last list stays visible, but nothing can be opened from it.
  await expect(recent).toBeVisible();
  await expect(recent).toBeDisabled();

  refuse = false;
  await expect(status).toContainText("已连接 Octos", { timeout: 15_000 });
  await expect(recent).toBeEnabled();
  await recent.tap();
  await expect(
    page.getByRole("region", { name: "对话" }).getByText("Offline drill", {
      exact: true,
    }),
  ).toHaveCount(1);
});

test("a session tapped in the overview's drawer opens it", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const [first, second] = [
    runName("remote-drawer-a"),
    runName("remote-drawer-b"),
  ];
  const page = await phone(browser);
  for (const name of [first, second]) {
    await scoped(request, `/workspace/${name}`);
    const desktop = await desktopSends(
      browser,
      `/workspace/${name}`,
      "Hello from the desk",
    );
    await expect(
      desktop.getByText("Hello from the desk").first(),
    ).toBeVisible();
  }
  await connectPhone(page);
  const overview = page.getByRole("heading", { name: "手机遥控" });
  const back = page.getByRole("button", { name: "返回手机遥控" });
  const drawerRow = (name: string) =>
    page
      .locator("aside")
      .getByRole("group")
      .filter({ hasText: name })
      .getByRole("treeitem", { name: /New coding session/ })
      .first();
  // The drawer lists what this tab has opened: visit both from the overview.
  for (const name of [first, second]) {
    await watch(page, `/workspace/${name}`);
    await page
      .getByRole("button", { name: new RegExp(`New coding session.*${name}`) })
      .tap();
    await expect(page.getByText(`/workspace/${name}`).first()).toBeVisible();
    await back.tap();
    await expect(overview).toBeVisible();
  }

  // Another session: the overview gives way to it, with the way back on top.
  await page.getByRole("button", { name: "打开会话列表" }).tap();
  await drawerRow(first).tap();
  await expect(overview).toHaveCount(0);
  await expect(back).toBeVisible();
  await expect(page.getByText(`/workspace/${first}`).first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "给 Octos 发消息" }),
  ).toBeVisible();

  // The session already open behind the overview reveals just the same.
  await back.tap();
  await expect(overview).toBeVisible();
  await page.getByRole("button", { name: "打开会话列表" }).tap();
  await drawerRow(first).tap();
  await expect(overview).toHaveCount(0);
  await expect(back).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();
});

test("a new session started from the overview's drawer opens", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const name = runName("remote-new");
  const folder = `/workspace/${name}`;
  const page = await phone(browser);
  await scoped(request, folder);
  const desktop = await desktopSends(browser, folder, "Hello from the desk");
  await expect(desktop.getByText("Hello from the desk").first()).toBeVisible();
  await connectPhone(page);
  await watch(page, folder);
  await page
    .getByRole("button", { name: new RegExp(`New coding session.*${name}`) })
    .tap();
  const back = page.getByRole("button", { name: "返回手机遥控" });
  await back.tap();
  const overview = page.getByRole("heading", { name: "手机遥控" });
  await expect(overview).toBeVisible();

  await page.getByRole("button", { name: "打开会话列表" }).tap();
  await page
    .locator("aside")
    .getByRole("button", { name: "新会话", exact: true })
    .tap();
  await expect(overview).toHaveCount(0);
  await expect(back).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "给 Octos 发消息" }),
  ).toBeVisible();
});

test("on a wide screen the overview's list opens a session and stays", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const name = runName("remote-wide");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const desktop = await desktopSends(browser, folder, "Hello from the desk");
  await expect(desktop.getByText("Hello from the desk").first()).toBeVisible();
  const page = await (
    await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
      locale: "zh-CN",
    })
  ).newPage();
  await connectPhone(page);
  await watch(page, folder);
  await page
    .getByRole("button", { name: new RegExp(`New coding session.*${name}`) })
    .tap();
  const back = page.getByRole("button", { name: "返回手机遥控" });
  await back.tap();
  const overview = page.getByRole("heading", { name: "手机遥控" });
  await expect(overview).toBeVisible();

  const listed = page
    .locator("aside")
    .getByRole("treeitem", { name: /New coding session/ })
    .first();
  await listed.tap();
  await expect(overview).toHaveCount(0);
  await expect(back).toBeVisible();
  // This list isn't a drawer: it stays open beside the session.
  await expect(listed).toBeVisible();
});

/** Every `method` frame the page sends from here on. */
function recordFrames(page: Page) {
  const frames: { method: string; params: Record<string, unknown> }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method)
        frames.push({ method: frame.method, params: frame.params ?? {} });
    }),
  );
  return frames;
}

test("the phone's y and s keys never widen an approval", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-keys")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "Request approval fixture",
  );
  const desktopCard = desktop.getByRole("dialog", {
    name: "Run product checks?",
  });
  await expect(desktopCard).toBeVisible();

  const page = await phone(browser);
  const frames = recordFrames(page);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^等你处理/)
    .getByRole("button", { name: /Run product checks\?/ })
    .tap();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: /允许一次/ }).focus();
  await page.keyboard.press("s");
  await expect(approval).toBeVisible();
  await page.keyboard.press("y");
  await expect(approval).toHaveCount(0);
  const sent = frames.filter((frame) => frame.method === "approval/respond");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.params.decision).toBe("approve");
  expect(sent[0]!.params.approval_scope ?? "request").toBe("request");
  await expect(desktopCard).toHaveCount(0);
});

test("a sandbox escalation can only be denied from the phone", async ({
  browser,
  request,
}) => {
  const folder = `/workspace/${runName("remote-escalation")}`;
  await scoped(request, folder);
  const desktop = await desktopSends(
    browser,
    folder,
    "Request sandbox escalation fixture",
  );
  // The computer keeps every decision.
  const desktopCard = desktop.getByRole("dialog", {
    name: "Leave the sandbox?",
  });
  await expect(desktopCard).toBeVisible();
  await expect(
    desktopCard.getByRole("button", { name: /Allow once/ }),
  ).toBeVisible();
  await expect(
    desktopCard.getByRole("button", { name: /Allow for this session/ }),
  ).toBeVisible();

  const page = await phone(browser);
  const frames = recordFrames(page);
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^等你处理/)
    .getByRole("button", { name: /Leave the sandbox\?/ })
    .tap();
  const approval = page.getByRole("dialog", { name: "Leave the sandbox?" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("只能拒绝");
  await expect(approval.getByRole("button", { name: /允许/ })).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);

  // Neither shortcut gets past the missing buttons.
  const deny = approval.getByRole("button", { name: /拒绝/ });
  await deny.focus();
  await page.keyboard.press("y");
  await page.keyboard.press("s");
  await expect(approval).toBeVisible();
  const responses = () =>
    frames.filter((frame) => frame.method === "approval/respond");
  expect(responses()).toHaveLength(0);

  await deny.tap();
  await expect(approval).toHaveCount(0);
  expect(responses()).toHaveLength(1);
  expect(responses()[0]!.params.decision).toBe("deny");
  await expect(desktopCard).toHaveCount(0);
});

/**
 * The phone starts a peer from Fleet and that peer asks for `kind`, so its row
 * waits in both Fleet and the drawer's dock. Leaves the phone on the Fleet row.
 */
async function phoneWithBlockedPeer(
  browser: Browser,
  request: APIRequestContext,
  kind: "approval" | "approval-escalation" | "question",
) {
  // "approval" must not match the "approval-escalation" folder's rows.
  const name = runName(`peer-control-${kind}`);
  const folder = `/srv/work/${name}`;
  await scoped(request, folder);
  const desktop = await desktopSends(browser, folder, "Hello from the desk");
  await expect(desktop.getByText("Hello from the desk").first()).toBeVisible();
  await desktop.close();

  const page = await phone(browser);
  const frames = recordFrames(page);
  await connectPhone(page);
  await watch(page, folder);
  await page
    .getByRole("button", {
      name: new RegExp(`^New coding session ${name} · `),
    })
    .tap();
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  await page.getByRole("button", { name: "打开会话列表" }).tap();
  await page.locator('aside [data-fleet-nav="entry"]').tap();
  await page.locator('[data-fleet-field="model"]').selectOption({ index: 1 });
  await page.locator('[data-fleet-field="brief"]').fill("Peer brief");
  await page.locator('[data-fleet-action="start"]').tap();
  const started = page.locator("[data-fleet-row]").first();
  await expect(started).toBeVisible({ timeout: 30_000 });
  const slug = (await started.getAttribute("data-fleet-row"))!;
  const master = frames.find((frame) => frame.method === "session/open")!.params
    .session_id as string;
  for (const step of ["turn", kind])
    expect(
      (
        await request.post(
          `${ORIGIN}/__test__/peer-control/peer-activity?session_id=${encodeURIComponent(master)}&kind=${step}&slug=${encodeURIComponent(slug)}`,
        )
      ).status(),
    ).toBe(204);
  const row = page.locator(`[data-fleet-row="${slug}"]`);
  // A question-blocked row's Fleet wording is T-0493's to fix; its wait is
  // observed on the dock card instead.
  if (kind !== "question")
    await expect(row).toHaveAttribute(
      "data-fleet-status",
      /approval|审批|批准/,
      { timeout: 20_000 },
    );
  return { page, frames, slug, row };
}

/** The phone's way from Fleet to the drawer's dock row for `slug`. */
async function openDockFromFleet(page: Page, slug: string) {
  await page.locator(".fleet-back").tap();
  await page.getByRole("button", { name: "打开会话列表" }).tap();
  const row = page
    .locator("aside")
    .locator('section[role="region"]')
    .filter({ has: page.locator(`button[data-peer-slug="${slug}"]`) })
    .locator("li")
    .filter({ has: page.locator(`button[data-peer-slug="${slug}"]`) });
  await expect(row).toBeVisible();
  return row;
}

/** What one `peer/control` tap put on the wire. */
function peerCommands(
  frames: { method: string; params: Record<string, unknown> }[],
) {
  return frames
    .filter((frame) => frame.method === "peer/control")
    .map((frame) => frame.params.command as Record<string, unknown>);
}

test("a peer's approval from the phone covers one request", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { page, frames, slug, row } = await phoneWithBlockedPeer(
    browser,
    request,
    "approval",
  );
  // Fleet row.
  await expect(row.locator('[data-fleet-action="approve"]')).toBeVisible();
  await row.locator('[data-fleet-action="approve"]').tap();
  await expect.poll(() => peerCommands(frames).length).toBe(1);
  // The row's own pending id, never the console's synthetic one.
  expect(peerCommands(frames)[0]).toMatchObject({
    kind: "approval_respond",
    approval_id: `peer-approval-${slug}`,
    decision: "approve",
  });
  expect(peerCommands(frames)[0]).not.toHaveProperty("approval_scope");

  // Dock row: no session-wide grant among its actions.
  const dock = await openDockFromFleet(page, slug);
  await expect(
    dock.locator('[data-row-action="approve"]').first(),
  ).toBeVisible();
  await expect(dock.locator('[data-row-action="deny"]').first()).toBeVisible();
  await expect(dock.locator('[data-row-action="approve_session"]')).toHaveCount(
    0,
  );
  await expect(dock).not.toContainText("本次会话内批准");
  for (const approve of await dock.locator('[data-row-action="approve"]').all())
    await approve.tap();
  await expect
    .poll(() => peerCommands(frames).length)
    .toBeGreaterThanOrEqual(2);
  for (const command of peerCommands(frames)) {
    expect(command).not.toHaveProperty("approval_scope");
    expect(command.approval_id).toBe(`peer-approval-${slug}`);
  }
});

test("a peer's question is answered from the phone's dock by its own id", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { page, frames, slug } = await phoneWithBlockedPeer(
    browser,
    request,
    "question",
  );
  const dock = await openDockFromFleet(page, slug);
  const card = dock.locator("[data-peer-answer-card]");
  await expect(card).toContainText("Which checks should run?", {
    timeout: 20_000,
  });
  // The row's typed answer is what it sends (choice handling is T-0493's).
  await dock.locator('[data-row-draft="answer"]').fill("Full");
  await dock.locator('[data-row-action="answer"]').tap();
  await expect.poll(() => peerCommands(frames).length).toBe(1);
  expect(peerCommands(frames)[0]).toEqual({
    kind: "question_respond",
    question_id: `peer-question-${slug}`,
    answers: [{ free_text: "Full" }],
  });
});

test("a peer's sandbox escalation can only be denied from the phone", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { page, frames, slug, row } = await phoneWithBlockedPeer(
    browser,
    request,
    "approval-escalation",
  );
  // Fleet row: deny and stop, never approve.
  await expect(row.locator('[data-fleet-action="deny"]')).toBeVisible();
  await expect(row.locator('[data-fleet-action="approve"]')).toHaveCount(0);
  await expect(row).toContainText("只能拒绝");

  const dock = await openDockFromFleet(page, slug);
  await expect(dock).toContainText("只能拒绝");
  await expect(dock.locator('[data-row-action="approve"]')).toHaveCount(0);
  await expect(dock.locator('[data-row-action="approve_session"]')).toHaveCount(
    0,
  );
  // Alt+Y, the row button's desktop shortcut, stays out too.
  await dock.locator(`button[data-peer-slug="${slug}"]`).focus();
  await page.keyboard.press("Alt+y");
  expect(peerCommands(frames)).toHaveLength(0);

  await dock.locator('[data-row-action="deny"]').first().tap();
  await expect.poll(() => peerCommands(frames).length).toBe(1);
  expect(peerCommands(frames)[0]).toMatchObject({
    kind: "approval_respond",
    decision: "deny",
  });
});

test("a phone template retries the same launch after failure and reload without sending a draft", async ({
  browser,
  request,
}) => {
  const name = runName("phone-template-retry");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const page = await phone(browser);
  const opens: string[] = [];
  const turns: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "session/open") opens.push(frame.params.session_id);
      if (frame.method === "turn/start") turns.push(frame.params.turn_id);
    }),
  );
  await connectPhone(page);
  await watch(page, folder);
  await page.getByRole("button", { name: `在 ${name} 中从模板新建` }).tap();
  const picker = page.getByRole("region", { name: "选择新会话模板" });
  await expect(picker).toBeVisible();
  expect(opens).toHaveLength(0);
  await request.post(`${ORIGIN}/__test__/session-open/reject-next`);
  await picker
    .getByRole("button", { name: "做同款：写周报" })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  await expect(page.getByText("新建会话失败，请重试。")).toBeVisible();
  expect(opens).toHaveLength(1);
  expect(turns).toHaveLength(0);
  await expect(page.getByText("这些文件夹里还没有会话。")).toBeVisible();
  await page.reload();
  await expect(picker).toBeVisible();
  expect(opens).toHaveLength(1);
  await request.post(`${ORIGIN}/__test__/session-open/reset`);
  await picker
    .getByRole("button", { name: "做同款：写周报" })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toHaveValue(/本周周报/);
  expect(new Set(opens).size).toBe(1);
  expect(turns).toHaveLength(0);
  const prompt =
    "T0421 weekly: completed three deliveries; review feedback next week.";
  await composer.fill(prompt);
  await page.reload();
  await section(page, /^最近/).getByRole("button").first().tap();
  await expect(composer).toHaveValue(prompt);
  await request.post(`${ORIGIN}/__test__/turn-start/hold-next`);
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`${ORIGIN}/__test__/turn-start/state`)
          ).json()
        ).held?.turn_id,
    )
    .toBeTruthy();
  await request.post(`${ORIGIN}/__test__/turn-start/reject`);
  await expect(page.getByText("本轮未被接受")).toBeVisible();
  await expect(composer).toHaveValue(prompt);
  await page
    .getByRole("button", { name: "发送提示" })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  await expect(page.getByText("本轮完成").first()).toBeVisible();
  expect(turns).toHaveLength(2); // One rejected attempt, one accepted turn.
  await page.reload();
  const recent = section(page, /^最近/).getByRole("button");
  await expect(recent).toHaveCount(1);
  await recent.first().tap();
  await expect(page.locator(".entry-user")).toHaveCount(1);
  expect(new Set(opens).size).toBe(1);
  expect(turns).toHaveLength(2);
});

test("a phone code template targets its new session and leaves the previous draft untouched", async ({
  browser,
  request,
}) => {
  const name = runName("phone-code-template");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await page.getByRole("button", { name: `在 ${name} 中新建会话` }).tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await composer.fill("Keep the previous session draft");
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  const starts: string[] = [];
  const updates: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "turn/start") starts.push(frame.params.turn_id);
      if (frame.method === "permission/profile/set")
        updates.push(frame.params.update);
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: `在 ${name} 中从模板新建` }).tap();
  await page
    .getByRole("region", { name: "选择新会话模板" })
    .getByRole("button", { name: "做同款：修一个 bug" })
    .tap();
  await expect(composer).toHaveValue(/^帮我修一个 bug/);
  expect(starts).toHaveLength(0);
  await composer.fill(
    "Fix calc.ts division by zero without changing other files.",
  );
  await page
    .getByRole("button", { name: "发送提示" })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  await expect(page.getByText("本轮完成").first()).toBeVisible();
  expect(starts).toHaveLength(1);
  expect(updates).toEqual([]);
  await page.getByRole("button", { name: "返回手机遥控" }).tap();
  const recent = section(page, /^最近/).getByRole("button");
  await expect(recent).toHaveCount(2);
  await recent.last().tap();
  await expect(composer).toHaveValue("Keep the previous session draft");
});

test("choosing a blank phone session after a refused template does not restore that template on reload", async ({
  browser,
  request,
}) => {
  const name = runName("phone-template-to-blank");
  const folder = `/workspace/${name}`;
  await scoped(request, folder);
  const page = await phone(browser);
  await connectPhone(page);
  await watch(page, folder);
  await page.getByRole("button", { name: `在 ${name} 中从模板新建` }).tap();
  await request.post(`${ORIGIN}/__test__/session-open/reject-next`);
  await page
    .getByRole("region", { name: "选择新会话模板" })
    .getByRole("button", { name: "做同款：写周报" })
    .tap();
  await expect(page.getByText("新建会话失败，请重试。")).toBeVisible();
  await request.post(`${ORIGIN}/__test__/session-open/reset`);
  await page.getByRole("button", { name: `在 ${name} 中新建会话` }).tap();
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(composer).toHaveValue("");
  await page.reload();
  await section(page, /^最近/).getByRole("button").first().tap();
  await expect(composer).toHaveValue("");
});
