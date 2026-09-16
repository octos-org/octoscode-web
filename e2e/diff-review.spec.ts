import { expect, test, type Page } from "@playwright/test";

const fixture = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

type PreviewLine = {
  kind: string;
  content: string;
  old_line?: number;
  new_line?: number;
};

async function openReview(page: Page, lines: PreviewLine[]) {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const requests = new Map<string | number, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      requests.set(request.id, request.method);
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (requests.get(response.id) === "diff/preview/get") {
        response.result.preview.title = "Review precise code changes";
        response.result.preview.files = [
          {
            path: "src/settings.ts",
            status: "modified",
            hunks: [{ header: "@@ -1,3 +1,3 @@", lines }],
          },
        ];
      }
      socket.send(JSON.stringify(response));
    });
  });
  await page.goto("/");
  await page.getByLabel("Server origin").fill(fixture);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Server workspace path").fill("/workspace/diff-review");
  await page.getByRole("button", { name: "Start session" }).click();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review precise code changes",
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

const replacement: PreviewLine[] = [
  {
    kind: "context",
    content: "// Preserve every character of the proposed edit",
    old_line: 1,
    new_line: 1,
  },
  {
    kind: "removed",
    content: '\tconst 名称 = "旧值😀"; return false;  ',
    old_line: 2,
  },
  {
    kind: "added",
    content: '\tconst 名称 = "新值🌏"; return true;  ',
    new_line: 2,
  },
  {
    kind: "context",
    content: 'const html = "<img src=x onerror=alert(1)>";',
    old_line: 3,
    new_line: 3,
  },
];

test("diff syntax and word marks preserve inert, selectable text in both themes and on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openReview(page, replacement);
  const codes = dialog.locator(".diff-line > code");
  await expect(dialog.locator(".shiki-color-keyword").first()).toBeVisible();
  expect(await codes.allTextContents()).toEqual(
    replacement.map((line) => line.content),
  );
  expect(await dialog.locator("img, script").count()).toBe(0);
  const changed = dialog.locator('[class*="changedWord"]');
  expect(
    (
      await dialog
        .locator('.diff-removed [class*="changedWord"]')
        .allTextContents()
    ).join(""),
  ).toBe("旧值😀false");
  expect(
    (
      await dialog
        .locator('.diff-added [class*="changedWord"]')
        .allTextContents()
    ).join(""),
  ).toBe("新值🌏true");
  const palettes: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const keyword = dialog.locator(".shiki-color-keyword").first();
    const color = await keyword.evaluate(
      (element) => getComputedStyle(element).color,
    );
    const foreground = await codes
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    expect(color).not.toBe(foreground);
    palettes.push(color);
    expect(
      await changed
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await page.setViewportSize({
      width: colorScheme === "dark" ? 320 : 1280,
      height: colorScheme === "dark" ? 480 : 800,
    });
    const close = await dialog
      .getByRole("button", { name: "Close review" })
      .boundingBox();
    expect(close!.x + close!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.screenshot({
      path: test.info().outputPath(`diff-review-${colorScheme}.png`),
    });
  }
  expect(palettes[0]).not.toBe(palettes[1]);
  const selected = await codes.nth(2).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toBe(replacement[2]!.content);
  const hunk = dialog.locator(".diff-hunk");
  await hunk.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await hunk.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
    0,
  );
  await dialog.getByRole("button", { name: "Close review" }).click();
  await expect(
    page.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("large previews remain complete and use the plain-text performance fallback", async ({
  page,
}) => {
  const lines: PreviewLine[] = Array.from({ length: 500 }, (_, index) => ({
    kind: "added",
    content: `const value${index} = ${index};`,
    new_line: index + 1,
  }));
  const dialog = await openReview(page, lines);
  await expect(
    dialog.getByText(
      "Large preview shown as plain text. All lines are included.",
    ),
  ).toBeVisible();
  expect(await dialog.locator(".diff-line > code").allTextContents()).toEqual(
    lines.map((line) => line.content),
  );
  await expect(dialog.locator('[class*="shiki-color"]')).toHaveCount(0);
  await dialog.locator("summary").click();
  await expect(dialog.locator("details")).not.toHaveAttribute("open");
  await dialog.getByRole("button", { name: "Close review" }).click();
  await expect(dialog).toBeHidden();
});

test("a missing optional diff grammar retains original text and word marks", async ({
  page,
}) => {
  const errors: string[] = [];
  let rejected = false;
  page.on("pageerror", (error) => errors.push(error.message));
  // The optional TypeScript grammar chunk. A dev server serves it as
  // @shikijs_langs_typescript.js; this repo's e2e runs `vite preview`, which
  // serves the built /assets/typescript-<hash>.js instead.
  await page.route(
    /\/(?:@shikijs_langs_)?typescript(?:\.js|-[A-Za-z0-9_-]+\.js)(\?|$)/,
    async (route) => {
      rejected = true;
      await route.abort();
    },
  );
  const dialog = await openReview(page, replacement);
  expect(rejected).toBe(true);
  expect(await dialog.locator(".diff-line > code").allTextContents()).toEqual(
    replacement.map((line) => line.content),
  );
  expect(
    await dialog.locator('[class*="changedWord"]').count(),
  ).toBeGreaterThan(0);
  await expect(dialog.locator(".shiki-color-keyword")).toHaveCount(0);
  expect(errors).toEqual([]);
});
