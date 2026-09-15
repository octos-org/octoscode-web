import { expect, test, type Page } from "@playwright/test";

const fixture = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(fixture);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/final-reading");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Message Octos" }),
  ).toBeVisible();
}

test("code copy reports rejected and missing clipboard APIs without losing the code", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard blocked");
        },
      },
    });
  });
  await start(page);
  const copy = page.getByRole("button", { name: "Copy code block" });
  await copy.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not copy" }),
  ).toBeVisible();
  await expect(page.locator(".md-code-block pre")).toContainText(
    "return value * 2;",
  );
  expect(errors).toEqual([]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await copy.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not copy" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    }),
  );
  await copy.click();
  await expect(copy).toHaveText("Copied");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not copy" }),
  ).toHaveCount(0);
});

test("sidebar native buttons keep Enter behavior and search Escape restores its trigger", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("treeitem", { name: "final-reading", exact: true })
    .hover();
  const add = page.getByRole("button", {
    name: "New session in final-reading",
    exact: true,
  });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tree").getByRole("treeitem", { name: /^Session / }),
  ).toHaveCount(2);
  const searchButton = page.getByRole("button", {
    name: "Search sessions",
    exact: true,
  });
  await searchButton.click();
  const search = page.getByRole("textbox", {
    name: "Search sessions",
    exact: true,
  });
  await search.fill("final-reading");
  await expect(
    page
      .getByRole("tree", { name: "Session search results" })
      .getByRole("treeitem"),
  ).toHaveCount(2);
  await search.press("Escape");
  await expect(searchButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Session view options" }),
  ).toBeFocused();
});

test("tree focus follows a collapsed parent and no longer references a removed search row", async ({
  page,
}) => {
  await start(page);
  const tree = page.getByRole("tree", { name: "Workspaces and sessions" });
  await tree.focus();
  await tree.press("Home");
  await tree.press("ArrowRight");
  const child = tree.getByRole("treeitem").last();
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await child.getAttribute("id")) ?? "",
  );
  await tree.press("ArrowLeft");
  await tree.press("ArrowLeft");
  await expect(tree.getByRole("treeitem")).toHaveCount(1);
  await expect(tree).toHaveAttribute(
    "aria-activedescendant",
    (await tree.getByRole("treeitem").getAttribute("id")) ?? "",
  );
  await tree.press("ArrowRight");
  await page
    .getByRole("button", { name: "Search sessions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search sessions", exact: true })
    .fill("final-reading");
  const results = page.getByRole("tree", { name: "Session search results" });
  await results.focus();
  await results.press("Home");
  await page.getByRole("button", { name: "Close search" }).click();
  const activeId = await tree.getAttribute("aria-activedescendant");
  expect(
    await page.evaluate(
      (id) => !id || Boolean(document.getElementById(id)),
      activeId,
    ),
  ).toBe(true);
});

test("360-message history stays readable while new output streams and unsafe Markdown stays inert", async ({
  page,
}) => {
  const errors: string[] = [];
  const unwanted: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("example.invalid")) unwanted.push(request.url());
  });
  let emit: ((type: string, data: Record<string, unknown>) => void) | undefined;
  const wideText = "LongUnbrokenCode".repeat(80);
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const requests = new Map<string | number, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      requests.set(request.id, request.method);
      if (request.method === "turn/start") {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { accepted: true },
          }),
        );
        let seq = 0;
        emit = (type, data) =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "projection/envelope",
              params: {
                session_id: request.params.session_id,
                turn_id: request.params.turn_id,
                thread_id: "reading-final",
                seq: ++seq,
                cursor: { stream: request.params.session_id, seq: 500 + seq },
                payload: { type, data },
              },
            }),
          );
      } else server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (requests.get(response.id) === "session/hydrate") {
        response.result.messages = Array.from({ length: 360 }, (_, index) => ({
          seq: index + 1,
          role: index % 2 ? "assistant" : "user",
          turn_id: `history-${Math.floor(index / 2)}`,
          persisted_at: "2026-09-15T00:00:00Z",
          media: [],
          content:
            index === 359
              ? [
                  "## Final history entry",
                  "",
                  `[safe link](https://example.com/) [unsafe link](javascript:alert(1))`,
                  "![inert remote image](https://example.invalid/leak.png)",
                  "<script>window.readingAuditExecuted = true</script>",
                  "",
                  "| Header | Header | Header | Header |",
                  "| --- | --- | --- | --- |",
                  `| ${wideText} | next | third | last |`,
                  "",
                  "```text",
                  wideText,
                  "```",
                ].join("\n")
              : `History ${index + 1}: ${"A stable paragraph for sustained reading. ".repeat(4)}`,
        }));
        response.result.turns = Array.from({ length: 180 }, (_, index) => ({
          turn_id: `history-${index}`,
          state: "completed",
        }));
        socket.send(JSON.stringify(response));
      } else socket.send(message);
    });
  });
  await start(page);
  await expect(page.locator(".timeline-entry")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Show 100 earlier messages" })
    .scrollIntoViewIfNeeded();
  const anchorText = await page
    .locator(".timeline-entry")
    .first()
    .locator("pre")
    .textContent();
  const anchor = page.getByText(anchorText!, { exact: true });
  const anchorTop = (await anchor.boundingBox())!.y;
  await page.getByRole("button", { name: "Show 100 earlier messages" }).click();
  await expect(page.locator(".timeline-entry")).toHaveCount(300);
  expect(Math.abs((await anchor.boundingBox())!.y - anchorTop)).toBeLessThan(4);
  await page.getByRole("button", { name: "Show 60 earlier messages" }).click();
  await expect(page.locator(".timeline-entry")).toHaveCount(360);
  await expect(page.locator(".timeline-entry").first()).toContainText(
    "History 1:",
  );
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(
    page.getByRole("heading", { name: "Final history entry" }),
  ).toBeVisible();
  expect(unwanted).toEqual([]);
  expect(await page.evaluate(() => "readingAuditExecuted" in window)).toBe(
    false,
  );
  await expect(
    page.getByRole("link", { name: "unsafe link", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "safe link", exact: true }),
  ).toHaveAttribute("rel", "noreferrer noopener");
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("Continue from history");
  await composer.press("Enter");
  await expect.poll(() => Boolean(emit)).toBe(true);
  const region = page.getByRole("region", {
    name: "Conversation",
    exact: true,
  });
  await region.hover();
  await page.mouse.wheel(0, -1800);
  await expect(
    page.getByRole("button", { name: "Back to latest" }),
  ).toBeVisible();
  const before = await region.evaluate((el) => el.scrollTop);
  for (let index = 0; index < 25; index++)
    emit!("assistant_delta", { text: `Stream chunk ${index}. ` });
  emit!("turn_terminal", { outcome: "completed" });
  await expect(
    page.getByText("Stream chunk 24.", { exact: false }),
  ).toBeAttached();
  expect(
    Math.abs((await region.evaluate((el) => el.scrollTop)) - before),
  ).toBeLessThan(4);
  await page.getByRole("button", { name: "Back to latest" }).click();
  for (const [width, height, theme] of [
    [320, 480, "dark"],
    [640, 360, "light"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.locator(".md-code-block").scrollIntoViewIfNeeded();
    const bounds = await page.locator(".md-code-block").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const code = page.locator(".md-code-block pre");
    await code.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    expect(await code.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const table = page.locator(".md-table-scroll");
    await table.scrollIntoViewIfNeeded();
    await table.focus();
    await table.press("End");
    const tableBounds = await table.boundingBox();
    expect(tableBounds!.x + tableBounds!.width).toBeLessThanOrEqual(width);
    if (width === 320)
      expect(
        await table.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`history-${width}-${theme}.png`),
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("treeitem", { name: "final-reading", exact: true })
    .hover();
  await page
    .getByRole("button", { name: "New session in final-reading", exact: true })
    .click();
  // Both sessions deliberately reuse hydrate fallback IDs. The session key,
  // rather than a message ID coincidence, resets the initial rendering window.
  await expect(page.locator(".timeline-entry")).toHaveCount(200);
  await expect(
    page.getByRole("button", { name: "Show 100 earlier messages" }),
  ).toBeAttached();
  expect(errors).toEqual([]);
});

test("Diff review keeps long headings and file content inside the narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  const title = "AnUnbrokenPreviewTitle".repeat(20);
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
        response.result.preview.title = title;
        response.result.preview.files[0].path =
          "src/" + "NestedDirectory/".repeat(25) + "index.ts";
        response.result.preview.files[0].hunks[0].lines[0].content =
          "const long = '" + "content".repeat(100) + "';";
      }
      socket.send(JSON.stringify(response));
    });
  });
  await start(page);
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await composer.fill("Review the final reading fixture");
  await composer.press("Enter");
  const trigger = page.getByRole("button", {
    name: "Review changes",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close review" });
  const box = await close.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const summary = dialog.locator("summary").first();
  await summary.click();
  await expect(summary.locator("..")).not.toHaveAttribute("open");
  await summary.press("Enter");
  await expect(summary.locator("..")).toHaveAttribute("open");
  const lines = dialog.locator(".diff-hunk").first();
  await lines.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await lines.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({
    path: test.info().outputPath("diff-review-320.png"),
  });
  await close.click();
  await expect(trigger).toBeFocused();
});

test("a missing optional syntax grammar leaves readable and copyable plain code", async ({
  page,
}) => {
  const errors: string[] = [];
  let rejected = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/shikijs_langs_python.*\.js/, async (route) => {
    rejected = true;
    await route.abort("failed");
  });
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
      if (requests.get(response.id) === "session/hydrate") {
        response.result.messages[1].content =
          "```python\nprint('still readable')\n```";
      }
      socket.send(JSON.stringify(response));
    });
  });
  await start(page);
  await expect.poll(() => rejected).toBe(true);
  await expect(page.locator(".md-code-plain")).toContainText(
    "print('still readable')",
  );
  await expect(
    page.getByRole("button", { name: "Copy code block" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("task output and artifact controls fit a short phone viewport with long titles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  const title = `Validate-${"long-title-".repeat(30)}`;
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
      if (requests.get(response.id) === "task/list")
        response.result.tasks[0].summary = title;
      if (requests.get(response.id) === "task/output/read")
        response.result.text = "Long output\n".repeat(200);
      socket.send(JSON.stringify(response));
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Trajectory", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close task output" });
  const bounds = await close.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(480);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await dialog
    .getByRole("button", { name: "Check report reports/check.txt" })
    .click();
  const more = dialog.getByRole("button", { name: "Load more artifact" });
  await more.scrollIntoViewIfNeeded();
  const moreBounds = await more.boundingBox();
  expect(moreBounds!.y + moreBounds!.height).toBeLessThanOrEqual(480);
  await more.click();
  await expect(dialog).toContainText("build completed");
  expect((await close.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({
    path: test.info().outputPath("task-output-320.png"),
  });
  await close.click();
  await expect(dialog).toBeHidden();
});
