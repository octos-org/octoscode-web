import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/cross-browser");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

/**
 * The transcript must have content before searching: an empty timeline
 * renders the empty-state hero, and a zero-match search on it asserts
 * nothing about highlighting. Running one turn earns real text
 * ("Completed with pnpm check") to search for.
 */
async function earnTranscript(page: Page) {
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Show the Markdown transcript surface");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Durable coding transcript" }),
  ).toBeVisible();
}

test("⌘F opens the search bar over an open session and matches transcript text", async ({
  page,
}) => {
  await connect(page);
  await earnTranscript(page);
  // The regression case for #197: the composer holds focus after a turn.
  await page.getByRole("textbox", { name: "Message Octos" }).click();
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Search conversation")).toBeVisible();
  await page.getByPlaceholder("Search conversation").fill("Durable");
  // The heading is a live text node near the top — count must be ≥ 1.
  await expect(
    page.locator("[role='search'] [class*='count']"),
  ).not.toContainText("0");
});
