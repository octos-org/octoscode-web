import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const token = "tab-scoped-e2e-token";

async function connect(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

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
  await request.post(`${origin}/__test__/connectors/reset`);
});

test("a server without the OAuth methods shows no sign-in", async ({
  page,
}) => {
  await connect(page, `/srv/work/connector-management-${Date.now()}`);
  const settings = await openConnectors(page);
  await expect(settings.locator("[data-connector-id]")).toHaveCount(2);
  await expect(settings.getByRole("button", { name: /Sign in/ })).toHaveCount(
    0,
  );
});

test("signs a connector in through the provider and back", async ({ page }) => {
  const frames = sentFrames(page);
  await connect(page, `/srv/work/connector-management-oauth-${Date.now()}`);
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

test("a provider-side revocation flips the row on the next status read", async ({
  page,
  request,
}) => {
  // T-0371: the provider revokes out of band; a remembered "Signed in" must
  // not survive the next status read.
  await connect(page, `/srv/work/connector-management-oauth-${Date.now()}`);
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');

  const popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  const closed = popup.waitForEvent("close");
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await closed;
  await expect(issues).toContainText("Signed in.");
  await expect(issues).toContainText("connected");

  await request.post(`${origin}/__test__/oauth/provider-revoke`);
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(issues).toContainText("Authorization required");
  await expect(issues).toContainText("This connector needs you to sign in.");
  await expect(issues).not.toContainText("Signed in.");
  await expect(
    issues.getByRole("button", { name: "Sign in again" }),
  ).toBeEnabled();
});

test("a cancelled sign-in saves nothing, even if its window is used afterwards", async ({
  page,
}) => {
  const frames = sentFrames(page);
  await connect(page, `/srv/work/connector-management-oauth-${Date.now()}`);
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');
  const popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  await expect(
    popup.getByRole("heading", { name: "Mock provider sign-in" }),
  ).toBeVisible();
  await issues.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(issues).toContainText(
    "Sign-in cancelled. Nothing was saved. You can close the sign-in window.",
  );
  await expect(issues).toContainText("Authorization required");
  expect(frames.some((frame) => frame.method === "mcp/oauth/cancel")).toBe(
    true,
  );
  // The provider's page is cut off from this one, so it stays open; allowing
  // there now reaches no waiting sign-in.
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await expect(
    popup.getByRole("heading", {
      name: "No Octoscode page is waiting for this sign-in",
    }),
  ).toBeVisible();
  expect(frames.some((frame) => frame.method === "mcp/oauth/complete")).toBe(
    false,
  );
  await expect(issues).toContainText("Sign-in cancelled.");
  await expect(
    issues.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
});

test("a refusal at the provider and a failed exchange both say so", async ({
  page,
}) => {
  const frames = sentFrames(page);
  await connect(page, `/srv/work/connector-management-oauth-${Date.now()}`);
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');

  let popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  let popup = await popupOpened;
  await popup.getByRole("link", { name: "Deny", exact: true }).click();
  await expect(issues).toContainText(
    "Sign-in didn't finish: the service answered “The person said no”.",
  );
  // A refusal has nothing to exchange: the flow is cancelled, not completed.
  expect(frames.some((frame) => frame.method === "mcp/oauth/complete")).toBe(
    false,
  );
  expect(frames.some((frame) => frame.method === "mcp/oauth/cancel")).toBe(
    true,
  );

  popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in again" }).click();
  popup = await popupOpened;
  await popup
    .getByRole("link", { name: "Allow with a code the exchange refuses" })
    .click();
  await expect(issues).toContainText(
    "Sign-in didn't finish: the service refused it when Octos exchanged it.",
  );
  await issues.getByText("Technical details").click();
  await expect(issues).toContainText("invalid_grant");
  await expect(issues).toContainText("Authorization required");
  await expect(
    issues.getByRole("button", { name: "Sign in again" }),
  ).toBeEnabled();
});

test("a sign-in returning after the page was refreshed is turned away", async ({
  page,
}) => {
  const workspace = `/srv/work/connector-management-oauth-${Date.now()}`;
  await connect(page, workspace);
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

test("a server that refuses this page as the return address takes a pasted one", async ({
  page,
  context,
}) => {
  // Core's manual return address answers nowhere; stand a page in for it.
  await context.route("http://127.0.0.1/oauth/mcp/callback**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Unreachable</title>",
    }),
  );
  const frames = sentFrames(page);
  await connect(
    page,
    `/srv/work/connector-management-oauth-manual-${Date.now()}`,
  );
  const settings = await openConnectors(page);
  const issues = settings.locator('[data-connector-id="issues"]');
  const popupOpened = page.waitForEvent("popup");
  await issues.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  await expect(issues).toContainText(
    "This server takes the sign-in back by hand",
  );
  const starts = frames.filter((frame) => frame.method === "mcp/oauth/start");
  expect(starts.map((frame) => "redirect_uri" in (frame.params ?? {}))).toEqual(
    [true, false],
  );
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await popup.waitForURL("http://127.0.0.1/oauth/mcp/callback?**");

  const address = issues.getByLabel("Address after signing in");
  await address.fill("not an address");
  await issues.getByRole("button", { name: "Finish signing in" }).click();
  await expect(issues.getByRole("alert")).toContainText(
    "That isn't a web address.",
  );
  await address.fill(popup.url());
  await issues.getByRole("button", { name: "Finish signing in" }).click();
  await expect(issues).toContainText("Signed in.");
  await expect(issues).toContainText("connected");
});

test("on a server that loads changes at restart, signing in says so", async ({
  page,
}) => {
  await connect(
    page,
    `/srv/work/connector-management-pinned-oauth-${Date.now()}`,
  );
  const settings = await openConnectors(page);
  await settings.getByRole("button", { name: "Add HTTP connector" }).click();
  const add = settings.getByRole("form", { name: "Add HTTP connector" });
  await add.getByLabel("Connector name").fill("Team wiki");
  await add.getByLabel("HTTP URL").fill("https://wiki.example.test/mcp");
  await add.getByRole("button", { name: "Save connector" }).click();
  const row = settings.locator(
    '[data-connector-saved][data-connector-id="mcp-1"]',
  );
  await expect(row).toContainText(
    "Saved, takes effect after the server restarts",
  );

  const popupOpened = page.waitForEvent("popup");
  await row.getByRole("button", { name: "Sign in", exact: true }).click();
  const popup = await popupOpened;
  await popup.getByRole("link", { name: "Allow", exact: true }).click();
  await expect(row).toContainText(
    "Signed in. Takes effect after the server restarts.",
  );
  await expect(
    row.getByRole("button", { name: "Revoke sign-in" }),
  ).toBeVisible();
});
