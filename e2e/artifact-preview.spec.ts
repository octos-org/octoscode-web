import AxeBuilder from "@axe-core/playwright";
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

test("keeps the artifact header near its original position after preview expands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const sessionId = await openConversation(page);
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=large.csv&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator('[data-attachment="large.csv"]');
  const button = item.getByRole("button", { name: "Preview", exact: true });
  await button.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const before = await button.boundingBox();
  expect(before).not.toBeNull();
  await button.click();
  await expect(
    item.getByRole("cell", { name: "row-1", exact: true }),
  ).toBeVisible();
  const after = await item
    .getByRole("button", { name: "Hide preview", exact: true })
    .boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y).toBeGreaterThan(48);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(100);
});

test("previews and pages PDF artifacts", async ({ page }) => {
  const sessionId = await openConversation(page);

  const pdf = await deliver(page, sessionId, "report.pdf");
  await expect(pdf.preview.locator("canvas")).toBeVisible();
  await pdf.preview.getByText("Page text").click();
  await expect(pdf.preview.getByText("PDF artifact page one")).toBeVisible();
  await pdf.preview.getByRole("button", { name: "Next page" }).click();
  await expect(
    pdf.preview.getByRole("spinbutton", { name: "Page" }),
  ).toHaveValue("2");
  await pdf.preview.getByText("Page text").click();
  await expect(pdf.preview.getByText("PDF artifact page two")).toBeVisible();
});

test("previews and pages large CSV files", async ({ page }) => {
  const sessionId = await openConversation(page);
  const csv = await deliver(page, sessionId, "large.csv");
  await expect(
    csv.preview.getByRole("columnheader", { name: "A", exact: true }),
  ).toBeVisible();
  await expect(csv.preview.getByText("Rows 1–100 of 126")).toBeVisible();
  await csv.preview.getByRole("button", { name: "Next rows" }).click();
  await expect(csv.preview.getByText("row-125", { exact: true })).toBeVisible();
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

test("passes axe around an open artifact preview", async ({ page }) => {
  const sessionId = await openConversation(page);
  await deliver(page, sessionId, "checks.txt");
  const results = await new AxeBuilder({ page })
    .include(`[data-attachment="checks.txt"]`)
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("previews Markdown, code, and text and offers download for unknown types", async ({
  page,
}) => {
  const sessionId = await openConversation(page);
  const markdown = await deliver(page, sessionId, "README.md");
  await expect(
    markdown.preview.getByRole("heading", { name: "Markdown artifact" }),
  ).toBeVisible();
  await expect(markdown.preview.getByText("Formatted safely")).toBeVisible();

  const code = await deliver(page, sessionId, "answer.ts");
  await expect(code.preview).toContainText("export const answer = 42;");

  const text = await deliver(page, sessionId, "checks.txt");
  await expect(text.preview.getByText("All 68 checks passed.")).toBeVisible();

  const unknown = await deliver(page, sessionId, "archive.zip");
  await expect(
    unknown.preview.getByText("This file type doesn't have an inline preview."),
  ).toBeVisible();
  await expect(
    unknown.preview
      .getByRole("button", { name: "Download", exact: true })
      .last(),
  ).toBeEnabled();

  for (const name of ["report.docx", "budget.xlsx", "pilot.pptx"]) {
    const office = await deliver(page, sessionId, name);
    await expect(
      office.preview.getByText(
        "This file type doesn't have an inline preview.",
      ),
    ).toBeVisible();
    await expect(
      office.preview.getByRole("button", { name: "Download", exact: true }),
    ).toBeEnabled();
  }
});

test("verifies a zero file_attached size through the workspace reader", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (
        frame.method === "projection/envelope" &&
        frame.params?.payload?.type === "file_attached"
      ) {
        frame.params.payload.data.size_bytes = 0;
      }
      socket.send(JSON.stringify(frame));
    });
  });
  const sessionId = await openConversation(page);
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=photo.png&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator('[data-attachment="photo.png"]');
  await expect(item.getByRole("img", { name: "photo.png" })).toBeVisible();
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(item.locator('[data-artifact-kind="image"] img')).toBeVisible();
});

test("uses the delivery-time copy when the original source is gone", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (
        request.method === "session/files/read" &&
        !request.params.path.startsWith(".artifacts/delivered/")
      ) {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32004,
              message: "workspace file was not found",
              data: { kind: "workspace_file_not_found" },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const sessionId = await openConversation(page);
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=photo.png&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator('[data-attachment="photo.png"]');
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(item.locator('[data-artifact-kind="image"] img')).toBeVisible();
});

test("previews delivered images without a replayed size event", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (
        frame.method === "projection/envelope" &&
        frame.params?.payload?.type === "file_attached"
      ) {
        return;
      }
      socket.send(JSON.stringify(frame));
    });
  });
  const sessionId = await openConversation(page);
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=photo.png&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const item = page.locator('[data-attachment="photo.png"]');
  await expect(item.getByRole("img", { name: "photo.png" })).toBeVisible();
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(item.locator('[data-artifact-kind="image"] img')).toBeVisible();
});

test("retries an unsupported file with Download after a failed request", async ({
  page,
}) => {
  const sessionId = await openConversation(page);
  let requests = 0;
  await page.route("**/api/files**", (route) => {
    requests += 1;
    return requests === 1 ? route.abort() : route.continue();
  });
  const unknown = await deliver(page, sessionId, "archive.zip");
  const downloadButton = unknown.preview.getByRole("button", {
    name: "Download",
    exact: true,
  });
  await downloadButton.click();
  await expect(unknown.preview.getByRole("alert")).toBeVisible();
  await expect(
    unknown.preview.getByRole("button", { name: "Try again" }),
  ).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await downloadButton.click();
  expect((await downloaded).suggestedFilename()).toBe("archive.zip");
  expect(requests).toBe(2);
});
