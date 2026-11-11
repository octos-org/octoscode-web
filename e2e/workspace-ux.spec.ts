import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill("/workspace/ux-review");
  await page.getByLabel("Server workspace path").press("Enter");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeVisible();
  // Upstream's fixture handed every freshly opened Session a canned demo
  // transcript, so waiting for `.markdown-body` doubled as "the workspace
  // finished attaching". Our Sessions are durable records: a brand-new one
  // starts with an empty transcript, so the equivalent readiness signal is the
  // conversation surface being mounted and the composer no longer disabled by
  // the launch transition / pending navigation.
  await expect(
    page.getByRole("region", { name: "Conversation", exact: true }),
  ).toBeVisible();
  await expect(composer).toBeEnabled();
}

async function holdTurns(page: Page) {
  const sent: string[] = [];
  let emit: ((type: string, data: Record<string, unknown>) => void) | undefined;
  let cursor = 100;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method !== "turn/start") {
        server.send(message);
        return;
      }
      sent.push(request.params.turn_id);
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { accepted: true },
        }),
      );
      let seq = 0;
      emit = (type, data) =>
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "projection/envelope",
            params: {
              session_id: request.params.session_id,
              turn_id: request.params.turn_id,
              thread_id: "ux-review",
              seq: ++seq,
              cursor: { stream: request.params.session_id, seq: ++cursor },
              payload: { type, data },
            },
          }),
        );
    });
  });
  return {
    sent,
    emit: (type: string, data: Record<string, unknown>) => emit!(type, data),
  };
}

test("IME confirmation and multiline editing never send; queued messages can be removed", async ({
  page,
}) => {
  const turns = await holdTurns(page);
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(input).toBeFocused();
  await input.fill("检查中文输入");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(input).toHaveValue("检查中文输入");
  expect(turns.sent).toHaveLength(0);
  await input.press("Shift+Enter");
  await input.press("Alt+Enter");
  await expect(input).toHaveValue("检查中文输入\n\n");
  expect(turns.sent).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(() => turns.sent.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue prompt" })).toHaveCount(
    0,
  );
  await input.fill("queued message one");
  await input.press("Enter");
  await input.fill("queued message two");
  await input.press("Enter");
  const queue = page.getByRole("region", { name: "Queued prompts" });
  await expect(queue).toContainText("2 queued");
  await queue.getByRole("button", { name: "Remove queued prompt 1" }).click();
  await expect(queue).not.toContainText("queued message one");
  await expect(queue).toContainText("queued message two");
  await queue.getByRole("button", { name: "Remove queued prompt 1" }).click();
  await expect(queue).toHaveCount(0);
  turns.emit("turn_terminal", { outcome: "completed" });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  expect(turns.sent).toHaveLength(1);
});

test("protects a running turn from closing the tab and removes the warning on completion", async ({
  page,
}) => {
  const turns = await holdTurns(page);
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("keep this running");
  await input.press("Enter");
  await expect.poll(() => turns.sent.length).toBe(1);
  const dialogPromise = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);
  turns.emit("turn_terminal", { outcome: "completed" });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

test("keeps the mobile composer on screen and makes navigation an accessible drawer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("preserve my mobile draft");
  const box = await input.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(
    await page.evaluate(() => document.body.scrollHeight),
  ).toBeLessThanOrEqual(844);
  await expect(
    page.getByRole("complementary", { name: "Product navigation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Open sessions" }).click();
  const drawer = page.getByRole("dialog", { name: "Sessions and workspaces" });
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open sessions" }),
  ).toBeFocused();
  await expect(input).toHaveValue("preserve my mobile draft");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("mobile-dark.png") });
  await page.setViewportSize({ width: 320, height: 480 });
  const compactBox = await input.boundingBox();
  expect(compactBox!.y + compactBox!.height).toBeLessThan(480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});
