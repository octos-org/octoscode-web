import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";

const start = (page: Page) =>
  startSession(page, `/workspace/w2-layout-${Date.now()}`);

async function expectStableHeader(page: Page, height: number) {
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? -1))
    .toBe(0);
  const header = await page
    .locator("section.conversation:not([hidden]) > header.conversation-header")
    .boundingBox();
  expect(header).not.toBeNull();
  expect(header!.y).toBeGreaterThanOrEqual(0);
  expect(header!.y + header!.height).toBeLessThanOrEqual(height);
}

async function expectMobileButtonsSeparate(page: Page, width: number) {
  const rects = await page
    .locator(
      "section.conversation:not([hidden]) > header.conversation-header button:visible",
    )
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }),
    );
  expect(rects.length).toBeGreaterThan(0);
  for (const rect of rects) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    expect(rect.bottom).toBeLessThanOrEqual(844);
  }
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      const a = rects[left]!;
      const b = rects[right]!;
      const separate =
        a.right <= b.left ||
        b.right <= a.left ||
        a.bottom <= b.top ||
        b.bottom <= a.top;
      expect(separate, `buttons ${left} and ${right} overlap`).toBe(true);
    }
  }
}

test("approval keeps the document and header stable at 390px", async ({
  page,
}) => {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request approval fixture");
  await input.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Run product checks?" }),
  ).toBeVisible();
  await expectStableHeader(page, viewport.height);
  await expectMobileButtonsSeparate(page, viewport.width);
});
