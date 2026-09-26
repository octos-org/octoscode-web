import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function openConversation(page: Page, cwd: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill("Show the Markdown transcript surface");
  await composer.press("Enter");
  await expect(
    page.locator(".markdown-body").getByText("Raw HTML stays inert:"),
  ).toBeVisible();
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  return (JSON.parse(reference!) as string[])[2]!;
}

test("shows files the agent delivers, previews images, downloads them, and keeps them on reload", async ({
  page,
  request,
}) => {
  const sessionId = await openConversation(
    page,
    `/workspace/delivered-files-${Date.now()}`,
  );
  const deliver = async (name: string, caption = "") => {
    const response = await request.post(
      `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}&caption=${encodeURIComponent(caption)}`,
    );
    expect(response.ok()).toBe(true);
  };

  // A caption-less image delivery (most `send_file` calls) still shows up.
  await deliver("p20-art.png");
  const image = page.locator('[data-attachment="p20-art.png"]');
  await expect(image).toBeVisible();
  await expect(image.getByRole("img", { name: "p20-art.png" })).toBeVisible();
  await expect
    .poll(() =>
      image
        .getByRole("img")
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(1);

  await deliver("Single-Panel-Pilot-3p.pptx", "The pilot deck");
  await expect(page.getByText("The pilot deck")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Single-Panel-Pilot-3p.pptx" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Single-Panel-Pilot-3p.pptx");
  const saved = await download.path();
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(saved!, "utf8")).toBe(
    "fixture Single-Panel-Pilot-3p.pptx",
  );
  // The server path is never shown as message text.
  await expect(page.getByText("Attachment:")).toHaveCount(0);

  // Hydrate after reload restores both deliveries.
  await page.reload();
  await expect(page.locator('[data-attachment="p20-art.png"]')).toBeVisible();
  await expect(
    page.locator('[data-attachment="Single-Panel-Pilot-3p.pptx"]'),
  ).toBeVisible();
});

test("says a file could not be loaded instead of failing silently", async ({
  page,
  request,
}) => {
  const sessionId = await openConversation(
    page,
    `/workspace/delivered-missing-${Date.now()}`,
  );
  // Deliver, then make the file unreadable: the fixture serves only paths it
  // knows, like Core refusing a path outside the tenant root.
  await page.route("**/api/files**", (route) =>
    route.fulfill({ status: 403, body: "access denied" }),
  );
  await request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=gone.png`,
  );
  const item = page.locator('[data-attachment="gone.png"]');
  await expect(item).toBeVisible();
  await expect(item.getByRole("status")).toHaveText(
    "This file could not be loaded.",
  );
});
