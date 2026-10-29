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
  await page.getByLabel("Server workspace path").fill(workspace);
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
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await picker.getByLabel("Server workspace path").fill(path);
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
  await expect(files).toContainText("can't list or open other files yet");

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
  await expect(panel(page).getByRole("tabpanel")).toContainText(
    "Written in this folder",
  );
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
  await outputs.getByRole("button", { name: "All outputs" }).click();
  await expect(outputs).toContainText("Sent to you");
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
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  await createWorkspace(page, "/workspace/review-output-b");
  const secondTitle = await navigation
    .locator('button[role="treeitem"][aria-current="page"]')
    .locator('[class*="sessionTitle"]')
    .textContent();
  await navigation
    .locator('button[role="treeitem"]')
    .filter({ hasText: firstTitle! })
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
    .locator('button[role="treeitem"]')
    .filter({ hasText: secondTitle! })
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
