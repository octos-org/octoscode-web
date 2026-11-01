import { expect, test, type Locator, type Page } from "@playwright/test";

// Press feedback must be visible while the pointer is still down: a step past
// hover (an inset overlay) plus a small shrink on buttons. Runs against the
// built bundle, so a minifier that drops a selector fails here.

const FIXTURE_ORIGIN = `http://127.0.0.1:${
  process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"
}`;

test.use({ channel: "chromium" });

async function startSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
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
    .fill("/workspace/octoscode-web");
  await add.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByPlaceholder("Ask Octos to change, explain, or review code…"),
  ).toBeVisible();
}

function pressStyle(target: Locator) {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, scale: style.scale };
  });
}

test.describe("mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("buttons and session rows show the press while held", async ({
    page,
  }) => {
    await startSession(page);

    const newSession = page.getByRole("button", {
      name: "New session",
      exact: true,
    });
    const box = (await newSession.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    expect((await pressStyle(newSession)).shadow).toBe("none");
    await page.mouse.down();
    await expect
      .poll(() => pressStyle(newSession))
      .toEqual({ shadow: expect.stringContaining("inset"), scale: "0.97" });
    await page.mouse.move(0, 0);
    await page.mouse.up();

    const row = page.locator("[data-session-id]").first();
    const rowBox = (await row.boundingBox())!;
    await page.mouse.move(rowBox.x + 40, rowBox.y + rowBox.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await pressStyle(row)).shadow)
      .toContain("inset");
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });
});

test.describe("touch", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a finger gets the press immediately, not after show-press", async ({
    page,
  }) => {
    await startSession(page);
    const panel = page.getByRole("button", { name: "Session panel" });
    const box = (await panel.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await expect(panel).toHaveAttribute("data-pressed", "");
    expect((await pressStyle(panel)).shadow).toContain("inset");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(panel).not.toHaveAttribute("data-pressed");
  });
});
