import { expect, test, type Locator, type Page } from "@playwright/test";

// Durability probe for octoscode-web#78 / octos-org/octos#2831: a prompt sent
// while a turn is in flight must survive a page refresh. Real `octos serve`,
// real provider. The acceptance standard for the core-side ledger fix — the
// client has nothing to recover with when the row is dropped server-side.
//
// Both variants below FAILED on core v2.0.3 (2026-10-26, clean workspace):
// the reload reconnects and renders the timeline, but the user's prompt row
// is gone — the server dropped the uncommitted ledger line (serve log
// `dropped=1`). They stay `test.fixme` until the core fix lands; remove the
// fixme to run them against a fixed build.
const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = required("OCTOSCODE_LIVE_TOKEN");
const cwd = required("OCTOSCODE_LIVE_WORKSPACE");
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the probe`);
  return value;
}

function timeline(page: Page): Locator {
  return page.getByRole("log", { name: "Conversation timeline" });
}

/** Send a marker prompt and prove the turn is genuinely in flight. */
async function sendInFlight(page: Page, marker: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(endpoint);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace).toBeVisible({ timeout: 30_000 });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Start session" }).click();

  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await expect(composer).toBeEnabled({ timeout: 60_000 });
  await composer.fill(
    `Durability probe. Keep counting slowly from 1 to 300, then reply with the exact marker ${marker} and nothing else. Use no tools.`,
  );
  await page.getByRole("button", { name: "Send prompt" }).click();

  // The refresh below is only meaningful while the turn is actually live;
  // bailing out loudly beats a green run that exercised a finished turn.
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
}

test.fixme("the prompt survives a refresh while the turn is still running", async ({
  page,
}) => {
  const marker = `DURABILITY_PROBE_MIDTURN_${Date.now()}`;
  await sendInFlight(page, marker);

  await page.reload();
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".entry-user").filter({ hasText: marker }),
  ).toBeVisible({ timeout: 30_000 });
});

test.fixme("the prompt survives a refresh after stopping the turn", async ({
  page,
}) => {
  const marker = `DURABILITY_PROBE_STOPPED_${Date.now()}`;
  await sendInFlight(page, marker);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0, { timeout: 60_000 });

  await page.reload();
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".entry-user").filter({ hasText: marker }),
  ).toBeVisible({ timeout: 30_000 });
});
