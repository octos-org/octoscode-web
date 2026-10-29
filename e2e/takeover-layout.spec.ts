import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill(`/workspace/w2-layout-${Date.now()}`);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

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

for (const viewport of VIEWPORTS) {
  for (const kind of ["approval", "question"] as const) {
    test(`${kind} keeps the document and header stable at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await start(page);
      const input = page.getByRole("textbox", { name: "Message Octos" });
      await input.fill(
        kind === "approval"
          ? "Request approval fixture"
          : "Request question fixture",
      );
      await input.press("Enter");
      await expect(
        page.getByRole("dialog", {
          name:
            kind === "approval"
              ? "Run product checks?"
              : "Choose verification depth",
        }),
      ).toBeVisible();
      await expectStableHeader(page, viewport.height);
      if (viewport.width === 390) {
        await expectMobileButtonsSeparate(page, viewport.width);
      }
      if (
        (kind === "approval" && viewport.width === 1440) ||
        (kind === "question" && viewport.width === 390)
      ) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      }
    });
  }
}
