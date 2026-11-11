import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { FIXTURE_ORIGIN } from "./fixture-session";
import { openSettings } from "./sessions";

/**
 * WEB-PAIRING-CONTRACT-5100 §Client — opening the web client from the link the
 * server prints. The resulting credential stays within this browser tab.
 */
const CODE = "R7K2QPX9";

function link(origin: string, code: string): string {
  return `/?octos=${encodeURIComponent(origin)}&pair=${encodeURIComponent(code)}`;
}

async function stagePairing(
  request: APIRequestContext,
  mode: "fresh" | "burned" | "expired" | "locked" | "unsupported",
): Promise<void> {
  const response = await request.post(
    `${FIXTURE_ORIGIN}/__test__/pair/reset?mode=${mode}`,
  );
  expect(response.status()).toBe(204);
}

const tokenBox = (page: Page) => page.getByLabel("Auth token", { exact: true });
const workspaceGate = (page: Page) => page.getByLabel("Server workspace path");

test.afterEach(async ({ request }) => {
  await stagePairing(request, "fresh");
});

test("the paired token survives only this tab until Forget", async ({
  page,
  context,
  request,
}) => {
  await stagePairing(request, "fresh");
  await page.goto(link(FIXTURE_ORIGIN, CODE));
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
  const settings = await openSettings(page);
  await settings
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
