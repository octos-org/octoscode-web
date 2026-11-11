import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, openSessionId, startSession } from "./fixture-session";
import { sendPrompt } from "./sessions";

const toggle = (page: Page) =>
  page.getByRole("button", { name: /^Session panel/ });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Session panel" });

test("one file stays selected across diff, output, reload and read failure", async ({
  page,
  request,
}) => {
  const mutations = new Map<string, unknown[]>();
  let readFails = false;
  let deleted = false;
  const previewReads: string[] = [];
  await page.route("**/api/files?**", (route) =>
    readFails
      ? route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "workspace file was not found" }),
        })
      : route.continue(),
  );
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    const methods = new Map<string | number, string>();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      methods.set(frame.id, frame.method);
      if (frame.method === "diff/preview/get")
        previewReads.push(frame.params.preview_id);
      if (readFails && frame.method === "session/files/read") {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32004, message: "workspace file was not found" },
          }),
        );
      } else server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      const mutation = frame.params?.metadata?.file_mutation;
      if (frame.method === "progress/updated" && mutation) {
        mutation.path = "_build/summary.md";
        mutations.set(frame.params.session_id, [mutation]);
      }
      if (methods.get(frame.id) === "session/hydrate" && frame.result) {
        frame.result.file_mutations =
          mutations.get(frame.result.session_id) ?? [];
        if (deleted && frame.result.file_mutations.length)
          frame.result.file_mutations = [
            ...frame.result.file_mutations,
            { path: "_build/summary.md", operation: "delete" },
          ];
      }
      if (methods.get(frame.id) === "diff/preview/get" && frame.result)
        frame.result.preview.files[0].path = "_build/summary.md";
      socket.send(JSON.stringify(frame));
    });
  });
  await startSession(page, `/workspace/panel-linked-${Date.now()}`);
  await sendPrompt(page, "Write the linked report");
  await expect(toggle(page)).toHaveAccessibleName("Session panel, 1 changed");
  const id = await openSessionId(page);
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(id)}&name=summary.md`,
      )
    ).ok(),
  ).toBe(true);
  await toggle(page).click();
  await panel(page)
    .getByRole("tab", { name: /^Changes/ })
    .click();
  await panel(page)
    .getByRole("button", { name: /summary.md/ })
    .click();
  await panel(page)
    .getByRole("tab", { name: /^Outputs/ })
    .click();
  await expect(panel(page).locator("[data-artifact-kind]")).toContainText(
    "fixture summary.md",
  );
  await panel(page).getByRole("tab", { name: "Overview" }).click();
  await expect(panel(page).getByLabel("Selected file")).toContainText(
    "_build/summary.md",
  );
  await panel(page)
    .getByRole("button", { name: "View changes", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: /summary.md/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(panel(page).locator(".diff-file").first()).toContainText(
    "_build/summary.md",
  );
  const before = previewReads.length;
  await page.reload();
  await expect(
    panel(page).getByRole("button", { name: /summary.md/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(panel(page).locator(".diff-file").first()).toContainText(
    "_build/summary.md",
  );
  expect(previewReads.length).toBeGreaterThan(before);
  await panel(page)
    .getByRole("button", { name: "Preview file", exact: true })
    .click();
  await expect(panel(page).locator("[data-artifact-kind]")).toContainText(
    "fixture summary.md",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Selected file"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  readFails = true;
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  // The transcript's preview names the failure without the server's words.
  await expect(panel(page).getByRole("alert")).toContainText(
    "This preview could not be loaded.",
  );
  await expect(panel(page).getByText("fixture summary.md")).toHaveCount(0);
  readFails = false;
  await panel(page)
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(panel(page).locator("[data-artifact-kind]")).toContainText(
    "fixture summary.md",
  );
  deleted = true;
  await page.reload();
  await expect(panel(page)).toContainText("This file was deleted");
  await expect(panel(page).locator("[data-artifact-kind]")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeInViewport();
});

test("Files browses the real workspace tree and previews any file in it", async ({
  page,
}) => {
  // T-0417: the server lists the workspace (dirs AND files); the panel
  // browses folders, pages, and opens a plain workspace file for preview.
  await startSession(page, `/workspace/file-tree-${Date.now()}`);
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Files" }).click();
  const files = panel(page).getByRole("tabpanel");
  await expect(files).toContainText(
    "The workspace as the server lists it, one folder at a time.",
  );
  await expect(files.getByRole("button", { name: "README.md" })).toBeVisible();
  await expect(
    files.getByRole("button", { name: "src", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");

  // Nested browse down to a leaf file, then preview it.
  await files.getByRole("button", { name: "src", exact: true }).click();
  await expect(
    files.getByRole("button", { name: "nested", exact: true }),
  ).toBeVisible();
  await files.getByRole("button", { name: "nested", exact: true }).click();
  await files.getByRole("button", { name: "deep.txt" }).click();
  await expect(panel(page).getByLabel("Selected file")).toContainText(
    "src/nested/deep.txt",
  );
  await expect(panel(page).getByRole("tabpanel")).toContainText(
    "deep tree content",
  );

  // Keyset pagination: docs lists two entries, "Show more" the third.
  await panel(page).getByRole("tab", { name: "Files" }).click();
  await files.getByRole("button", { name: "docs", exact: true }).click();
  await expect(files.getByRole("button", { name: "guide.md" })).toBeVisible();
  await expect(files.getByRole("button", { name: "spec.md" })).toHaveCount(0);
  await files.getByRole("button", { name: "Show more" }).click();
  await expect(files.getByRole("button", { name: "spec.md" })).toBeVisible();

  // The selection and expanded folders survive a reload from server facts.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled({ timeout: 30_000 });
  await panel(page).getByRole("tab", { name: "Files" }).click();
  await expect(
    panel(page).getByRole("button", { name: "deep.txt" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "deep.txt" }),
  ).toHaveAttribute("aria-current", "true");
});
