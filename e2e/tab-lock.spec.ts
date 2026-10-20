import { expect, test, type Page } from "@playwright/test";

// Cross-tab session lock (#56): two tabs in the SAME browser context share
// the Web Locks origin, so a second tab opening the same session must see
// the lock banner, sending stays gated, Take-over steals the lock, and the
// first tab is told it lost the session — both directions.
const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const BANNER_TEXT =
  "This session is open in another tab. Sending is disabled here until you take over.";

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

test("a second tab sees the lock, takes over, and the first tab sees the loss", async ({
  page,
}) => {
  await start(page, "/workspace/tab-lock");

  // Tab A: copy the confirmed session link from Settings → General.
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "General" }).click();
  await settings
    .getByRole("button", { name: "Copy conversation link" })
    .click();

  // Clipboard access may be denied in the test browser; the component then
  // exposes the URL through a read-only textarea.
  let link: string | null = null;
  const fallback = settings.getByLabel("Conversation link");
  try {
    await expect(fallback).toBeVisible({ timeout: 5_000 });
    link = await fallback.inputValue();
  } catch {
    link = await page.evaluate(() => navigator.clipboard.readText());
  }
  expect(link).toContain("?s=");
  await page.keyboard.press("Escape");

  // Tab B: same context (shared Web Locks). The auth token is tab-scoped, so
  // the link alone cannot authenticate — connect first, then the saved link
  // offers the conversation.
  const tabB = await page.context().newPage();
  await tabB.goto(link!);
  await tabB.getByLabel("Server origin").fill(ORIGIN);
  await tabB
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await tabB.getByRole("button", { name: "Connect", exact: true }).click();
  await tabB.getByRole("button", { name: "Open conversation" }).click();
  await expect(
    tabB.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    tabB.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toBeVisible();

  // The banner's Take-over steals the lock; tab A must be told it lost.
  await tabB.getByRole("button", { name: "Take over here" }).click();
  await expect(
    tabB.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toHaveCount(0, { timeout: 10_000 });
  // The steal notification resolves the stolen holder's request promise; it
  // lands within a second in practice, but budget for scheduling delay.
  await expect(
    page.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toBeVisible({ timeout: 10_000 });

  // And the original tab can take the session back.
  await page.getByRole("button", { name: "Take over here" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(
    tabB.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toBeVisible();

  await tabB.close();
});
