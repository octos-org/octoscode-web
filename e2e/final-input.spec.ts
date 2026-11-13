import { expect, test, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";
import { observeSent } from "./turn-observers";

const start = (page: Page) => startSession(page, "/workspace/final-input");

test("approval shortcuts ignore modified keys and IME composition", async ({
  page,
}) => {
  const decisions = observeSent(page, "approval/respond");
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request approval fixture");
  await input.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeFocused();
  await page.keyboard.press("Control+y");
  await expect(approval).toBeVisible();
  expect(decisions()).toHaveLength(0);
  await page.keyboard.press("Alt+n");
  await page.keyboard.press("Meta+s");
  await approval.dispatchEvent("keydown", {
    key: "y",
    code: "KeyY",
    isComposing: true,
  });
  await approval.dispatchEvent("keydown", {
    key: "y",
    code: "KeyY",
    keyCode: 229,
  });
  await expect(approval).toBeVisible();
  expect(decisions()).toHaveLength(0);
  await page.keyboard.press("y");
  await expect(approval).toBeHidden();
  expect(decisions()).toHaveLength(1);
});
