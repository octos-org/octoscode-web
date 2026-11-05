import { expect, test, type Page } from "@playwright/test";

/**
 * T-0393: what the real-browser audit against Core 6fc12da3 found. A damaged
 * image or PDF says so instead of leaving a blank box, a file Core's reader
 * refuses as too large is named as such and never fetched for preview, and
 * the side panel previews sent files the way the transcript does.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const BROKEN_IMAGE =
  "This image can't be shown. The file may be damaged; download it to check.";

async function openConversation(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/artifact-limits-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  return (JSON.parse(reference!) as string[])[2]!;
}

async function deliver(
  page: Page,
  sessionId: string,
  name: string,
  query: string,
) {
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}&${query}`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator(`[data-attachment="${name}"]`);
  await expect(item).toBeVisible();
  return item;
}

test("a damaged image says so and leaves its row usable", async ({ page }) => {
  const sessionId = await openConversation(page);
  const item = await deliver(page, sessionId, "broken.png", "corrupt=1");
  // The thumbnail drops out instead of holding a blank 4:3 box over the row.
  await expect(item.getByText(BROKEN_IMAGE)).toBeVisible();
  await expect(item.locator("img")).toHaveCount(0);
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = item.locator('[data-artifact-kind="image"]');
  await expect(preview).toContainText(BROKEN_IMAGE);
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(
    item.getByRole("button", { name: "Download broken.png" }),
  ).toBeEnabled();
});

test("a damaged PDF shows its message without an empty page", async ({
  page,
}) => {
  const sessionId = await openConversation(page);
  const item = await deliver(page, sessionId, "broken.pdf", "corrupt=1");
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = item.locator('[data-artifact-kind="pdf"]');
  await expect(preview.getByRole("alert")).toHaveText(
    "The PDF couldn't be rendered. Download it to open it in another app.",
  );
  await expect(preview.locator("canvas")).toHaveCount(0);
});

test("a file Core's reader refuses as too large is named and never fetched for preview", async ({
  page,
}) => {
  const blobReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/files")
      blobReads.push(request.url());
  });
  const sessionId = await openConversation(page);
  const item = await deliver(page, sessionId, "huge.csv", "oversized=1");
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(item.locator('[data-artifact-kind="csv"]')).toContainText(
    "This file is larger than 32 MiB, too large to preview here.",
  );
  await expect(item.getByText("Over 32 MiB")).toBeVisible();
  expect(blobReads).toEqual([]);
  await expect(
    item.getByRole("button", { name: "Download huge.csv" }),
  ).toBeEnabled();
});

test("the side panel previews sent files the way the transcript does", async ({
  page,
}) => {
  const sessionId = await openConversation(page);
  await deliver(page, sessionId, "report.pdf", "valid=1");
  const notes = await deliver(page, sessionId, "notes.md", "valid=1");
  // Only the file name carries the path tooltip, not the whole preview.
  await expect(notes).not.toHaveAttribute("title");
  await expect(notes.locator("[title]").first()).toHaveAttribute(
    "title",
    /\/_build\/notes\.md$/,
  );

  await page.getByRole("button", { name: /^Session panel/ }).click();
  await page.getByRole("tab", { name: /^Outputs/ }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", { name: /^report\.pdf/ }).click();
  const pdf = panel.locator('[data-artifact-kind="pdf"]');
  await expect(pdf.locator("canvas")).toBeVisible();
  await pdf.getByText("Page text").click();
  await expect(pdf.getByText("PDF artifact page one")).toBeVisible();
  await expect(pdf.getByRole("button", { name: "Download" })).toBeEnabled();

  await panel.getByRole("button", { name: "All outputs" }).click();
  await panel.getByRole("button", { name: /^notes\.md/ }).click();
  await expect(
    panel.getByRole("heading", { name: "Markdown artifact" }),
  ).toBeVisible();
});
