import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const token = "tab-scoped-e2e-token";
const composer = (page: Page) => page.locator(".composer textarea");
const navigation = (page: Page) => page.locator("aside");
const sessionRows = (page: Page) =>
  navigation(page).locator('[role="treeitem"][data-session-id]');
const status = (page: Page) =>
  page.locator('[role="status"][class*="peerReadonly"]');
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

function wire(page: Page) {
  const received: Array<Record<string, any>> = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as Record<string, any>;
      received.push(frame);
    });
  });
  return received;
}

async function stagePeer(page: Page, received: Array<Record<string, any>>) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add
    .getByLabel("Server workspace path")
    .fill("/srv/work/peer-presentation");
  await add
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .click();
  await expect(composer(page)).toBeEnabled();
  await composer(page).fill("/peer");
  await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await dialog.getByLabel("Peer brief", { exact: true }).fill("Visual peer");
  await dialog
    .getByRole("spinbutton", { name: "Peers", exact: true })
    .fill("1");
  await dialog
    .getByRole("button", { name: "Start peers", exact: true })
    .press("Enter");
  await expect
    .poll(
      () =>
        new Set(
          received
            .filter((frame) => frame.method === "peer/staged")
            .map((frame) => String(frame.params?.slug)),
        ).size,
    )
    .toBe(1);
  await dialog
    .getByRole("button", { name: "Close peers", exact: true })
    .click();
  const staged = received.find((frame) => frame.method === "peer/staged")!;
  return String(staged.params.slug);
}

async function useChinese(page: Page) {
  await composer(page).fill("/theme");
  await composer(page).press("Enter");
  const preferences = page.getByRole("dialog");
  await preferences
    .locator('label:has-text("Language") select')
    .selectOption("zh");
  await preferences
    .getByRole("button", { name: "关闭偏好设置", exact: true })
    .click();
  await expect(preferences).toHaveCount(0);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`peer presentation stays separate, localized, and accessible on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Firefox/WebKit cover interaction elsewhere; one visual engine owns baselines.",
    );
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const received = wire(page);
    const slug = await stagePeer(page, received);
    await useChinese(page);
    if (viewport.name === "mobile") {
      await page
        .getByRole("button", { name: "打开会话列表", exact: true })
        .click();
    }
    await expect(sessionRows(page)).toHaveCount(1);
    await expect(
      sessionRows(page).filter({ hasText: "You are a peer agent" }),
    ).toHaveCount(0);
    const dockRow = page.locator(`button[data-peer-slug="${slug}"]`);
    await expect(dockRow).toContainText(slug);
    await dockRow.click();
    await expect(composer(page)).toHaveCount(0);
    await expect(status(page)).toContainText("这是协作者");
    await expect(
      status(page).getByRole("button", { name: "回到主会话", exact: true }),
    ).toBeVisible();
    const axe = new AxeBuilder({ page }).include(".composer");
    if (viewport.name === "desktop") {
      axe.include('section[aria-label="协作者"]');
    }
    expect((await axe.analyze()).violations).toEqual([]);
    if (viewport.name === "mobile") {
      await expect(page).toHaveScreenshot("peer-readonly-mobile.png", {
        ...SNAPSHOT,
        mask: [
          page.locator('[class*="sessionTitle"]'),
          page.locator("[data-peer-elapsed]"),
        ],
      });
      await page
        .getByRole("button", { name: "打开会话列表", exact: true })
        .click();
    }
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(
      `peer-presentation-${viewport.name}.png`,
      {
        ...SNAPSHOT,
        mask: [
          page.locator('[class*="sessionTitle"]'),
          page.locator("[data-peer-elapsed]"),
        ],
      },
    );
    if (viewport.name === "mobile") {
      await page.keyboard.press("Escape");
      await status(page)
        .getByRole("button", { name: "回到主会话", exact: true })
        .click();
      await expect(composer(page)).toBeFocused();
    }
  });
}

test.afterEach(async ({ request }) => {
  await request.post(`${origin}/__test__/terminal/reset`);
  await request.post(`${origin}/__test__/peers/reset`);
});
