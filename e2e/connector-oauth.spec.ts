import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";

async function openConnectors(page: Page) {
  await page
    .locator("aside")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("button", { name: "Connectors", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  return settings;
}

/** Every frame the page sends, so a test can say what reached the server. */
function sentFrames(page: Page) {
  const frames: Array<{ method?: string; params?: Record<string, unknown> }> =
    [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)));
      } catch {
        // Not JSON-RPC.
      }
    }),
  );
  return frames;
}

async function storedValues(page: Page) {
  return page.evaluate(() =>
    [localStorage, sessionStorage]
      .flatMap((storage) =>
        Object.keys(storage).map((key) => storage.getItem(key) ?? ""),
      )
      .join("\n"),
  );
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/connectors/reset`);
});

test("signs a connector in through the provider and back", async ({ page }) => {
  const frames = sentFrames(page);
  await connectAndStartWorkspace(
    page,
    `/srv/work/connector-management-oauth-${Date.now()}`,
  );
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');
  await expect(issues).toContainText("Authorization required");
  await expect(issues).toContainText("This connector needs you to sign in.");
  // A connector that works, or one failing for another reason, gets no sign-in.
  await expect(
    settings
      .locator('[data-connector-id="legacy"]')
      .getByRole("button", { name: /Sign in/ }),
  ).toHaveCount(0);

  const popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  await expect(
    popup.getByRole("heading", { name: "Mock provider sign-in" }),
  ).toBeVisible();
  // The provider's page cannot reach back into the page that opened it.
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await expect(issues).toContainText(
    "Finish signing in in the window that opened.",
  );
  await expect(
    issues.getByRole("link", { name: "Open the sign-in page again" }),
  ).toHaveAttribute("rel", "noopener noreferrer");

  // Refreshing the list while waiting keeps the sign-in.
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(issues).toContainText(
    "Finish signing in in the window that opened.",
  );

  const closed = popup.waitForEvent("close");
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await expect(
    popup.getByRole("heading", { name: "Sign-in handed back" }),
  ).toBeVisible();
  // The return address is gone from the window before anything renders.
  expect(popup.url()).toBe(`${new URL(page.url()).origin}/oauth/mcp/callback`);
  await closed;

  await expect(issues).toContainText("Signed in.");
  await expect(issues).toContainText("connected");
  await expect(issues).toContainText("1 tools");
  await expect(issues).not.toContainText("Authorization required");
  await expect(
    issues.getByRole("button", { name: "Revoke sign-in" }),
  ).toBeVisible();

  const start = frames.find((frame) => frame.method === "mcp/oauth/start");
  expect(start?.params).toEqual({
    session_id: expect.any(String),
    connector_id: "issues",
    redirect_uri: `${new URL(page.url()).origin}/oauth/mcp/callback`,
  });
  const complete = frames.find(
    (frame) => frame.method === "mcp/oauth/complete",
  );
  expect(String(complete?.params?.callback_url)).toContain("code=ok-");
  // Neither the page nor the sign-in window kept the code.
  expect(await storedValues(page)).not.toContain("ok-");
  expect(page.url()).not.toContain("code=");

  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);

  // Revoke.
  await issues.getByRole("button", { name: "Revoke sign-in" }).click();
  await expect(issues.getByRole("alert")).toContainText(
    "Revoke the sign-in for Issue tracker?",
  );
  await issues.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(issues).toContainText(
    "Sign-in revoked. Sign in again to use this connector.",
  );
  await expect(issues).toContainText("Authorization required");
  await expect(
    issues.getByRole("button", { name: "Sign in again" }),
  ).toBeEnabled();
});

test("a sign-in returning after the page was refreshed is turned away", async ({
  page,
}) => {
  const workspace = `/srv/work/connector-management-oauth-${Date.now()}`;
  await connectAndStartWorkspace(page, workspace);
  let settings = await openConnectors(page);
  const popupOpened = page.waitForEvent("popup");
  await settings
    .locator('[data-connector-id="issues"]')
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  const popup = await popupOpened;
  await expect(
    popup.getByRole("heading", { name: "Mock provider sign-in" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await expect(
    popup.getByRole("heading", {
      name: "No Octoscode page is waiting for this sign-in",
    }),
  ).toBeVisible();
  expect(popup.url()).not.toContain("code=");

  settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');
  await expect(issues).toContainText("Authorization required");
  await expect(issues).not.toContainText("Signed in");
  await expect(
    issues.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
});

test("a restart-pending sign-in survives refreshes until the server confirms connected", async ({
  page,
}) => {
  // T-0430: on a restart-mode server the OLD connection keeps reporting its
  // stale failure until the restart. A refresh must not erase the stored
  // sign-in's "takes effect after restart" note (audit 2026-11-06 #347).
  await connectAndStartWorkspace(
    page,
    `/srv/work/connector-management-oauth-restart-${Date.now()}`,
  );
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');

  const popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await expect(issues).toContainText(
    "Signed in. Takes effect after the server restarts.",
  );

  // The stale connection still reads failed; the note stays, no flip back to
  // "Authorization required", and once the server reports connected the note
  // settles to a plain signed-in.
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(issues).toContainText(
    "Signed in. Takes effect after the server restarts.",
  );
  await expect(issues).not.toContainText("Authorization required");
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(issues).toContainText(
    "Signed in. Takes effect after the server restarts.",
  );
});
