import { expect, test } from "@playwright/test";
import { startSession } from "./fixture-session";

test("reload restores exact unsent text without dispatching it, and sent drafts stay cleared", async ({
  page,
}) => {
  const starts: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") starts.push(frame.params);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await startSession(page, "/workspace/draft-recovery");
  const input = page.getByRole("textbox", { name: "Message Octos" });
  const text = "  尚未发送的审阅说明 👩🏽‍💻\n\n保留最后的空白  ";
  await input.fill(text);
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(localStorage)))
    .toContain("尚未发送");
  await page.reload();
  await expect(input).toHaveValue(text);
  expect(starts).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(() => starts.length).toBe(1);
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeHidden();
  await page.reload();
  await expect(input).toHaveValue("");
  expect(starts).toHaveLength(1);
});
