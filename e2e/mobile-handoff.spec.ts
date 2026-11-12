import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { connect, FIXTURE_ORIGIN } from "./fixture-session";
import { observeSent } from "./turn-observers";

const TOKEN = "workspace-browse-e2e-token";

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/session-list/reset`);
});

test("desktop handoff lets a fresh phone approve work without entering folders", async ({
  browser,
  request,
}) => {
  const folder = "/srv/fixture/Projects/octoscode-web";
  await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
  );
  const desktop = await browser.newPage();
  await connect(desktop, "/", TOKEN);
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
  const decisions = observeSent(phone, "approval/respond");
  await phone.goto(link);
  // This fixture hosts web and Core on different ports. Cross-origin links
  // cannot choose the credential destination; the user enters it manually.
  await expect(phone.getByLabel("Server origin")).toHaveValue(
    new URL(link).origin,
  );
  await expect(phone.getByRole("alert")).toContainText("not filled in");
  await phone.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await expect(phone.getByLabel("Auth token", { exact: true })).toHaveValue("");
  await phone.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await phone.getByRole("button", { name: "Connect", exact: true }).tap();
  await phone
    .getByRole("region", { name: /^Waiting for you/ })
    .getByRole("button", { name: /Run product checks/ })
    .tap();
  // From the phone this one request can be allowed, never the whole session.
  const phoneApproval = phone.getByRole("dialog", {
    name: "Run product checks?",
  });
  await expect(phoneApproval).toContainText(
    "From the phone you can allow this one request.",
  );
  await expect(
    phoneApproval.getByRole("button", { name: /Allow for this session/ }),
  ).toHaveCount(0);
  await phoneApproval.getByRole("button", { name: /Allow once/ }).tap();
  await expect.poll(decisions).toEqual([
    expect.objectContaining({
      decision: "approve",
      approval_scope: "request",
    }),
  ]);
  await handoff.getByRole("button", { name: "Close", exact: true }).click();
  await expect(approval).toHaveCount(0);
  await expect(desktop.getByText("Turn complete").first()).toBeVisible();
  await phone.reload();
  await expect(
    phone.getByRole("region", { name: "Watched folders" }),
  ).toContainText(folder);
});

test("a forged handoff never auto-connects, imports nothing, and cannot choose where a pasted token is sent", async ({
  page,
  baseURL,
}) => {
  // A real loopback receiver, not a route that suppresses credential traffic.
  let receivedToken = false;
  const receiver = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  receiver.on("upgrade", (request, socket) => {
    receivedToken ||=
      new URL(request.url!, "http://receiver.test").searchParams.get(
        "token",
      ) === TOKEN;
    socket.destroy();
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  const address = receiver.address();
  if (!address || typeof address === "string")
    throw new Error("No receiver port");
  try {
    await connect(page, "/?view=remote", TOKEN);
    await expect(
      page.getByRole("heading", { name: "Remote control" }),
    ).toBeVisible();
    const url = new URL(page.url());
    url.hash = new URLSearchParams({
      handoff: JSON.stringify({
        endpoint: `http://127.0.0.1:${address.port}`,
        folders: ["/srv/private"],
      }),
    }).toString();
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(new URL(ws.url()).origin));
    await page.goto("about:blank");
    await page.goto(url.href);
    // Soft, so a regression still reaches the check of where the token went.
    await expect.soft(page.getByLabel("Server origin")).toHaveValue(url.origin);
    await expect.soft(page.getByRole("alert")).toContainText("not filled in");
    await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue(
      "",
    );
    expect(sockets).toEqual([]);

    // A token pasted now goes to the origin on screen, not the link's server.
    await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
    const opening = page.waitForEvent("websocket");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const socket = await opening;
    // The receiver has processed the upgrade before the browser sees it close.
    await expect.poll(() => socket.isClosed()).toBe(true);
    expect(receivedToken).toBe(false);
    expect(new URL(socket.url()).host).toBe(new URL(baseURL!).host);

    // An operator selecting a different server must not import its paths there.
    await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
    await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("different server");
    await expect(
      page.getByRole("region", { name: "Watched folders" }),
    ).not.toContainText("/srv/private");
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
