import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

async function startSession(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(workspace);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

function permissionUpdates(page: Page) {
  const updates: Array<{ mode?: string; network?: string }> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "permission/profile/set") {
        updates.push(frame.params.update);
      }
    }),
  );
  return updates;
}

async function useTemplate(page: Page, name: string) {
  await page
    .getByRole("region", { name: "What can Octos help with?" })
    .getByRole("button", { name: `Use this: ${name}` })
    .click();
}

test("a real pointer click on card prose fills the composer", async ({
  page,
}) => {
  await startSession(page, "/workspace/template-card-pointer");
  const card = page.locator('[data-template="fix-bug"]');
  const title = card.getByRole("heading", { name: "Fix a bug" });
  const box = await title.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue(/^Help me fix a bug\./);
});

test("switching templates, undo, and clearing restore the original permission", async ({
  page,
}) => {
  const updates = permissionUpdates(page);
  await startSession(page, "/workspace/template-permission-restore");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });

  await useTemplate(page, "Review recent changes");
  await expect(
    page.getByRole("button", { name: /^Permission: Read/ }).first(),
  ).toBeVisible();
  await useTemplate(page, "Fix a bug");
  await expect(
    page.getByRole("button", { name: /^Permission: Write/ }).first(),
  ).toBeVisible();
  expect(updates.at(-1)).toEqual({ mode: "workspace_write", network: "deny" });

  await useTemplate(page, "Review recent changes");
  await expect(
    page.getByRole("button", { name: /^Permission: Read/ }).first(),
  ).toBeVisible();
  await home.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Permission: Write/ }).first(),
  ).toBeVisible();

  await useTemplate(page, "Review recent changes");
  await expect(
    page.getByRole("button", { name: /^Permission: Read/ }).first(),
  ).toBeVisible();
  await composer.press("Control+a");
  await composer.press("Backspace");
  await expect(composer).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /^Permission: Write/ }).first(),
  ).toBeVisible();
  expect(updates.at(-1)).toEqual({ mode: "workspace_write", network: "deny" });
});

test("a write template blocks read-only sending and offers one-click write access", async ({
  page,
}) => {
  let starts = 0;
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) starts += 1;
    }),
  );
  await startSession(page, "/workspace/template-write-send-gate");
  await useTemplate(page, "Fix a bug");
  await page.getByRole("button", { name: /^Permission:/ }).click();
  await page
    .getByRole("menuitemradio", { name: /^Read · Network blocked/ })
    .click();
  await expect(
    page.getByRole("button", { name: /^Permission: Read/ }).first(),
  ).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "This template needs write permission" }),
  ).toBeVisible();
  expect(starts).toBe(0);
  await page
    .getByRole("button", { name: "Switch to workspace write", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Permission: Write/ }).first(),
  ).toBeVisible();
  await composer.press("Enter");
  await expect(
    page.getByRole("region", { name: "What can Octos help with?" }),
  ).toHaveCount(0);
  expect(starts).toBe(1);
});

test("the permission menu includes all legal combinations and preserves the session default", async ({
  page,
}, testInfo) => {
  const updates = permissionUpdates(page);
  await startSession(page, "/workspace/permission-all-options");
  await page.getByRole("button", { name: /^Permission:/ }).click();
  const menu = page.getByRole("menu", { name: "Permission", exact: true });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(6);
  const initialDefault = menu.getByRole("menuitemradio", {
    name: /^Write · Network blocked/,
  });
  await expect(initialDefault).toContainText("Default");
  expect(
    (await new AxeBuilder({ page }).include('[role="menu"]').analyze())
      .violations,
  ).toEqual([]);
  if (testInfo.project.name === "chromium") {
    await expect(menu).toHaveScreenshot(
      "permission-menu-all-options.png",
      SNAPSHOT,
    );
  }

  await menu
    .getByRole("menuitemradio", { name: /^Read · Network allowed/ })
    .click();
  await expect(
    page
      .getByRole("button", { name: /^Permission: Read · Network allowed/ })
      .first(),
  ).toBeVisible();
  expect(updates.at(-1)).toEqual({ mode: "read_only", network: "allow" });

  await page.getByRole("button", { name: /^Permission:/ }).click();
  const reopened = page.getByRole("menu", { name: "Permission", exact: true });
  await expect(
    reopened.getByRole("menuitemradio", { name: /^Write · Network blocked/ }),
  ).toContainText("Default");
  await expect(
    reopened.getByRole("menuitemradio", { name: /^Read · Network allowed/ }),
  ).not.toContainText("Default");
});
