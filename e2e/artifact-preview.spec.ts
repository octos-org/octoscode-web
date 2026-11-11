import { expect, test } from "@playwright/test";
import {
  FIXTURE_ORIGIN,
  openSessionId,
  previewDelivery,
  startSession,
} from "./fixture-session";

test("keeps a structured write artifact and its preview after reload", async ({
  page,
}) => {
  await startSession(page, `/workspace/artifact-preview-${Date.now()}`);
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

  // A file Core's reader refuses as too large is named as such, never
  // fetched for preview, and still downloads (T-0393, T-0569 size cap).
  const fileReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/files")
      fileReads.push(request.url());
  });
  const sessionId = await openSessionId(page);
  const delivered = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=huge.csv&oversized=1`,
  );
  expect(delivered.ok()).toBe(true);
  const huge = page.locator('[data-attachment="huge.csv"]');
  await huge.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(huge.locator('[data-artifact-kind="csv"]')).toContainText(
    "This file is larger than 32 MiB, too large to preview here.",
  );
  expect(fileReads).toEqual([]);
  const download = page.waitForEvent("download");
  await huge.getByRole("button", { name: "Download huge.csv" }).click();
  expect((await download).suggestedFilename()).toBe("huge.csv");
});

test("keeps HTML and SVG scripts and network access inert", async ({
  page,
}) => {
  await startSession(page, `/workspace/artifact-preview-${Date.now()}`);
  const sessionId = await openSessionId(page);
  const leaks: string[] = [];
  await page.route("**/__test__/*-leak", (route) => {
    leaks.push(route.request().url());
    return route.abort();
  });

  const html = await previewDelivery(page, sessionId, "index.html");
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

  const svg = await previewDelivery(page, sessionId, "diagram.svg");
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
