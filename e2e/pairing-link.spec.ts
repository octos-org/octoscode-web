import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * WEB-PAIRING-CONTRACT-5100 §Client — opening the web client from the link the
 * server prints, and remembering the token it hands back per device.
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
  await page.goto(link(ORIGIN, CODE));
  // Step 3: the link is exchanged, the client connects, and the address no
  // longer carries either value.
  await expect(workspaceGate(page)).toBeVisible();
  await expect(tokenBox(page)).toHaveCount(0);
  expect(page.url()).not.toContain("pair=");
  expect(page.url()).not.toContain("octos=");
  // §Remembering: default ON for a pairing link — the token is on the device,
  // and the code that fetched it is nowhere at all.
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    REMEMBERED_KEY(ORIGIN),
  );
  expect(stored).toContain("paired-e2e-token");
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

test("the paired token is remembered across a reload and a fresh tab, then Forget clears it", async ({
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

  // A fresh tab has no sessionStorage at all — only the device memory can
  // carry this, and the code was single use, so it cannot be replayed.
  const second = await context.newPage();
  await second.goto("/");
  await expect(workspaceGate(second)).toBeVisible();
  await expect(tokenBox(second)).toHaveCount(0);
  await second.close();

  // Forget: the device memory goes, and the checkbox returns to its
  // hand-typed default with the storage line saying so.
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
  await expect(
    page.getByRole("checkbox", { name: "Remember on this device" }),
  ).not.toBeChecked();
  await expect(
    page.getByText("Your token stays in this browser tab."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      REMEMBERED_KEY(ORIGIN),
    ),
  ).toBeNull();
});

test("a browser that blocks site data still connects, and says so", async ({
  page,
  request,
}) => {
  await stagePairing(request, "fresh");
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) {
        throw new DOMException("Blocked site data", "SecurityError");
      }
      write.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await tokenBox(page).fill("tab-scoped-e2e-token");
  await page.getByRole("checkbox", { name: "Remember on this device" }).check();
  // Degraded to in-memory WITH a notice — and the connect still works.
  await expect(page.getByText("This browser blocked saved data")).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(workspaceGate(page)).toBeVisible();
  expect(errors).toEqual([]);
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
