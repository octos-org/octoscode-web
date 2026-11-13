import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  FIXTURE_TOKEN,
} from "./fixture-session";
import { composer } from "./sessions";
import { observeFrames, observeSent } from "./turn-observers";
import { axeViolations } from "./axe";

// The phone remote control (`?view=remote`): on a 390×844 touch screen in
// Chinese, see what runs and what waits, approve or deny once, follow up and
// stop, and come back after the server was unreachable — all through the
// ordinary OUP client, with a second "desktop" client doing the work.

test.use({ channel: "chromium" });

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/reset`);
  await request.post(`${FIXTURE_ORIGIN}/__test__/session-list/reset`);
  await request.post(`${FIXTURE_ORIGIN}/__test__/peers/reset`);
});

async function scoped(request: APIRequestContext, folder: string) {
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
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
  await connectAndStartWorkspace(page, folder);
  await composer(page).fill(prompt);
  await composer(page).press("Enter");
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
  await page.getByLabel("服务器地址").fill(FIXTURE_ORIGIN);
  await page.getByLabel("访问令牌", { exact: true }).fill(FIXTURE_TOKEN);
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
  const wire = observeFrames(page);
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
  expect(wire.calls("session/open")).toHaveLength(1);

  // Core refuses the first task: the phone says so and keeps the draft.
  await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/hold-next`);
  await composer.fill("Phone first task");
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(`${FIXTURE_ORIGIN}/__test__/turn-start/state`)
      ).json()) as { held?: { turn_id?: string } | null };
      return state.held?.turn_id ?? null;
    })
    .not.toBeNull();
  await request.post(`${FIXTURE_ORIGIN}/__test__/turn-start/reject`);
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
  const createdSessionId = String(
    wire.calls("session/open").at(-1)?.params?.session_id ?? "",
  );
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
  const responses = observeSent(page, "approval/respond");
  await connectPhone(page);
  await watch(page, folder);
  await section(page, /^等你处理/)
    .getByRole("button", { name: /Leave the sandbox\?/ })
    .tap();
  const approval = page.getByRole("dialog", { name: "Leave the sandbox?" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("只能拒绝");
  await expect(approval.getByRole("button", { name: /允许/ })).toHaveCount(0);
  expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);

  // Neither shortcut gets past the missing buttons.
  const deny = approval.getByRole("button", { name: /拒绝/ });
  await deny.focus();
  await page.keyboard.press("y");
  await page.keyboard.press("s");
  await expect(approval).toBeVisible();
  expect(responses()).toHaveLength(0);

  await deny.tap();
  await expect(approval).toHaveCount(0);
  expect(responses()).toHaveLength(1);
  expect(responses()[0]!.decision).toBe("deny");
  await expect(desktopCard).toHaveCount(0);
});
