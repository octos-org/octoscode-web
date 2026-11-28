import { expect, test } from "@playwright/test";
import {
  FIXTURE_ORIGIN,
  openSessionId,
  previewDelivery,
  sessionPanelToggle,
  startSession,
} from "./fixture-session";
import { sendPrompt } from "./sessions";

test("keeps a structured write artifact and its preview after reload", async ({
  page,
}) => {
  await startSession(page, `/workspace/artifact-preview-${Date.now()}`);
  await sendPrompt(page, "Write an artifact fixture");
  const item = page.locator('[data-attachment="report.md"]');
  await expect(item).toBeVisible();
  await page.reload();
  await expect(item).toBeVisible();
  await item
    .getByRole("button", { name: "Preview report.md", exact: true })
    .click();
  const preview = item
    .locator(".artifact-preview, [data-artifact-kind]")
    .last();
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
  await huge
    .getByRole("button", { name: "Preview huge.csv", exact: true })
    .click();
  await expect(huge.locator('[data-artifact-kind="csv"]')).toContainText(
    "This file is larger than 32 MiB, too large to preview here.",
  );
  expect(fileReads).toEqual([]);
  const download = page.waitForEvent("download");
  await huge.getByRole("button", { name: "Download huge.csv" }).click();
  expect((await download).suggestedFilename()).toBe("huge.csv");

  // A file the turn wrote and then sent shows once, where it was sent, and
  // counts once in the summary and the panel, which keeps both sources.
  await sendPrompt(page, "Write and send an artifact fixture");
  const outputs = page.getByText("Output files: weekly.md", { exact: true });
  await expect(outputs).toBeVisible();
  await expect(page.locator('[data-attachment="weekly.md"]')).toHaveCount(1);
  await sessionPanelToggle(page).click();
  const tab = page.getByRole("tab", { name: /^Outputs/ });
  await tab.click();
  await expect(tab).toHaveAccessibleName(/^Outputs\s*,\s*3$/);
  await expect(page.getByText("Also written in this folder")).toBeVisible();
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
  // The fixtures' scripts mark the document if they ever run.
  await expect(htmlFrame.locator("[data-script-executed]")).toHaveCount(0);
  await expect(
    htmlFrame.locator("body").locator("a, form, meta, link, base"),
  ).toHaveCount(0);
  await htmlFrame.getByText("Inert artifact link").click();
  await expect(page).toHaveURL(/\?s=/);

  const svg = await previewDelivery(page, sessionId, "diagram.svg");
  const svgFrame = svg.preview.frameLocator("iframe");
  await expect(svgFrame.getByText("Safe SVG artifact")).toBeVisible();
  await expect(svgFrame.locator("[data-script-executed]")).toHaveCount(0);
  await expect(svgFrame.locator("a")).toHaveCount(0);
  await svgFrame.getByText("Safe SVG artifact").click();
  await page.waitForTimeout(100);
  expect(leaks).toEqual([]);
});
