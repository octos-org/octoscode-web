import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "workspace-browse-e2e-token";
const FOLDER = "/srv/fixture/Projects/octoscode-web";

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/session-list/reset`);
});

function handoff(endpoint: string) {
  return `/?view=remote#${new URLSearchParams({
    handoff: JSON.stringify({ endpoint, folders: [FOLDER] }),
  })}`;
}

test("a forged cross-origin handoff cannot select where a pasted token is sent", async ({
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
  const target = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(handoff(target));
    // Soft assertions still let the old implementation reveal the actual leak.
    await expect.soft(page.getByLabel("Server origin")).toHaveValue(baseURL!);
    await expect.soft(page.getByRole("alert")).toContainText("not filled in");
    await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
    const opening = page.waitForEvent("websocket");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    const socket = await opening;
    // The receiver has processed the upgrade before the browser sees it close.
    await expect.poll(() => socket.isClosed()).toBe(true);
    await test.info().attach("credential-destination", {
      body: JSON.stringify({
        receivedToken,
        destinationHost: new URL(socket.url()).host,
      }),
      contentType: "application/json",
    });
    expect(receivedToken).toBe(false);
    expect(new URL(socket.url()).host).toBe(new URL(baseURL!).host);
  } finally {
    await page.close();
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a same-origin handoff connects and imports folders without another step", async ({
  page,
  request,
  baseURL,
}) => {
  await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(FOLDER)}`,
  );
  // Routed documents lack a network address space in Chromium. Permit the
  // test fixture access explicitly; the leak probe above uses a real page.
  await page.context().grantPermissions(["local-network-access"]);
  // Serve the built web assets at the fixture origin; WebSockets still reach
  // the real fixture server, just as a same-origin deployment proxies them.
  await page.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    url.host = new URL(baseURL!).host;
    await route.fulfill({ response: await route.fetch({ url: url.href }) });
  });
  await page.goto(`${FIXTURE_ORIGIN}${handoff(FIXTURE_ORIGIN)}`);
  await expect(page.getByLabel("Server origin")).toHaveValue(FIXTURE_ORIGIN);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Auth token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Watched folders" }),
  ).toContainText(FOLDER);
});

for (const difference of ["scheme", "host"] as const) {
  test(`a handoff with a different ${difference} does not prefill its address`, async ({
    page,
    baseURL,
  }) => {
    const target = new URL(baseURL!);
    if (difference === "scheme") target.protocol = "https:";
    else target.hostname = "localhost";
    await page.goto(handoff(target.origin));
    await expect(page.getByLabel("Server origin")).toHaveValue(baseURL!);
    await expect(page.getByRole("alert")).toContainText("not filled in");
    await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue(
      "",
    );
  });
}
