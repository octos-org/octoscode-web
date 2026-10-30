import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

async function openNavigation(page: Page) {
  const navigation = page.locator("aside");
  if (!(await navigation.isVisible())) {
    await page
      .getByRole("button", {
        name: /^(Open session list|Open navigation|Open sessions)$/,
      })
      .click();
  }
  return navigation;
}

async function startSession(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(composer(page)).toBeEnabled();
}

async function createSecondSession(page: Page, label: string) {
  const navigation = await openNavigation(page);
  await navigation.getByRole("treeitem", { name: label, exact: true }).hover();
  await navigation
    .getByRole("button", { name: `New session in ${label}`, exact: true })
    .click();
  await expect(composer(page)).toBeEnabled();
}

function protocolRequests(page: Page) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> =
    [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method)
        requests.push({ method: frame.method, params: frame.params });
    }),
  );
  return requests;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`rename and confirmed delete work on ${viewport.name}`, async ({
    page,
    request,
  }, testInfo) => {
    const workspace = `/workspace/session-organize-${viewport.name}`;
    const label = `session-organize-${viewport.name}`;
    await request.post(
      `${origin}/__test__/session-list/scoped?workspace=${encodeURIComponent(workspace)}`,
    );
    const requests = protocolRequests(page);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await startSession(page, workspace);
    await composer(page).fill("First session");
    await composer(page).press("Enter");
    await expect(page.getByText("Turn complete").last()).toBeVisible();
    await createSecondSession(page, label);
    const navigation = await openNavigation(page);
    const first = navigation
      .locator(
        'div[role="treeitem"][data-session-id]:not([aria-current="page"])',
      )
      .filter({ hasText: "New coding session" })
      .first();
    await expect(first).toBeVisible();

    const renameTrigger = first.getByRole("button", {
      name: "More actions for New coding session",
    });
    if (viewport.name === "desktop") {
      await renameTrigger.focus();
      await renameTrigger.press("Enter");
      await page.getByRole("menuitem", { name: /Rename/ }).press("Enter");
    } else {
      await renameTrigger.click();
      await page.getByRole("menuitem", { name: /Rename/ }).click();
    }
    const input = page.getByRole("textbox", { name: "Session title" });
    await input.fill("Renamed session");
    await input.press("Enter");
    const renamed = navigation
      .locator('div[role="treeitem"][data-session-id]')
      .filter({ hasText: "Renamed session" });
    await expect(renamed).toBeVisible();
    expect(
      requests.find((entry) => entry.method === "session/title.set")?.params,
    ).toMatchObject({ title: "Renamed session" });

    await navigation
      .getByRole("button", { name: "More actions for Renamed session" })
      .click();
    await page.getByRole("menuitem", { name: /Delete…/ }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this session?" });
    await expect(dialog).toContainText("Renamed session");
    const listCount = requests.filter(
      (entry) => entry.method === "session/list",
    ).length;
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(renamed).toHaveCount(0);
    expect(requests.some((entry) => entry.method === "session/delete")).toBe(
      true,
    );
    await expect
      .poll(
        () =>
          requests.filter((entry) => entry.method === "session/list").length,
      )
      .toBeGreaterThan(listCount);
    await expect(renamed).toHaveCount(0);
    await page.reload();
    await expect(composer(page)).toBeEnabled();
    const reloadedNavigation = await openNavigation(page);
    await expect(reloadedNavigation).toBeVisible();
    await expect(
      reloadedNavigation
        .locator('div[role="treeitem"][data-session-id]')
        .filter({ hasText: "Renamed session" }),
    ).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).include("aside").analyze()).violations,
    ).toEqual([]);
    if (testInfo.project.name === "chromium") {
      await expect(reloadedNavigation).toHaveScreenshot(
        `session-after-delete-${viewport.name}.png`,
        SNAPSHOT,
      );
    }
  });

  test(`long search titles keep their start and status visible on ${viewport.name}`, async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "one visual engine");
    const workspace = `/workspace/session-long-title-${viewport.name}`;
    await request.post(
      `${origin}/__test__/session-list/scoped?workspace=${encodeURIComponent(workspace)}`,
    );
    const longTitle =
      "Weekly architecture review with a deliberately very long session title that must keep its beginning visible";
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await startSession(page, workspace);
    await composer(page).fill(longTitle);
    await composer(page).press("Enter");
    await expect(page.getByText("Turn complete").last()).toBeVisible();
    const navigation = await openNavigation(page);
    await navigation
      .getByRole("button", { name: "More actions for New coding session" })
      .click();
    await page.getByRole("menuitem", { name: /Rename/ }).click();
    const rename = page.getByRole("textbox", { name: "Session title" });
    await rename.fill(longTitle);
    await rename.press("Enter");
    await navigation.getByRole("button", { name: "Search sessions" }).click();
    await navigation
      .getByRole("textbox", { name: "Search sessions" })
      .fill("architecture");
    const result = navigation
      .getByRole("treeitem")
      .filter({ hasText: longTitle });
    const title = result.locator('[class*="searchResultTitle"]');
    const heading = result.locator('[class*="searchResultHeading"]');
    const status = result.locator('[class*="statusSlot"]');
    await expect(title).toHaveAttribute("title", longTitle);
    await expect(title).toHaveCSS("text-overflow", "ellipsis");
    const titleBox = await title.boundingBox();
    const headingBox = await heading.boundingBox();
    const statusBox = await status.boundingBox();
    const rowBox = await result.boundingBox();
    const navigationBox = await navigation.boundingBox();
    expect(rowBox!.x).toBeGreaterThanOrEqual(navigationBox!.x);
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(
      navigationBox!.x + navigationBox!.width + 1,
    );
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(
      rowBox!.x + rowBox!.width + 1,
    );
    expect(statusBox!.x).toBeGreaterThanOrEqual(headingBox!.x);

    await result.click();
    const reopened = await openNavigation(page);
    const selected = reopened.getByRole("treeitem", {
      name: /Weekly architecture review/,
    });
    await expect(selected).toHaveAttribute("aria-current", "page");
    const selectedStatus = await selected
      .locator('[class*="statusSlot"]')
      .boundingBox();
    expect(selectedStatus!.x).toBe(statusBox!.x);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    expect(
      (await new AxeBuilder({ page }).include("aside").analyze()).violations,
    ).toEqual([]);
    await expect(reopened).toHaveScreenshot(
      `session-long-title-${viewport.name}.png`,
      SNAPSHOT,
    );
  });
}
