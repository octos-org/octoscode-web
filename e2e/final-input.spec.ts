import { expect, test, type Locator, type Page } from "@playwright/test";
import { startSession } from "./fixture-session.ts";

const start = (page: Page) => startSession(page, "/workspace/final-input");

async function withinViewport(page: Page, control: Locator) {
  const box = (await control.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("approval shortcuts ignore modified keys and IME composition", async ({
  page,
}) => {
  const decisions: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "approval/respond") decisions.push(request.params);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request approval fixture");
  await input.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeFocused();
  await page.keyboard.press("Control+y");
  await expect(approval).toBeVisible();
  expect(decisions).toHaveLength(0);
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
  expect(decisions).toHaveLength(0);
  await page.keyboard.press("y");
  await expect(approval).toBeHidden();
  expect(decisions).toHaveLength(1);
});

test("long approval remains readable and actionable in a short phone viewport", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (response.method === "approval/requested") {
        response.params.body =
          "审批说明包含需要逐项检查的工作目录和执行范围。".repeat(60);
        response.params.typed_details.command.command_line =
          "pnpm test --filter=" + "项目检查".repeat(100);
        response.params.typed_details.diff = {
          preview_id: "00000000-0000-4000-8000-000000000042",
        };
        socket.send(JSON.stringify(response));
      } else socket.send(message);
    });
  });
  await start(page);
  await page.setViewportSize({ width: 320, height: 360 });
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request approval fixture");
  await input.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  for (const button of await approval.getByRole("button").all()) {
    await button.focus();
    await withinViewport(page, button);
  }
  const body = approval.locator(".approval-body");
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.wheel(0, 10000);
  await expect
    .poll(() =>
      body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(2);
  await approval.getByRole("button", { name: /^Deny/ }).click();
  await expect(approval).toBeHidden();
});
