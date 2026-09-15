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
    // Each surface mounts at document.body through its own portal, so the
    // review is not nested in the approval that opened it. Safari does not
    // anchor a position:fixed dialog to the viewport once an ancestor scrolls
    // or establishes a containing block, which left such a nested dialog
    // unreachable behind its own backdrop.
    const nesting = await review.evaluate((element) => ({
      reviewAtBody: element.parentElement?.parentElement === document.body,
      insideAnotherDialog:
        element.parentElement?.parentElement?.closest("[role='dialog']") !==
        null,
    }));
    expect(nesting).toEqual({ reviewAtBody: true, insideAnotherDialog: false });
    expect(
      await approval.evaluate(
        (element) => element.parentElement?.parentElement === document.body,
      ),
    ).toBe(true);
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
    // Retargeted after the v0.10.0 rebase: this shell keeps our composer and
    // its Session status strip, which replaced upstream's composer-level
    // "Runtime model:" chip, so Settings is reached from the navigation rail.
    // What this test guards is unchanged — the Settings dialog below the
    // provider confirmation.
    // The narrow layout keeps the rail behind "Open sessions" and dismisses it
    // with the dialog, handing focus back to that toggle; the wide layout shows
    // the rail outright and hands focus back to its Settings entry. Either way
    // focus must land back on the control that opened the dialog.
    const railToggle = page.getByRole("button", { name: "Open sessions" });
    const railWasClosed = await railToggle.isVisible();
    if (railWasClosed) await railToggle.click();
    const settingsEntry = page.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    const trigger = railWasClosed ? railToggle : settingsEntry;
    await settingsEntry.click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    // Upstream's chip opened Settings already on the models section; the rail
    // entry opens it on General, so select Models to reach the same surface.
    await settings.getByRole("button", { name: "Models", exact: true }).click();
    await expect(
      settings.getByRole("list", { name: "Configured providers" }),
    ).toBeVisible();
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
