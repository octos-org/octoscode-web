import { expect, test, type Page } from "@playwright/test";
import {
  connectAndStartWorkspace,
  FIXTURE_ORIGIN,
  openSessionId,
} from "./fixture-session";
import { sendPrompt } from "./sessions";
import { sendError } from "./wire";

async function openConversation(page: Page, cwd: string): Promise<string> {
  await connectAndStartWorkspace(page, cwd);
  await sendPrompt(page, "Show the Markdown transcript surface");
  await expect(
    page.locator(".markdown-body").getByText("Raw HTML stays inert:"),
  ).toBeVisible();
  return openSessionId(page);
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

  // Hydrate after reload restores both deliveries. With the original source
  // gone and no size recorded at delivery, the image preview is sized from
  // its delivery-time copy under .artifacts/delivered/.
  const deliveredReads: string[] = [];
  const withoutSizes = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(withoutSizes);
    if (value === null || typeof value !== "object") return;
    const record = value as { type?: unknown; data?: { size_bytes?: number } };
    if (record.type === "file_attached" && record.data)
      record.data.size_bytes = 0;
    Object.values(record).forEach(withoutSizes);
  };
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "session/files/read") {
        if (!frame.params.path.startsWith(".artifacts/delivered/")) {
          sendError(socket, frame.id, {
            code: -32004,
            message: "workspace file was not found",
            data: { kind: "workspace_file_not_found" },
          });
          return;
        }
        deliveredReads.push(frame.params.path);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      withoutSizes(frame);
      socket.send(JSON.stringify(frame));
    });
  });
  await page.reload();
  const reloaded = page.locator('[data-attachment="p20-art.png"]');
  await reloaded.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    reloaded.locator('[data-artifact-kind="image"] img'),
  ).toBeVisible();
  expect(deliveredReads).toContainEqual(
    expect.stringMatching(
      /^\.artifacts\/delivered\/[0-9a-f]{32}\/p20-art\.png$/,
    ),
  );
  await expect(
    page.locator('[data-attachment="Single-Panel-Pilot-3p.pptx"]'),
  ).toBeVisible();
});
