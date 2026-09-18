import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * WEB-PAIRING-CONTRACT-5100 §Client — opening the web client from the link the
 * server prints. The resulting credential stays within this browser tab.
 */
const FIXTURE_PORT = process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080";
const ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
/** The same host, spelled differently, so "origin prefilled" is observable. */
const LINK_ORIGIN = `http://localhost:${FIXTURE_PORT}`;
const CODE = "R7K2QPX9";
const DURABLE_KEY = "octoscode-web.connection.v2";
const REMEMBERED_KEY = (endpoint: string) =>
  `octoscode-web.remembered-token.v1:${encodeURIComponent(endpoint)}`;

function link(origin: string, code: string): string {
  return `/?octos=${encodeURIComponent(origin)}&pair=${encodeURIComponent(code)}`;
}

async function stagePairing(
  request: APIRequestContext,
  mode: "fresh" | "burned" | "expired" | "locked" | "unsupported",
): Promise<void> {
  const response = await request.post(
    `${ORIGIN}/__test__/pair/reset?mode=${mode}`,
  );
  expect(response.status()).toBe(204);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const tokenBox = (page: Page) => page.getByLabel("Auth token", { exact: true });
const workspaceGate = (page: Page) => page.getByLabel("Server workspace path");

test.afterEach(async ({ request }) => {
  await stagePairing(request, "fresh");
});

test("a good link connects with no token box and leaves nothing in the address", async ({
  page,
  request,
}) => {
  await stagePairing(request, "fresh");
  const errors = watchErrors(page);
  const leakedReferrers: string[] = [];
  page.on("request", (request) => {
    if (request.headers().referer?.includes("pair="))
      leakedReferrers.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await tokenBox(page).waitFor();
  await page.evaluate(
    ({ origin, key }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, token: "legacy-token" }),
      );
      localStorage.setItem(
        key + "-other-origin",
        JSON.stringify({ version: 1, token: "other-legacy-token" }),
      );
      sessionStorage.setItem(
        "octoscode-web.tab-connection.v3",
        JSON.stringify({
          version: 3,
          endpoint: origin,
          token: "previous-token",
          sessionId: "coding:api:previous-identity",
          profileId: "coding",
          cwd: "/workspace/previous-identity",
          autoConnect: true,
          knownSessions: [],
          composerDrafts: [],
        }),
      );
    },
    { origin: ORIGIN, key: REMEMBERED_KEY(ORIGIN) },
  );
  const openedSessions: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "session/open") openedSessions.push(frame.params);
    }),
  );
  await page.goto(link(ORIGIN, CODE));
  // Step 3: the link is exchanged, the client connects, and the address no
  // longer carries either value.
  await expect(workspaceGate(page)).toBeVisible();
  await expect(tokenBox(page)).toHaveCount(0);
  expect(page.url()).not.toContain("pair=");
  expect(page.url()).not.toContain("octos=");
  expect(leakedReferrers).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("octoscode-web.remembered-token.v1:"),
      ),
    ),
  ).toEqual([]);
  const selection = await page.evaluate(() => {
    const saved = JSON.parse(
      sessionStorage.getItem("octoscode-web.tab-connection.v3")!,
    );
    return {
      sessionId: saved.sessionId,
      profileId: saved.profileId,
      cwd: saved.cwd,
    };
  });
  expect(selection).toEqual({
    sessionId: "coding:local:main",
    profileId: "",
    cwd: "",
  });
  await page.reload();
  await expect(workspaceGate(page)).toBeVisible();
  expect(openedSessions).toEqual([]);
  const everything = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  );
  expect(everything).not.toContain(CODE);
  expect(errors).toEqual([]);
});

test("a used link says so and falls back to the form with the origin prefilled", async ({
  page,
  request,
}) => {
  await stagePairing(request, "burned");
  const errors = watchErrors(page);
  await page.goto(link(LINK_ORIGIN, CODE));
  await expect(
    page.getByRole("alert").filter({ hasText: "That link was already used." }),
  ).toContainText("Start the server again for a fresh link.");
  await expect(page.getByLabel("Server origin")).toHaveValue(LINK_ORIGIN);
  await expect(tokenBox(page)).toBeVisible();
  expect(page.url()).not.toContain("pair=");
  // The manual form still works from here, untouched.
  await tokenBox(page).fill("tab-scoped-e2e-token");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(workspaceGate(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("an expired code and a malformed link each get their own bounded copy", async ({
  page,
  request,
}) => {
  await stagePairing(request, "expired");
  await page.goto(link(LINK_ORIGIN, CODE));
  await expect(
    page.getByRole("alert").filter({ hasText: "That link expired." }),
  ).toContainText("Start the server again for a fresh link.");

  await stagePairing(request, "fresh");
  await page.goto(link(LINK_ORIGIN, "not-a-code"));
  await expect(
    page.getByRole("alert").filter({ hasText: "That link is malformed." }),
  ).toContainText("Copy it again from the server.");
  await expect(page.getByLabel("Server origin")).toHaveValue(LINK_ORIGIN);

  // A malformed body is not a guess: the attempt budget is untouched, so the
  // real code still works afterwards.
  const state = await (
    await request.get(`${ORIGIN}/__test__/pair/state`)
  ).json();
  expect(state.failures).toBe(0);
});

test("an octos origin off this computer is refused without a request", async ({
  page,
  request,
}) => {
  await stagePairing(request, "fresh");
  await page.goto(link("https://octos.example.com", CODE));
  await expect(
    page.getByRole("alert").filter({ hasText: "not on this computer" }),
  ).toBeVisible();
  // Refused before the POST: the fixture's single-use code is still unclaimed.
  const state = await (
    await request.get(`${ORIGIN}/__test__/pair/state`)
  ).json();
  expect(state.burned).toBe(false);
  expect(state.failures).toBe(0);
  // The refused address is NOT prefilled into the form.
  await expect(page.getByLabel("Server origin")).not.toHaveValue(
    "https://octos.example.com",
  );
});

test("the paired token survives only this tab until Forget", async ({
  page,
  context,
  request,
}) => {
  await stagePairing(request, "fresh");
  await page.goto(link(ORIGIN, CODE));
  await expect(workspaceGate(page)).toBeVisible();

  // Same tab: a reload does not ask again.
  await page.reload();
  await expect(workspaceGate(page)).toBeVisible();
  await expect(tokenBox(page)).toHaveCount(0);

  // A fresh tab has no credential, even while the paired tab remains open.
  const second = await context.newPage();
  await second.goto("/");
  await expect(tokenBox(second)).toBeVisible();
  await expect(tokenBox(second)).toHaveValue("");
  await second.close();

  // Forget removes the tab-scoped credential.
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Forget server", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(tokenBox(page)).toHaveValue("");
  await page.reload();
  await expect(tokenBox(page)).toBeVisible();
  await expect(tokenBox(page)).toHaveValue("");
});

test("a server that 404s /pair/info is simply pairing not supported", async ({
  page,
  request,
}) => {
  await stagePairing(request, "unsupported");
  const errors = watchErrors(page);
  await page.addInitScript(
    ([key, endpoint]) =>
      localStorage.setItem(
        key as string,
        JSON.stringify({ version: 2, endpoint }),
      ),
    [DURABLE_KEY, ORIGIN],
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  // No complaint of any kind, and no discovery offer.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Found Octos on")).toHaveCount(0);
  // The manual form is exactly as it was.
  await tokenBox(page).fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(workspaceGate(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a pairing-capable server this browser has seen offers itself once", async ({
  page,
  request,
}) => {
  await stagePairing(request, "fresh");
  await page.addInitScript(
    ([key, endpoint]) =>
      localStorage.setItem(
        key as string,
        JSON.stringify({ version: 2, endpoint }),
      ),
    [DURABLE_KEY, ORIGIN],
  );
  await page.goto("/");
  await expect(
    page.getByText(`Found Octos on 127.0.0.1:${FIXTURE_PORT}.`),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
