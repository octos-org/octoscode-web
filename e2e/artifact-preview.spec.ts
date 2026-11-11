import { expect, test } from "@playwright/test";
import {
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
