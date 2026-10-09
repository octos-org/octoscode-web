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

test("Enter walks matches and the count tracks the active index", async ({
  page,
}) => {
  await connect(page);
  await earnTranscript(page);
  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Search conversation").fill("e");
  const count = page.locator("[role='search'] [class*='count']");
  await expect(count).not.toContainText("0");
  const before = await count.textContent();
  await page.getByPlaceholder("Search conversation").press("Enter");
  await expect(count).not.toHaveText(before ?? "");
  await page.getByPlaceholder("Search conversation").press("Shift+Enter");
  await expect(count).toHaveText(before ?? "");
});

test("Escape clears the query first and closes the bar second", async ({
  page,
}) => {
  await connect(page);
  await earnTranscript(page);
  await page.keyboard.press("Control+f");
  const searchbox = page.getByPlaceholder("Search conversation");
  await expect(searchbox).toBeVisible();
  await searchbox.fill("transcript");
  await searchbox.press("Escape");
  // Stage 1: the bar stays, the query is gone.
  await expect(searchbox).toBeVisible();
  await expect(searchbox).toHaveValue("");
  // Stage 2: an empty query closes the bar and restores the composer.
  await searchbox.press("Escape");
  await expect(searchbox).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeFocused();
});

test("the search bar is reachable on a session with an empty timeline", async ({
  page,
}) => {
  // Regression for #197: ⌘F on the empty-state hero silently did nothing.
  await connect(page);
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Search conversation")).toBeVisible();
  await page.getByPlaceholder("Search conversation").fill("anything");
  await expect(page.locator("[role='search'] [class*='count']")).toContainText(
    "0",
  );
});

test("⌘F from the Trajectory tab swings back to Chat", async ({ page }) => {
  // Regression for the chat-scope gap: ⌘F on Trajectory did nothing.
  await connect(page);
  await earnTranscript(page);
  await page.getByRole("button", { name: "Trajectory" }).click();
  await expect(page.getByRole("button", { name: "Chat" })).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Search conversation")).toBeVisible();
  // The swing landed on the tab that owns the search surface.
  await expect(page.getByRole("button", { name: "Chat" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
