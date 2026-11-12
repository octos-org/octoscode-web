import { expect, type Locator, type Page } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "./fixture-session";

/**
 * The product sidebar, addressed by CSS so it still resolves while an
 * approval or question dialog hides it from role queries.
 */
export const productNavigation = (page: Page): Locator => page.locator("aside");

/** A Session row by Session id: rows carry the id as `data-session-id`. */
export function sessionRow(navigation: Locator, sessionId: string): Locator {
  return navigation.locator(
    `[role="treeitem"][data-session-id=${JSON.stringify(sessionId)}]`,
  );
}

/** The selected Session's id. */
export async function selectedSessionId(navigation: Locator): Promise<string> {
  const sessionId = await navigation
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  if (!sessionId) throw new Error("Expected a selected Session");
  return sessionId;
}

export async function selectSession(
  navigation: Locator,
  sessionId: string,
): Promise<void> {
  const row = sessionRow(navigation, sessionId);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "page");
}

/**
 * Starts another Session in `workspaceName` from the sidebar and returns its
 * id once it is selected. Selection moves a beat after the click, so this
 * waits for a different id rather than reading the previous one. CSS only, so
 * it works while a dialog hides the sidebar from role queries.
 */
export async function newSessionIn(
  navigation: Locator,
  workspaceName: string,
): Promise<string> {
  const previous = await selectedSessionId(navigation);
  await navigation
    .locator(`[data-workspace-name=${JSON.stringify(workspaceName)}]`)
    .locator("button")
    .filter({ hasText: workspaceName })
    .first()
    .hover();
  await navigation
    .locator(
      `button[aria-label=${JSON.stringify(`New session in ${workspaceName}`)}]`,
    )
    .click();
  await expect
    .poll(() => selectedSessionId(navigation).catch(() => previous), {
      timeout: 15_000,
    })
    .not.toBe(previous);
  return selectedSessionId(navigation);
}

/** Stop for the running turn; present only while one runs. */
export const stopButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Stop", exact: true });

export const composer = (page: Page): Locator =>
  page.getByPlaceholder(COMPOSER_PLACEHOLDER);

/** Types `text` and sends it, or queues it behind a running turn. */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole("button", { name: /^(Send|Queue) prompt$/ }).click();
}

/** Opens Settings from the sidebar, on `section` when one is named. */
export async function openSettings(
  page: Page,
  section?: string,
): Promise<Locator> {
  await productNavigation(page)
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (section)
    await settings.getByRole("button", { name: section, exact: true }).click();
  return settings;
}
