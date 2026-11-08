import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

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

async function useTemplate(page: Page, name: string) {
  await page
    .getByRole("region", { name: "What can Octos help with?" })
    .getByRole("button", { name: `Use this: ${name}` })
    .click();
}

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
