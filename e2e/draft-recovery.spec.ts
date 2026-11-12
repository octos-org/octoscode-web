import { expect, test } from "@playwright/test";
import { startSession } from "./fixture-session";
import { observeSent } from "./turn-observers";
import { stopButton } from "./sessions";

test("reload restores exact unsent text without dispatching it, and sent drafts stay cleared", async ({
  page,
}) => {
  const starts = observeSent(page, "turn/start");
  await startSession(page, "/workspace/draft-recovery");
  const input = page.getByRole("textbox", { name: "Message Octos" });
  const text = "  尚未发送的审阅说明 👩🏽‍💻\n\n保留最后的空白  ";
  await input.fill(text);
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(localStorage)))
    .toContain("尚未发送");
  await page.reload();
  await expect(input).toHaveValue(text);
  expect(starts()).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(() => starts().length).toBe(1);
  await expect(input).toHaveValue("");
  await expect(stopButton(page)).toBeHidden();
  await page.reload();
  await expect(input).toHaveValue("");
  expect(starts()).toHaveLength(1);
});
