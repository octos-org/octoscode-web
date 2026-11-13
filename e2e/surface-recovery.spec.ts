import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session";
import {
  composer as composerInput,
  openSettings,
  stopButton,
} from "./sessions";
import { interceptRequests, sendResult } from "./wire";

const modelManagementModule =
  /\/(?:assets\/ModelManagementSettings-[^/]+\.js|src\/features\/product-settings\/ModelManagementSettings\.tsx)(?:\?.*)?$/;

async function start(page: Page) {
  await startSession(page, "/workspace/surface-recovery");
  await expect(composerInput(page)).toBeVisible();
}

function settingsTrigger(page: Page) {
  return page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true });
}

test("a failed model-management chunk preserves the owner, queue, draft and Stop", async ({
  page,
}) => {
  let closed = 0;
  const starts: string[] = [];
  const interrupts: string[] = [];
  page.on("websocket", (socket) => socket.on("close", () => closed++));
  await interceptRequests(page, (frame, socket) => {
    if (frame.method === "turn/interrupt")
      interrupts.push(frame.params.turn_id);
    if (frame.method !== "turn/start") return;
    starts.push(frame.params.turn_id);
    sendResult(socket, frame.id, {});
    return true;
  });
  // Armed before navigation: the settings chunk is now idle-preloaded
  // (#131), so the failure must apply from the very first fetch onward,
  // not just at click time.
  await page.route(modelManagementModule, (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Resource unavailable",
    }),
  );
  await start(page);
  const composer = composerInput(page);
  await composer.fill("Keep this response active");
  await composer.press("Enter");
  await expect(stopButton(page)).toBeVisible();
  await composer.fill("Keep this queued message");
  await composer.press("Enter");
  await composer.fill("Keep this unsent draft");
  const previouslyClosed = closed;
  await openSettings(page, "Models");
  const error = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(error).toBeVisible();
  await expect(
    error.getByRole("heading", { name: "Model management unavailable" }),
  ).toBeVisible();
  await expect(
    error.getByRole("button", { name: "Models", exact: true }),
  ).toBeFocused();
  await expect(error).toContainText("Reload the page to try again.");
  await expect(error).toContainText("Reloading keeps the drafts");
  expect(closed).toBe(previouslyClosed);
  expect(starts).toHaveLength(1);
  expect(interrupts).toHaveLength(0);
  await error
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(settingsTrigger(page)).toBeFocused();
  await expect(composer).toHaveValue("Keep this unsent draft");
  await expect(
    page.getByText("Keep this queued message", { exact: true }),
  ).toBeVisible();
  await stopButton(page).click();
  await expect.poll(() => interrupts.length).toBe(1);

  // Once the server serves another build, the same failure says it was updated.
  await page.route("**/index.html", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /index-[\w-]+\.js/,
      "index-x.js",
    );
    await route.fulfill({ response, body });
  });
  await openSettings(page, "Models");
  await expect(error).toContainText("Octoscode was updated on the server");
  await expect(error).not.toContainText("Reload the page to try again.");
});
