import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "workspace-browse-e2e-token";

async function connect(page: Page, path = "/?view=remote") {
  await page.goto(path);
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

test.afterEach(async ({ request }) => {
  await request.post(`${ORIGIN}/__test__/session-list/reset`);
});

test("phone browses a server folder without typing or starting a session", async ({
  page,
  request,
}) => {
  await request.post(
    `${ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent("/srv/fixture/Projects/octoscode-web")}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const methods: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method) methods.push(frame.method);
    }),
  );
  await connect(page);
  await page
    .getByRole("button", { name: "Browse server folders", exact: true })
    .click();
  await page.getByRole("button", { name: "Open folder Projects" }).click();
  await page.getByRole("button", { name: "Use folder octoscode-web" }).click();
  await expect(
    page.getByRole("region", { name: "Watched folders" }),
  ).toContainText("/srv/fixture/Projects/octoscode-web");
  expect(methods).toContain("onboarding/workspace_list");
  expect(methods).not.toContain("session/open");
  expect(methods).not.toContain("turn/start");
});

test("desktop handoff lets a fresh phone approve work without entering folders", async ({
  browser,
  request,
}) => {
  const folder = "/srv/fixture/Projects/octoscode-web";
  await request.post(
    `${ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
  );
  const desktop = await browser.newPage();
  await connect(desktop, "/");
  await desktop.getByRole("button", { name: "Open folder Projects" }).click();
  await desktop
    .getByRole("button", { name: "Use folder octoscode-web" })
    .click();
  const composer = desktop.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill("Request approval fixture");
  await composer.press("Enter");
  const approval = desktop.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await desktop
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await desktop.getByRole("menuitem", { name: "Continue on phone" }).click();
  const handoff = desktop.getByRole("dialog", { name: "Continue on phone" });
  await desktop
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  const link = await handoff
    .getByRole("textbox", { name: "Phone link" })
    .inputValue();
  await handoff.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect
    .poll(() => desktop.evaluate(() => navigator.clipboard.readText()))
    .toBe(link);
  const linkBox = handoff.getByRole("textbox", { name: "Phone link" });
  await linkBox.focus();
  await linkBox.press("ArrowDown");
  await expect(
    desktop.getByRole("menu", { name: "Conversation actions" }),
  ).toHaveCount(0);
  await expect(linkBox).toBeFocused();
  expect(link).not.toContain(TOKEN);
  expect(link).not.toContain("session_id");
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(link);
  // This fixture hosts web and Core on different ports. Cross-origin links
  // cannot choose the credential destination; the user enters it manually.
  await expect(phone.getByLabel("Server origin")).toHaveValue(
    new URL(link).origin,
  );
  await expect(phone.getByRole("alert")).toContainText("not filled in");
  await phone.getByLabel("Server origin").fill(ORIGIN);
  await expect(phone.getByLabel("Auth token", { exact: true })).toHaveValue("");
  await phone.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await phone.getByRole("button", { name: "Connect", exact: true }).tap();
  await phone
    .getByRole("region", { name: /^Waiting for you/ })
    .getByRole("button", { name: /Run product checks/ })
    .tap();
  await phone
    .getByRole("dialog", { name: "Run product checks?" })
    .getByRole("button", { name: /Allow once/ })
    .tap();
  await handoff.getByRole("button", { name: "Close", exact: true }).click();
  await expect(approval).toHaveCount(0);
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();
  await phone.reload();
  await expect(
    phone.getByRole("region", { name: "Watched folders" }),
  ).toContainText(folder);
});

test("a handoff never auto-connects with this tab's saved credential", async ({
  page,
}) => {
  await connect(page);
  await expect(
    page.getByRole("heading", { name: "Remote control" }),
  ).toBeVisible();
  const url = new URL(page.url());
  url.hash = new URLSearchParams({
    handoff: JSON.stringify({
      endpoint: "http://127.0.0.1:59999",
      folders: ["/srv/private"],
    }),
  }).toString();
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(new URL(ws.url()).origin));
  await page.goto("about:blank");
  await page.goto(url.href);
  await expect(page.getByLabel("Server origin")).toHaveValue(url.origin);
  await expect(page.getByRole("alert")).toContainText("not filled in");
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue("");
  expect(sockets).toEqual([]);
  // An operator selecting a different server must not import its paths there.
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("different server");
  await expect(
    page.getByRole("region", { name: "Watched folders" }),
  ).not.toContainText("/srv/private");
});

test("a malformed phone link reports an error and offers manual connection", async ({
  page,
}) => {
  await page.goto("/?view=remote#handoff=broken");
  await expect(page.getByRole("alert")).toContainText("phone link is invalid");
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue("");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Remote control" }),
  ).toBeVisible();
  // An older core still has the manual path form, never an unusable Browse.
  await expect(
    page.getByRole("button", { name: "Browse server folders" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Server folder path")).toBeVisible();
});
