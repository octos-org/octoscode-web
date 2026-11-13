import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FIXTURE_ORIGIN,
  openSessionId,
  previewDelivery,
  startSession,
} from "./fixture-session";

// T-0568: scanned pages from e2e/fixtures/scanned/make.py, read in the browser.
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/scanned/${name}`, import.meta.url));

async function openScan(page: Page, sessionId: string, name: string) {
  const { preview } = await previewDelivery(
    page,
    sessionId,
    name,
    fixture(name),
  );
  const canvas = preview.getByRole("img", { name: `Page 1 of ${name}` });
  // Black-and-white (CCITT) and JPEG 2000 images need pdf.js's decoders.
  await expect
    .poll(() =>
      canvas.evaluate((node: HTMLCanvasElement) => {
        const { data } = node
          .getContext("2d")!
          .getImageData(0, 0, node.width, node.height);
        let dark = 0;
        for (let index = 0; index < data.length; index += 4)
          if (data[index]! < 128) dark += 1;
        return dark / (data.length / 4);
      }),
    )
    .toBeGreaterThan(0.002);
  await preview.getByText("Page text", { exact: true }).click();
  await expect(preview.getByText(/This page has no text layer/)).toBeVisible();
  return preview;
}

async function recognize(preview: Locator, language = "English") {
  await preview.getByLabel("Language").selectOption({ label: language });
  await preview
    .getByRole("button", { name: "Recognize text on page 1" })
    .click();
}

test("renders black-and-white and JPEG 2000 scans and reads them in the browser", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await startSession(page, `/workspace/scanned-pdf-${Date.now()}`);
  const sessionId = await openSessionId(page);
  await openScan(page, sessionId, "scan-jpx.pdf");

  const english = await openScan(page, sessionId, "scan-en.pdf");
  await recognize(english);
  await expect(
    english.getByText(
      /Text recognized on page 1 in this browser \(\d+% confidence\)/,
    ),
  ).toBeVisible();
  await expect(english.locator("pre").last()).toContainText(
    "Revenue for the quarter was 184,300 dollars, up 12.4 percent.",
  );

  const chinese = await openScan(page, sessionId, "scan-zh.pdf");
  await recognize(chinese, "Chinese and English");
  await expect(chinese.locator("pre").last()).toContainText(
    "宁波仓库十月共发出三千九百一十二个订单",
  );

  const photo = await openScan(page, sessionId, "photo.pdf");
  await recognize(photo);
  await expect(
    photo.getByText(/No reliable text was recognized on page 1/),
  ).toBeVisible();

  // Only the app and the fixture Core; no PDF, image or text goes elsewhere.
  const origins = [FIXTURE_ORIGIN, new URL(page.url()).origin];
  expect(
    requests.filter((url) => !origins.includes(new URL(url).origin)),
  ).toEqual([]);
  const stored = await page.evaluate(async () => ({
    caches: await caches.keys(),
    databases: await indexedDB.databases(),
    text: JSON.stringify({ ...localStorage, ...sessionStorage }),
  }));
  expect(stored.caches).toEqual([]);
  expect(stored.databases).toEqual([]);
  expect(stored.text).not.toMatch(/Ningbo|宁波/);
});
