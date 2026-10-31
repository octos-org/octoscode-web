import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
}

async function startSession(page: Page, cwd: string) {
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

function countTurnStarts(page: Page): string[] {
  const starts: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) starts.push("");
    }),
  );
  return starts;
}

test("an empty session fills the message box from a template and never sends it", async ({
  page,
}) => {
  const starts = countTurnStarts(page);
  await connect(page);
  await startSession(page, "/workspace/templates-home");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  await expect(home.getByRole("heading", { name: "Code" })).toBeVisible();
  await expect(home.getByRole("heading", { name: "General" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);

  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await home.getByRole("button", { name: "Use this: Fix a bug" }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(/^Help me fix a bug\./);
  // The first blank is selected, so typing replaces it.
  expect(
    await composer.evaluate((input: HTMLTextAreaElement) =>
      input.value.slice(input.selectionStart, input.selectionEnd),
    ),
  ).toBe("[what you see]");
  await expect(home.getByRole("status")).toContainText(
    "“Fix a bug” is in the message box.",
  );

  await home.getByRole("button", { name: "Undo" }).click();
  await expect(composer).toHaveValue("");
  expect(starts).toEqual([]);

  await home
    .getByRole("button", { name: "Use this: Review recent changes" })
    .click();
  await expect(composer).toHaveValue(/^Review the recent changes/);
  await composer.press("Enter");
  await expect(home).toBeHidden();
  expect(starts).toHaveLength(1);
});

test("a template picked before a folder fills the session that folder opens", async ({
  page,
}) => {
  await connect(page);
  const gallery = page.getByRole("region", {
    name: "Or start from a template",
  });
  await gallery
    .getByRole("button", { name: "Use this: Write a weekly report" })
    .click();
  await expect(gallery.getByRole("status")).toContainText(
    "“Write a weekly report” is ready. Choose a folder to start.",
  );
  await expect(page.getByLabel("Server workspace path")).toBeFocused();

  await startSession(page, "/workspace/templates-pending");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toHaveValue(/^Using \[the data or notes/);
  await expect(composer).toBeFocused();
});

test("an empty session links back to the last session and stacks on a phone", async ({
  page,
}) => {
  await connect(page);
  await startSession(page, "/workspace/templates-earlier");
  await page
    .locator("aside")
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  const picker = page.getByRole("dialog");
  await picker
    .getByLabel("Server workspace path")
    .fill("/workspace/templates-later");
  await picker.getByLabel("Server workspace path").press("Enter");
  await expect(page.getByText("/workspace/templates-later")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  const cards = home.locator("[data-template]");
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(second!.x).toBe(first!.x);
  expect(second!.y).toBeGreaterThan(first!.y + first!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );

  await home
    .getByRole("button", { name: /^Continue where you left off/ })
    .click();
  await expect(page.getByText("/workspace/templates-earlier")).toBeVisible();
});

test("a read-only template waits for the permission receipt before sending", async ({
  page,
}) => {
  let armSet = false;
  let setId: string | null = null;
  let release: (() => void) | undefined;
  let starts = 0;
  const setUpdates: unknown[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts += 1;
      if (armSet && frame.method === "permission/profile/set") {
        armSet = false;
        setId = frame.id;
        setUpdates.push(frame.params.update);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (setId && frame.id === setId && frame.result) {
        release = () => socket.send(message);
        return;
      }
      socket.send(message);
    });
  });
  await connect(page);
  await startSession(page, "/workspace/templates-read-receipt");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  armSet = true;
  await home
    .getByRole("button", { name: "Use this: Review recent changes" })
    .click();
  await composer.press("Enter");
  await expect.poll(() => Boolean(release)).toBe(true);
  expect(starts).toBe(0);
  await expect(composer).toHaveValue(/^Review the recent changes/);
  release?.();
  await expect(home).toBeHidden();
  expect(starts).toBe(1);
  expect(setUpdates).toEqual([{ mode: "read_only" }]);
  await expect(
    page.getByRole("button", { name: /Read only/ }).first(),
  ).toBeVisible();
});

test("a write template sends without changing the selected permission", async ({
  page,
}) => {
  const starts = countTurnStarts(page);
  const permissionSets: unknown[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "permission/profile/set") permissionSets.push(frame);
    }),
  );
  await connect(page);
  await startSession(page, "/workspace/templates-write-permission");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  await home.getByRole("button", { name: "Use this: Fix a bug" }).click();
  await page.getByRole("textbox", { name: "Message Octos" }).press("Enter");
  await expect(home).toBeHidden();
  expect(starts).toHaveLength(1);
  expect(permissionSets).toEqual([]);
  await expect(
    page.getByRole("button", { name: /Workspace write/ }).first(),
  ).toBeVisible();
});

test("a read-only template blocks sending when SET is unavailable", async ({
  page,
}) => {
  const starts = countTurnStarts(page);
  let blockedSets = 0;
  const withoutSet = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutSet);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? entry.filter((method) => method !== "permission/profile/set")
          : withoutSet(entry),
      ]),
    );
  };
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "permission/profile/set") blockedSets += 1;
      server.send(message);
    });
    server.onMessage((message) =>
      socket.send(JSON.stringify(withoutSet(JSON.parse(String(message))))),
    );
  });
  await connect(page);
  await startSession(page, "/workspace/templates-no-set");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await home
    .getByRole("button", { name: "Use this: Review recent changes" })
    .click();
  await expect(home).toContainText(
    "Current permission is still workspace write",
  );
  await composer.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Current permission is still workspace write" }),
  ).toBeVisible();
  await expect(composer).toHaveValue(/^Review the recent changes/);
  expect(starts).toEqual([]);
  expect(blockedSets).toBe(0);
});
