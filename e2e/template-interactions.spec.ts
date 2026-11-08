import { expect, test, type Page } from "@playwright/test";
import { connectAndStartWorkspace } from "./fixture-session";
import { holdPermissionReceipt } from "./permission-receipt";

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
  await connectAndStartWorkspace(page, "/workspace/template-write-send-gate");
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

test("a read-only template waits for the permission receipt before sending", async ({
  page,
}) => {
  const receipt = await holdPermissionReceipt(page);
  await connectAndStartWorkspace(page, "/workspace/templates-read-receipt");
  const home = page.getByRole("region", { name: "What can Octos help with?" });
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  receipt.arm();
  await useTemplate(page, "Review recent changes");
  await composer.press("Enter");
  await expect.poll(receipt.isHeld).toBe(true);
  // Sending again while the receipt is outstanding sends nothing either.
  await composer.press("Enter");
  expect(receipt.starts()).toBe(0);
  await expect(composer).toHaveValue(/^Review the recent changes/);
  receipt.release();
  await expect(home).toBeHidden();
  expect(receipt.updates).toEqual([{ mode: "read_only" }]);
  await expect(
    page.getByRole("button", { name: /^Permission: Read/ }).first(),
  ).toBeVisible();
  await expect(page.locator(".entry-user")).toHaveCount(1);
  expect(receipt.starts()).toBe(1);
});
