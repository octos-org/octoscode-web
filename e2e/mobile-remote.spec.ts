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
