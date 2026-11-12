import { expect, test } from "@playwright/test";
import { openLink, startSession } from "./fixture-session";
import { openSettings } from "./sessions";
import { observeSent } from "./turn-observers";

// Cross-tab session lock (#56): two tabs in the SAME browser context share
// the Web Locks origin, so a second tab opening the same session must see
// the lock banner, sending stays gated, Take-over steals the lock, and the
// first tab is told it lost the session — both directions.
const BANNER_TEXT =
  "This session is open in another tab. Sending is disabled here until you take over.";

test("a second tab sees the lock, takes over, and the first tab sees the loss", async ({
  page,
}) => {
  await startSession(page, "/workspace/tab-lock");

  // Tab A: copy the confirmed session link from Settings → General.
  const settings = await openSettings(page, "General");
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
  const tabBStarts = observeSent(tabB, "turn/start");
  await openLink(tabB, link!);
  await expect(
    tabB.getByRole("status").filter({ hasText: BANNER_TEXT }),
  ).toBeVisible();
  // While locked, sending from tab B starts nothing and keeps the text.
  const lockedComposer = tabB.getByRole("textbox", { name: "Message Octos" });
  await lockedComposer.fill("Locked tab must not send");
  await lockedComposer.press("Enter");
  await expect(lockedComposer).toHaveValue("Locked tab must not send");
  expect(tabBStarts()).toHaveLength(0);
  await lockedComposer.fill("");

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
