import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(
  page: Page,
  workspace: string,
  token = "tab-scoped-e2e-token",
) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  const manual = page.getByRole("button", { name: "Enter path manually" });
  const pathInput = page.getByLabel("Server workspace path");
  await expect(manual.or(pathInput).first()).toBeVisible();
  if (await manual.isVisible().catch(() => false)) await manual.click();
  await pathInput.fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill(text);
  await composer.press("Enter");
}

const toggle = (page: Page) =>
  page.getByRole("button", { name: /^Session panel/ });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Session panel" });

async function createWorkspace(page: Page, path: string) {
  await page
    .locator("aside")
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  const manual = picker.getByRole("button", { name: "Enter path manually" });
  const pathInput = picker.getByLabel("Server workspace path");
  await expect(manual.or(pathInput).first()).toBeVisible();
  if (await manual.isVisible().catch(() => false)) await manual.click();
  await pathInput.fill(path);
  await picker.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.locator("main").getByText(path, { exact: true }).first(),
  ).toBeVisible();
}

test("the panel sits beside the chat and remembers its tab and width", async ({
  page,
}) => {
  await start(page, "/workspace/session-panel");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page)).toHaveCount(0);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  const overview = panel(page).getByRole("tab", { name: "Overview" });
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByRole("tabpanel")).toContainText("No plan yet");

  // Tabs move with the arrow keys; the selection follows focus.
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  const files = panel(page).getByRole("tab", { name: "Files" });
  await expect(files).toBeFocused();
  await expect(files).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(
    panel(page).getByRole("tab", { name: /^Outputs/ }),
  ).toHaveAttribute("aria-selected", "true");

  // The edge resizes from the keyboard; leftwards widens the panel.
  const edge = panel(page).getByRole("separator", {
    name: "Resize session panel",
  });
  await edge.focus();
  for (let step = 0; step < 3; step += 1)
    await page.keyboard.press("ArrowLeft");
  await expect(edge).toHaveAttribute("aria-valuenow", "428");
  await expect
    .poll(async () => Math.round((await panel(page).boundingBox())!.width))
    .toBe(428);
  // The conversation keeps its room beside the panel.
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeInViewport();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);

  await page.reload();
  await expect(composer).toBeEnabled();
  await expect(
    panel(page).getByRole("tab", { name: /^Outputs/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel(page).getByRole("separator", { name: "Resize session panel" }),
  ).toHaveAttribute("aria-valuenow", "428");

  await panel(page)
    .getByRole("button", { name: "Close session panel" })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await page.reload();
  await expect(composer).toBeEnabled();
  await expect(panel(page)).toHaveCount(0);
});

async function holdTerminal(request: APIRequestContext) {
  expect(
    (
      await request.post(`${FIXTURE_ORIGIN}/__test__/terminal/hold-next`)
    ).status(),
  ).toBe(204);
}

async function releaseTerminal(request: APIRequestContext) {
  // The fixture parks the terminal when the turn's tail fires; wait for it.
  let held: { session_id: string }[] = [];
  await expect
    .poll(async () => {
      ({ held } = (await (
        await request.get(`${FIXTURE_ORIGIN}/__test__/terminal/state`)
      ).json()) as { held: { session_id: string }[] });
      return held.length;
    })
    .toBeGreaterThan(0);
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/terminal/release?session_id=${encodeURIComponent(held[0]!.session_id)}`,
      )
    ).status(),
  ).toBe(204);
}

test("Overview follows the plan live and keeps the last one after its turn", async ({
  page,
  request,
}) => {
  await start(page, "/workspace/session-panel-plan", "plan-fixture-e2e-token");
  await toggle(page).click();
  const overview = panel(page).getByRole("tabpanel");
  await holdTerminal(request);
  await send(page, "Plan fixture");

  await expect(overview).toContainText("Shipping the coding surface");
  await expect(overview).toContainText("0 of 3 done");
  // The plan's steps; background tasks follow in their own list.
  await expect(overview.locator("ol > li")).toHaveText([
    "Inspect the workspace, In progress",
    "Implement the change, Pending",
    "Run product checks, Pending",
  ]);

  expect(
    (await request.post(`${FIXTURE_ORIGIN}/__test__/plan/advance`)).status(),
  ).toBe(204);
  await expect(overview).toContainText("1 of 3 done");
  await expect(overview).toContainText("Update the changelog");

  await releaseTerminal(request);
  await expect(overview).toContainText("Its turn has ended");
  await expect(overview).toContainText("1 of 3 done");
});

test("Files shows the folder and this session's changes; a file opens its diff", async ({
  page,
}) => {
  await start(page, "/srv/fixture/Projects", "workspace-browse-e2e-token");
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Files" }).click();
  const files = panel(page).getByRole("tabpanel");
  await expect(
    files.getByRole("button", { name: "notes", exact: true }),
  ).toBeVisible();
  await expect(
    files.getByRole("button", { name: "octoscode-web", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(files).toContainText("not a complete workspace file tree");

  await send(page, "Edit the panel fixture");
  await expect(page.getByText("Completed with")).toBeVisible();
  // The changed file appears under folders the server never listed.
  for (const folder of ["apps", "web", "src", "app"])
    await files
      .getByRole("button", { name: new RegExp(`^${folder}\\b`) })
      .click();
  await files.getByRole("button", { name: /^App\.tsx/ }).click();

  const changes = panel(page).getByRole("tabpanel", { name: /^Changes/ });
  await expect(
    changes.getByRole("heading", { name: "Mock coding change" }),
  ).toBeVisible();
  await expect(
    changes.getByRole("button", { name: /App\.tsx/ }),
  ).toHaveAttribute("aria-current", "true");

  await panel(page)
    .getByRole("tab", { name: /^Outputs/ })
    .click();
  await expect(panel(page).getByLabel("Selected file")).toContainText(
    "App.tsx",
  );
  await panel(page)
    .getByRole("button", { name: "All outputs", exact: true })
    .click();
  await expect(panel(page).getByRole("tabpanel")).toContainText(
    "Written in this folder",
  );
  await panel(page)
    .getByRole("button", { name: /App\.tsx/ })
    .click();
  // The fixture omits retained mutations on hydrate. A browser hint must not
  // recreate a server record, nor keep rendering an old preview.
  await page.reload();
  await expect(panel(page)).toContainText(
    "This file is no longer in the session's retained files",
  );
  await expect(panel(page).locator("pre")).toHaveCount(0);
});

test("Outputs previews a file Octos sent", async ({ page, request }) => {
  await start(page, `/workspace/session-panel-outputs-${Date.now()}`);
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  const sessionId = (JSON.parse(reference!) as string[])[2]!;
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=summary.md`,
      )
    ).ok(),
  ).toBe(true);

  await toggle(page).click();
  await panel(page)
    .getByRole("tab", { name: /^Outputs/ })
    .click();
  const outputs = panel(page).getByRole("tabpanel");
  await expect(outputs).toContainText("Sent to you");
  await outputs.getByRole("button", { name: /summary\.md/ }).click();
  await expect(outputs.locator("pre")).toHaveText("fixture summary.md");
  await expect(outputs.getByRole("button", { name: "Download" })).toBeVisible();
  await panel(page).getByRole("tab", { name: "Overview" }).click();
  await panel(page).getByRole("tab", { name: "Outputs" }).click();
  await expect(outputs.locator("pre")).toHaveText("fixture summary.md");
  await page.reload();
  await expect(outputs.locator("pre")).toHaveText("fixture summary.md");
  await outputs.getByRole("button", { name: "All outputs" }).click();
  await expect(outputs).toContainText("Sent to you");
});

test("Outputs renders the same CSV as a table on mobile", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, `/workspace/session-panel-csv-${Date.now()}`);
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  const sessionId = (JSON.parse(reference!) as string[])[2]!;
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=large.csv&valid=1`,
      )
    ).ok(),
  ).toBe(true);

  await toggle(page).click();
  const mobilePanel = page.getByRole("dialog", { name: "Session panel" });
  await mobilePanel.getByRole("tab", { name: /^Outputs/ }).click();
  const outputs = mobilePanel.getByRole("tabpanel");
  await outputs.getByRole("button", { name: /large\.csv/ }).click();
  await expect(
    outputs.getByRole("columnheader", { name: "A", exact: true }),
  ).toBeVisible();
  await expect(
    outputs.getByRole("cell", { name: "row-1", exact: true }),
  ).toBeVisible();
  await expect(outputs.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(outputs).toHaveScreenshot("mobile-csv-preview.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});

test("Files loads the new workspace root after switching Sessions", async ({
  page,
}) => {
  await start(page, "/srv/fixture/Projects", "workspace-browse-e2e-token");
  await createWorkspace(page, "/");
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Files" }).click();
  const files = panel(page).getByRole("tabpanel");
  await files.getByRole("button", { name: "srv", exact: true }).click();
  await files.getByRole("button", { name: "fixture", exact: true }).click();
  await expect(
    files.getByRole("button", { name: "archive", exact: true }),
  ).toBeVisible();
});

test("Files ignores a late listing from the previous workspace root", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        result?: { canonical_path?: string };
      };
      if (frame.result?.canonical_path === "/srv/fixture/Projects") {
        release = () => socket.send(message);
        return;
      }
      socket.send(message);
    });
  });
  await start(page, "/srv/fixture/Projects", "workspace-browse-e2e-token");
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Files" }).click();
  await createWorkspace(page, "/");
  const files = panel(page).getByRole("tabpanel");
  await files.getByRole("button", { name: "srv", exact: true }).click();
  await files.getByRole("button", { name: "fixture", exact: true }).click();
  await expect(
    files.getByRole("button", { name: "archive", exact: true }),
  ).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  release?.();
  await expect(
    files.getByRole("button", { name: "archive", exact: true }),
  ).toBeVisible();
  await expect(
    files.getByRole("button", { name: "notes", exact: true }),
  ).toHaveCount(0);
});

test("Outputs clears the selected file and preview when switching Sessions", async ({
  page,
  request,
}) => {
  const navigation = page.getByRole("complementary", {
    name: "Product navigation",
  });
  await start(page, "/workspace/review-output-a");
  const firstTitle = await navigation
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  await createWorkspace(page, "/workspace/review-output-b");
  const secondTitle = await navigation
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  await navigation
    .locator(`[role="treeitem"][data-session-id=${JSON.stringify(firstTitle)}]`)
    .click();
  const reference = new URL(page.url()).searchParams.get("s");
  const sessionId = (JSON.parse(reference!) as string[])[2]!;
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=summary.md`,
      )
    ).ok(),
  ).toBe(true);
  await toggle(page).click();
  await panel(page)
    .getByRole("tab", { name: /^Outputs/ })
    .click();
  await panel(page)
    .getByRole("button", { name: /summary\.md/ })
    .click();
  await expect(panel(page).locator("pre")).toHaveText("fixture summary.md");
  await navigation
    .locator(
      `[role="treeitem"][data-session-id=${JSON.stringify(secondTitle)}]`,
    )
    .click();
  if ((await toggle(page).getAttribute("aria-expanded")) === "false") {
    await toggle(page).click();
  }
  await panel(page)
    .getByRole("tab", { name: /^Outputs/ })
    .click();
  await expect(
    panel(page).getByRole("button", { name: /summary\.md/ }),
  ).toHaveCount(0);
  await expect(panel(page).locator("pre")).toHaveCount(0);
});

test("Automation shows and controls goals, loops, monitors and agents with zero axe violations", async ({
  page,
}, testInfo) => {
  await start(page, "/srv/work/native-workflows-automation");
  await toggle(page).click();
  await panel(page).getByRole("tab", { name: "Automation" }).click();
  const automation = panel(page).getByRole("tabpanel", {
    name: "Automation",
  });
  // Engineering status notes are not shown to users (T-0076).
  await expect(automation).not.toContainText("sandboxed");

  await automation
    .getByLabel("Goal objective")
    .fill("Ship the automation panel");
  await automation.getByRole("button", { name: "Set session goal" }).click();
  await expect(automation).toContainText("Ship the automation panel");

  await automation.getByRole("button", { name: "Create loop" }).click();
  await expect(
    automation.getByRole("list", { name: "Loop list" }),
  ).toBeVisible();
  await automation.getByRole("button", { name: /^Pause loop / }).click();
  await automation.getByRole("button", { name: /^Resume loop / }).click();

  await automation.getByLabel("New monitor name").fill("watch-build");
  await automation
    .getByLabel("New monitor probe command")
    .fill('["./scripts/watch.sh"]');
  await automation.getByRole("button", { name: "Create monitor" }).click();
  await expect(automation).toContainText("watch-build");
  await automation.getByRole("button", { name: /^Pause monitor / }).click();
  await automation.getByRole("button", { name: /^Resume monitor / }).click();

  await automation
    .getByRole("button", { name: "Read output of agent native-agent-1" })
    .click();
  await expect(automation).toContainText("Output — native-agent-1");
  await automation
    .getByRole("button", { name: "Interrupt agent native-agent-1" })
    .click();
  await expect(
    automation.getByRole("button", { name: "Interrupt agent native-agent-1" }),
  ).toBeDisabled();

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("automation-panel.png"),
    fullPage: true,
  });

  await automation.getByRole("button", { name: "Clear session goal" }).click();
  await expect(automation).toContainText("No active goal for this session.");
});

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
  await start(page, `/workspace/panel-linked-${Date.now()}`);
  await send(page, "Write the linked report");
  await expect(toggle(page)).toHaveAccessibleName("Session panel, 1 changed");
  const id = JSON.parse(
    new URL(page.url()).searchParams.get("s")!,
  )[2] as string;
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
  await expect(panel(page).locator("pre")).toHaveText("fixture summary.md");
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
  await expect(panel(page).locator("pre")).toHaveText("fixture summary.md");
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
  await expect(panel(page).getByRole("alert")).toContainText(
    "workspace file was not found",
  );
  await expect(panel(page).locator("pre")).toHaveCount(0);
  readFails = false;
  await panel(page)
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(panel(page).locator("pre")).toHaveText("fixture summary.md");
  deleted = true;
  await page.reload();
  await expect(panel(page)).toContainText("This file was deleted");
  await expect(panel(page).locator("pre")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeInViewport();
});
