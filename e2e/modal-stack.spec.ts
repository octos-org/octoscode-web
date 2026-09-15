import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill("/workspace/modal-stack");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

for (const viewport of [
  { width: 320, height: 480 },
  { width: 1280, height: 720 },
]) {
  test(`review above an approval owns Tab and Escape at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const interrupts: unknown[] = [];
    await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const request = JSON.parse(String(message));
        if (request.method === "turn/interrupt")
          interrupts.push(request.params);
        server.send(message);
      });
      server.onMessage((message) => {
        const notification = JSON.parse(String(message));
        if (notification.method === "approval/requested") {
          notification.params.typed_details.diff = {
            preview_id: "00000000-0000-4000-8000-000000000042",
          };
          socket.send(JSON.stringify(notification));
        } else {
          socket.send(message);
        }
      });
    });
    await start(page);
    const composer = page.getByRole("textbox", { name: "Message Octos" });
    await composer.fill("Request approval fixture");
    await composer.press("Enter");
    const approval = page.getByRole("dialog", { name: "Run product checks?" });
    const reviewTrigger = approval.getByRole("button", { name: /Review diff/ });
    await reviewTrigger.click();
    const review = page.getByRole("dialog", { name: "Mock coding change" });
    await expect(review).toBeVisible();
    const visited = new Set<string>();
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press("Tab");
      expect(
        await review.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      visited.add(
        await page.evaluate(() => document.activeElement?.outerHTML ?? ""),
      );
    }
    expect(visited.size).toBeGreaterThan(2);
    // The last file's summary stays reachable when its disclosure is closed.
    const summary = review.locator("summary").last();
    await summary.click();
    await expect(summary.locator("..")).not.toHaveAttribute("open");
    await review.getByRole("button", { name: "Refresh", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(summary).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await expect(approval).toBeVisible();
    await expect(reviewTrigger).toBeFocused();
    expect(interrupts).toEqual([]);
    // The underlying approval retains its own Escape-to-stop behavior.
    await page.keyboard.press("Escape");
    await expect.poll(() => interrupts.length).toBe(1);
  });

  test(`canceling a provider confirmation preserves Settings at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await start(page);
    const trigger = page.getByRole("button", { name: /^Runtime model:/ });
    await trigger.click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    const deleteTrigger = settings
      .getByRole("list", { name: "Configured providers" })
      .getByRole("button", { name: /^Delete / })
      .first();
    await deleteTrigger.click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete model provider?",
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press("Tab");
      expect(
        await confirmation.evaluate((el) =>
          el.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    const confirmationInput = confirmation.getByRole("textbox");
    await confirmationInput.focus();
    await confirmationInput.dispatchEvent("keydown", {
      key: "Escape",
      code: "Escape",
      isComposing: true,
    });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(deleteTrigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
