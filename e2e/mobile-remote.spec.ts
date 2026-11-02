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
  const folder = "/workspace/remote-approve";
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
  await expect(row).toContainText("remote-approve");
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

test("a phone can deny, and never widens permissions", async ({
  browser,
  request,
}) => {
  const folder = "/workspace/remote-deny";
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
  const folder = "/workspace/remote-stop";
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
    section(page, /^运行中/).getByRole("button", { name: /remote-stop/ }),
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

test("an unreachable server reads as offline, and the overview recovers", async ({
  browser,
  request,
}) => {
  const folder = "/workspace/remote-offline";
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
  const [first, second] = ["remote-drawer-a", "remote-drawer-b"];
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
  const folder = "/workspace/remote-new";
  const page = await phone(browser);
  await scoped(request, folder);
  const desktop = await desktopSends(browser, folder, "Hello from the desk");
  await expect(desktop.getByText("Hello from the desk").first()).toBeVisible();
  await connectPhone(page);
  await watch(page, folder);
  await page
    .getByRole("button", { name: /New coding session.*remote-new/ })
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
  const folder = "/workspace/remote-wide";
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
    .getByRole("button", { name: /New coding session.*remote-wide/ })
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
  const folder = "/workspace/remote-keys";
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
  const folder = "/workspace/remote-escalation";
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
  kind: "approval" | "approval-escalation",
) {
  const folder = `/srv/work/peer-control-${kind}`;
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
      name: new RegExp(`New coding session.*peer-control-${kind}`),
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
  await expect(row).toHaveAttribute("data-fleet-status", /approval|审批|批准/, {
    timeout: 20_000,
  });
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
  expect(peerCommands(frames)[0]).toMatchObject({
    kind: "approval_respond",
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
  for (const command of peerCommands(frames))
    expect(command).not.toHaveProperty("approval_scope");
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
