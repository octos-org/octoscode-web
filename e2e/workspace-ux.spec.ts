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

test("mobile review actions leave room for workspace context after a completed turn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Review the mobile workspace fixture");
  await input.press("Enter");
  await expect(page.getByText("Completed with")).toBeVisible();
  const review = page.getByRole("button", {
    name: "Review changes",
    exact: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(review).toBeInViewport();
    const bounds = await review.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    const title = await page.locator(".workspace-title").boundingBox();
    expect(title!.width).toBeGreaterThanOrEqual(width === 390 ? 100 : 40);
    await review.click();
    await expect(
      page.getByRole("dialog", { name: "Mock coding change" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(review).toBeFocused();
  }
});

test("follows arriving content but leaves a reader in history until they jump to latest", async ({
  page,
}) => {
  const turns = await holdTurns(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("show a long response");
  await input.press("Enter");
  await expect.poll(() => turns.sent.length).toBe(1);
  const prose = Array.from(
    { length: 35 },
    (_, i) =>
      `Paragraph ${i}: A detailed explanation of the repository and how its parts fit together.`,
  ).join("\n\n");
  turns.emit("assistant_delta", {
    assistant_segment_id: "answer",
    text: prose,
  });
  const region = page.getByRole("region", {
    name: "Conversation",
    exact: true,
  });
  const distance = () =>
    region.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(distance).toBeLessThan(48);
  await region.hover();
  await page.mouse.wheel(0, -650);
  await expect(
    page.getByRole("button", { name: "Back to latest" }),
  ).toBeVisible();
  const before = await region.evaluate((el) => el.scrollTop);
  turns.emit("assistant_delta", {
    assistant_segment_id: "answer",
    text: "\n\nOne more paragraph arrives while you are reading.",
  });
  await expect
    .poll(() => region.evaluate((el) => Math.abs(el.scrollTop)))
    .toBeGreaterThan(0);
  expect(
    Math.abs((await region.evaluate((el) => el.scrollTop)) - before),
  ).toBeLessThan(10);
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect.poll(distance).toBeLessThan(48);
  turns.emit("turn_terminal", { outcome: "completed" });
});

test("opening tool output keeps its heading in view instead of following the expansion", async ({
  page,
}) => {
  const turns = await holdTurns(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Review details expansion");
  await input.press("Enter");
  await expect.poll(() => turns.sent.length).toBe(1);
  turns.emit("tool_start", {
    tool_call_id: "expanded-tool",
    name: "read_file",
  });
  turns.emit("tool_end", {
    tool_call_id: "expanded-tool",
    status: "complete",
    output_preview: "Example output line\n".repeat(80),
  });
  turns.emit("assistant_persisted", {
    assistant_segment_id: "answer",
    text: Array.from(
      { length: 11 },
      (_, i) => `Result paragraph ${i + 1}: read the tool output above.`,
    ).join("\n\n"),
    meta: { message_id: "expanded-answer" },
  });
  turns.emit("turn_terminal", { outcome: "completed" });
  const region = page.getByRole("region", {
    name: "Conversation",
    exact: true,
  });
  await expect(
    page.getByText("Result paragraph 11: read the tool output above.", {
      exact: true,
    }),
  ).toBeVisible();
  await region.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const summary = page.locator("summary").filter({ hasText: "read_file" });
  await summary.scrollIntoViewIfNeeded();
  const before = (await summary.boundingBox())!.y;
  await summary.click();
  await expect(summary.locator("..")).toHaveAttribute("open");
  await expect(summary.locator("..").locator("pre")).toBeVisible();
  await expect
    .poll(async () => Math.abs((await summary.boundingBox())!.y - before))
    .toBeLessThan(5);
  expect((await summary.boundingBox())!.y).toBeGreaterThanOrEqual(
    (await region.boundingBox())!.y,
  );
});

test("sidebar sort controls reorder sessions and track which Session was last opened", async ({
  page,
}) => {
  await start(page);
  const sidebar = page.getByRole("complementary", {
    name: "Product navigation",
  });
  const sessions = sidebar.locator('button[role="treeitem"]');
  const titles = sessions.locator('[class*="sessionTitle"]');
  const selectedTitle = sidebar.locator(
    'button[role="treeitem"][aria-current="page"] [class*="sessionTitle"]',
  );
  await expect(sessions).toHaveCount(1);
  const openedTitles = [await selectedTitle.innerText()];
  for (const count of [2, 3]) {
    await sidebar
      .getByRole("button", { name: "ux-review", exact: true })
      .hover();
    await sidebar
      .getByRole("button", { name: "New session in ux-review" })
      .click();
    await expect(sessions).toHaveCount(count);
    await expect(
      page.getByRole("textbox", { name: "Message Octos" }),
    ).toBeEnabled();
    openedTitles.push(await selectedTitle.innerText());
  }
  expect(new Set(openedTitles).size).toBe(3);
  await expect(titles).toHaveText([...openedTitles].reverse());
  const trigger = sidebar.getByRole("button", { name: "Session view options" });
  await trigger.click();
  await page
    .getByRole("menuitemradio", { name: "Least recently opened" })
    .click();
  await expect(titles).toHaveText(openedTitles);
  await trigger.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Least recently opened" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Last opened" }).click();
  await expect(titles).toHaveText([...openedTitles].reverse());
  await trigger.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Last opened" }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("menuitemradio", { name: "Least recently opened" })
    .click();
  await sessions.first().click();
  const reopenedOrder = [openedTitles[1]!, openedTitles[2]!, openedTitles[0]!];
  await expect(titles).toHaveText(reopenedOrder);
  await expect(selectedTitle).toHaveText(openedTitles[0]!);
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "Last opened" }).click();
  await expect(titles).toHaveText([...reopenedOrder].reverse());
});

test("long queued messages and a multiline draft keep mobile actions inside the viewport", async ({
  page,
}) => {
  const turns = await holdTurns(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Keep this response running");
  await input.press("Enter");
  await expect.poll(() => turns.sent.length).toBe(1);
  for (let index = 1; index <= 8; index++) {
    await input.fill(
      `排队消息 ${index} ${"请仔细检查这段中文代码并保留注释，".repeat(12)}`,
    );
    await input.press("Enter");
  }
  const draft = "剩余需要编辑的内容\n".repeat(30);
  await input.fill(draft);
  const queue = page.getByRole("region", { name: "Queued prompts" });
  await expect(queue.getByRole("listitem")).toHaveCount(8);
  for (const control of [
    input,
    queue,
    page.getByRole("button", { name: "Stop", exact: true }),
    page.getByRole("button", { name: "Queue prompt", exact: true }),
  ]) {
    const rect = (await control.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(321);
  }
  const remove = queue.getByRole("button", {
    name: "Remove queued prompt 8",
    exact: true,
  });
  await remove.scrollIntoViewIfNeeded();
  const rect = (await remove.boundingBox())!;
  expect(rect.x + rect.width).toBeLessThanOrEqual(320);
  expect(rect.y + rect.height).toBeLessThanOrEqual(480);
  await remove.click();
  await expect(queue.getByRole("listitem")).toHaveCount(7);
  await expect(input).toHaveValue(draft);
  expect((await input.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  turns.emit("turn_terminal", { outcome: "completed" });
});

test("finishing approval and question takeovers returns the keyboard to the composer", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request approval fixture");
  await input.press("Enter");
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await approval.getByRole("button", { name: /Yes/ }).click();
  await expect(approval).toBeHidden();
  await expect(input).toBeFocused();
  await page.keyboard.type("Follow-up after approval");
  await expect(input).toHaveValue("Follow-up after approval");
  await input.fill("Request question fixture");
  await expect(
    page.getByRole("button", { name: "Send prompt", exact: true }),
  ).toBeVisible();
  await input.press("Enter");
  const question = page.getByRole("dialog", {
    name: "Choose verification depth",
  });
  await question.getByLabel(/Full/).check();
  await question.getByRole("button", { name: "Continue" }).click();
  await expect(question).toBeHidden();
  await expect(input).toBeFocused();
  await page.keyboard.type("Follow-up after question");
  await expect(input).toHaveValue("Follow-up after question");
});

for (const action of ["Disconnect", "Forget server"] as const) {
  test(`${action} is available during active work but requires an explicit confirmation`, async ({
    page,
  }) => {
    const turns = await holdTurns(page);
    await start(page);
    const input = page.getByRole("textbox", { name: "Message Octos" });
    await input.fill("Keep working while I inspect the connection");
    await input.press("Enter");
    await expect.poll(() => turns.sent.length).toBe(1);
    await input.fill("Keep this queued message if I cancel");
    await input.press("Enter");
    await page
      .getByRole("complementary", { name: "Product navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings.getByRole("button", { name: action, exact: true }).click();
    const confirm = page.getByRole("dialog", {
      name:
        action === "Disconnect"
          ? "Disconnect from Octos?"
          : "Forget this server?",
    });
    await expect(
      confirm.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(settings).toBeVisible();
    // Cancelling kept the prompt queued. ModalSurface aria-hides the workspace
    // behind an open dialog, so while Settings is up that surviving queue is
    // deliberately outside the accessibility tree — read the region from the
    // DOM rather than by role, and keep asserting the same fact: exactly one
    // prompt is still waiting.
    await expect(page.locator('[aria-label="Queued prompts"] li')).toHaveCount(
      1,
    );
    expect(turns.sent).toHaveLength(1);
    await settings.getByRole("button", { name: action, exact: true }).click();
    await confirm.getByRole("button", { name: action, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Connect to Octos", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Queued prompts" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue(
      action === "Disconnect" ? "tab-scoped-e2e-token" : "",
    );
    expect(turns.sent).toHaveLength(1);
  });
}
