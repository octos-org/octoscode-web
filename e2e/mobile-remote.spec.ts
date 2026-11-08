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
  where = "",
) {
  // "approval" must not match the "approval-escalation" folder's rows.
  const name = runName(`peer-control-${kind}${where}`);
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
  await expect(row).toHaveAttribute(
    "data-fleet-status",
    kind === "question" ? /answer|回答/ : /approval|审批|批准/,
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

test("a peer's question is answered from the phone's dock with the option picked", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { page, frames, slug } = await phoneWithBlockedPeer(
    browser,
    request,
    "question",
    "-dock",
  );
  const dock = await openDockFromFleet(page, slug);
  const card = dock.locator("[data-peer-answer-card]");
  await expect(card).toContainText("Which checks should run?", {
    timeout: 20_000,
  });
  const answer = dock.locator('[data-row-action="answer"]');
  // Nothing is picked for the operator, so there is nothing to send yet.
  await expect(card.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(answer).toBeDisabled();
  // This question takes no free text: its options are the answer.
  await expect(dock.locator('[data-row-draft="answer"]')).toHaveCount(0);
  // One group: the arrow key moves the pick, as in any radio group.
  const fast = card.getByRole("radio", { name: "Fast" });
  await fast.check();
  await fast.press("ArrowDown");
  await expect(card.getByRole("radio", { name: "Full" })).toBeChecked();
  await expect(fast).not.toBeChecked();
  await answer.tap();
  await expect.poll(() => peerCommands(frames).length).toBe(1);
  expect(peerCommands(frames)[0]).toEqual({
    kind: "question_respond",
    question_id: `peer-question-${slug}`,
    answers: [{ free_text: "Full" }],
  });
});
