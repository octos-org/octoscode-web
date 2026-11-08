import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function openConversation(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/artifact-preview-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  return (JSON.parse(reference!) as string[])[2]!;
}

async function deliver(page: Page, sessionId: string, name: string) {
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator(`[data-attachment="${name}"]`);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = item
    .locator(".artifact-preview, [data-artifact-kind]")
    .last();
  await expect(preview).toBeVisible();
  return { item, preview };
}

test("keeps a structured write artifact and its preview after reload", async ({
  page,
}) => {
  await openConversation(page);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Write an artifact fixture");
  await composer.press("Enter");
  const item = page.locator('[data-attachment="report.md"]');
  await expect(item).toBeVisible();
  await page.reload();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = item
    .locator(".artifact-preview, [data-artifact-kind]")
    .last();
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Markdown artifact")).toBeVisible();
  await expect(preview.getByText("Formatted safely")).toBeVisible();
});

test("keeps HTML and SVG scripts and network access inert", async ({
  page,
}) => {
  const sessionId = await openConversation(page);
  const leaks: string[] = [];
  await page.route("**/__test__/*-leak", (route) => {
    leaks.push(route.request().url());
    return route.abort();
  });

  const html = await deliver(page, sessionId, "index.html");
  const htmlFrame = html.preview.frameLocator("iframe");
  await expect(
    htmlFrame.getByRole("heading", { name: "Safe HTML artifact" }),
  ).toBeVisible();
  await expect(htmlFrame.locator("body")).not.toHaveAttribute(
    "data-script-executed",
    "yes",
  );
  await expect(
    htmlFrame.locator("body").locator("a, form, meta, link, base"),
  ).toHaveCount(0);
  await htmlFrame.getByText("Inert artifact link").click();
  await expect(page).toHaveURL(/\?s=/);

  const svg = await deliver(page, sessionId, "diagram.svg");
  await expect(
    svg.preview.frameLocator("iframe").getByText("Safe SVG artifact"),
  ).toBeVisible();
  await expect(
    svg.preview.frameLocator("iframe").locator("svg"),
  ).not.toHaveAttribute("data-script-executed", "yes");
  await expect(svg.preview.frameLocator("iframe").locator("a")).toHaveCount(0);
  await svg.preview
    .frameLocator("iframe")
    .getByText("Safe SVG artifact")
    .click();
  await page.waitForTimeout(100);
  expect(leaks).toEqual([]);
});
