import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function start(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill("/workspace/final-input");
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

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
  await approval.getByRole("button", { name: /^No/ }).click();
  await expect(approval).toBeHidden();
});

test("connection actions can be reached by scrolling at 320×320", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("incorrect-fixture-token");
  await page.mouse.move(160, 230);
  await page.mouse.wheel(0, 2000);
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  await expect
    .poll(async () => (await connect.boundingBox())!.y)
    .toBeLessThan(280);
  await withinViewport(page, connect);
  await testInfo.attach("connection-short-viewport", {
    body: await page.screenshot({
      path: testInfo.outputPath("connection-short-viewport.png"),
    }),
    contentType: "image/png",
  });
  await connect.click();
  await expect(
    page.getByText("Could not connect", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.mouse.wheel(0, 2000);
  await connect.click();
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
});

test("long questions retain free text and selections after a failed response", async ({
  page,
}, testInfo) => {
  const responses: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "user_question/respond") {
        responses.push(request.params);
        if (responses.length === 1) {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: -32000,
                message: "Fixture response failed; please retry.",
              },
            }),
          );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (response.method === "user_question/requested") {
        response.params.questions = Array.from({ length: 3 }, (_, index) => ({
          header: `Check ${index + 1}`,
          question: "Which verification scope should be used?",
          options: [
            {
              label: `Scope${index + 1}${"UnbrokenLabel".repeat(12)}`,
              description:
                "Validate the selected project and preserve the requested scope.",
            },
            { label: "Full", description: "Run all available product checks." },
          ],
          multi_select: index === 1,
          allow_free_text: true,
        }));
        socket.send(JSON.stringify(response));
      } else socket.send(message);
    });
  });
  await start(page);
  await page.setViewportSize({ width: 320, height: 360 });
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request question fixture");
  await input.press("Enter");
  const question = page.getByRole("dialog", {
    name: "Choose verification depth",
  });
  await expect(question).toBeVisible();
  for (const fieldset of await question.locator("fieldset").all()) {
    const full = fieldset.getByLabel("Full", { exact: false });
    await full.check();
    await withinViewport(page, full);
  }
  const other = question.getByPlaceholder("Type another answer").last();
  await other.fill("保留我输入的额外检查要求");
  await withinViewport(page, other);
  const submit = question.getByRole("button", { name: "Continue" });
  await submit.focus();
  await withinViewport(page, submit);
  await submit.press("Enter");
  await expect(
    question.getByText("Fixture response failed; please retry."),
  ).toBeVisible();
  await expect(other).toHaveValue("保留我输入的额外检查要求");
  const questionBox = (await question.boundingBox())!;
  await page.mouse.move(
    questionBox.x + questionBox.width / 2,
    questionBox.y + questionBox.height / 2,
  );
  await page.mouse.wheel(0, 2000);
  await expect
    .poll(() =>
      question.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await withinViewport(page, submit);
  await testInfo.attach("question-retry-short-viewport", {
    body: await page.screenshot({
      path: testInfo.outputPath("question-retry-short-viewport.png"),
    }),
    contentType: "image/png",
  });
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(2);
  await expect(question.getByRole("checkbox", { checked: true })).toHaveCount(
    1,
  );
  await submit.click();
  await expect(question).toBeHidden();
  expect(responses).toHaveLength(2);
  expect(responses[1]).toEqual(responses[0]);
});

test("composer preserves IME confirmation and multiline edits around commands", async ({
  page,
}) => {
  const prompts: unknown[] = [];
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      if (request.method === "turn/start") prompts.push(request.params);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  // `start` already proved the composer is a textbox named "Message Octos".
  // This row then opens the command palette, and our ComposerInput declares the
  // ARIA 1.2 combobox pattern on the textarea while the palette is open
  // (ComposerInput.tsx:230) — upstream's PromptComposer, which App.tsx no longer
  // mounts, left the implicit textbox role. Address the SAME element by its
  // accessible name so the assertions survive that role flip instead of
  // silently losing the element.
  const input = page.getByLabel("Message Octos");
  await input.fill("/");
  await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const selected = await input.getAttribute("aria-activedescendant");
  await input.dispatchEvent("keydown", { key: "ArrowDown", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(input).toHaveValue("/");
  await expect(input).toHaveAttribute("aria-activedescendant", selected!);
  await input.press("Escape");
  await expect(page.getByRole("listbox", { name: "Commands" })).toBeHidden();
  await input.fill("第一行second");
  await input.press("Home");
  await input.press("ArrowRight");
  await input.press("Shift+ArrowRight");
  await input.press("Alt+Enter");
  await expect(input).toHaveValue("第\n行second");
  await input.press("Control+j");
  await expect(input).toHaveValue("第\n\n行second");
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  expect(prompts).toHaveLength(0);
  await input.press("Enter");
  await expect.poll(() => prompts.length).toBe(1);
  await expect(input).toHaveValue("");
});

test("question radio selection keeps backward Tab inside its dialog", async ({
  page,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("Request question fixture");
  await input.press("Enter");
  const question = page.getByRole("dialog", {
    name: "Choose verification depth",
  });
  const selected = question.getByRole("radio", { name: /Full/ });
  await selected.check();
  await expect(selected).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await question.evaluate((el) => el.contains(document.activeElement)),
    await page.evaluate(() => document.activeElement?.outerHTML),
  ).toBe(true);
  await expect(
    question.getByRole("button", { name: "Continue" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(selected).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(question.getByRole("radio", { name: /Fast/ })).toBeChecked();
  await page.keyboard.press("Shift+Tab");
  await expect(
    question.getByRole("button", { name: "Continue" }),
  ).toBeFocused();
});

test("phone search and view menus consume Escape before the sessions drawer", async ({
  page,
}) => {
  await start(page);
  await page.setViewportSize({ width: 390, height: 640 });
  const trigger = page.getByRole("button", { name: "Open sessions" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Sessions and workspaces" });
  const searchTrigger = drawer.getByRole("button", { name: "Search sessions" });
  await searchTrigger.click();
  const search = drawer.getByRole("textbox", { name: "Search sessions" });
  await search.fill("final-input");
  await search.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(searchTrigger).toBeFocused();
  const menuTrigger = drawer.getByRole("button", {
    name: "Session view options",
  });
  await menuTrigger.click();
  const menu = drawer.getByRole("menu", { name: "Session view options" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(menuTrigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});
