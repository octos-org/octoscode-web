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
const CODE = "R7K2QPX9";

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

const tokenBox = (page: Page) => page.getByLabel("Auth token", { exact: true });
const workspaceGate = (page: Page) => page.getByLabel("Server workspace path");

test.afterEach(async ({ request }) => {
  await stagePairing(request, "fresh");
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
