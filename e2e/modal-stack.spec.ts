import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";

const start = (page: Page) => startSession(page, "/workspace/modal-stack");

test("review above an approval owns Tab and Escape at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  const interrupts: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "turn/interrupt") interrupts.push(request.params);
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
  // The session panel opens on Changes as a drawer stacked above the
  // approval, at every width: the approval keeps the keyboard otherwise.
  const review = page.getByRole("dialog", { name: "Session panel" });
  await expect(
    review.getByRole("heading", { name: "Mock coding change" }),
  ).toBeVisible();
  // Each surface mounts at document.body through its own portal, so the
  // review is not nested in the approval that opened it. Safari does not
  // anchor a position:fixed dialog to the viewport once an ancestor scrolls
  // or establishes a containing block, which left such a nested dialog
  // unreachable behind its own backdrop.
  const nesting = await review.evaluate((element) => ({
    reviewAtBody: element.parentElement?.parentElement === document.body,
    insideAnotherDialog:
      element.parentElement?.parentElement?.closest("[role='dialog']") !== null,
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
  // Shift+Tab from the first control wraps to it.
  await review.getByRole("tab", { selected: true }).focus();
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
