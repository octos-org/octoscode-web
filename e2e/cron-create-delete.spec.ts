import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

test.beforeEach(async ({ request }) => {
  await request.post(`${ORIGIN}/__test__/cron/reset`);
});

async function start(page: Page) {
  await page.goto("/");
  await page.locator("#connection-origin").fill(ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const path = page.getByLabel(/Server workspace path|服务器工作区路径/);
  await path.fill(`/workspace/cron-create-${Date.now()}`);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: /Message Octos|消息/ }),
  ).toBeEnabled();
}

async function openCron(page: Page) {
  const settingsButton = page
    .locator("aside")
    .getByRole("button", { name: /^Settings$|^设置$/ });
  if (!(await settingsButton.isVisible())) {
    await page
      .getByRole("button", { name: /Open sessions|打开会话列表/ })
      .click();
  }
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: /Settings|设置/ });
  await settings
    .getByRole("button", { name: /Scheduled tasks|定时任务/ })
    .click();
  await expect(
    settings
      .getByText(/Queue check|No scheduled tasks yet|暂无定时任务/)
      .first(),
  ).toBeVisible();
  return settings;
}

async function openCreate(settings: ReturnType<typeof page.getByRole>) {
  await settings.getByText(/New scheduled task|新建定时任务/).click();
}

test("creates At, Every and Cron jobs, then deletes one after confirmation", async ({
  page,
}) => {
  const created: Array<{
    session_id: string;
    schedule: Record<string, unknown>;
    mode: string;
  }> = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/create") created.push(frame.params);
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const settings = await openCron(page);
  await openCreate(settings);

  await settings.getByLabel("Run at").fill("2027-01-02T03:04");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Run once");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  const once = settings.locator('[data-cron-job="cron-2"]');
  await expect(once).toBeVisible();
  await expect(
    once.getByText("Run once", { exact: true }).first(),
  ).toBeVisible();
  await expect(once.getByRole("checkbox")).toBeChecked();
  await expect(once.getByText(/Next run:/)).toBeVisible();
  await expect(once.getByText("Last run: Never")).toBeVisible();

  await settings.getByLabel("Schedule type").selectOption("Every");
  await settings.getByLabel("Every (minutes)").fill("45");
  await settings.getByLabel("Delivery").selectOption("notify");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Recurring check");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(settings.locator('[data-cron-job="cron-3"]')).toBeVisible();

  await settings.getByLabel("Schedule type").selectOption("Cron");
  await settings
    .getByLabel("Cron expression", { exact: true })
    .fill("0 0 9 * * *");
  await settings.getByLabel("Timezone (optional)").fill("UTC");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Cron check");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(settings.locator('[data-cron-job="cron-4"]')).toBeVisible();
  expect(created.map((params) => params.schedule)).toEqual([
    { kind: "At", at_ms: created[0]!.schedule.at_ms },
    { kind: "Every", every_ms: 2_700_000 },
    { kind: "Cron", expr: "0 0 9 * * *" },
  ]);
  expect(
    created.every(
      (params) =>
        typeof params.session_id === "string" && params.session_id.length > 0,
    ),
  ).toBe(true);
  expect(created.map((params) => params.mode)).toEqual([
    "agent",
    "notify",
    "agent",
  ]);

  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(settings).toHaveScreenshot("cron-create-delete.png", SNAPSHOT);
  await once.getByRole("button", { name: "Delete", exact: true }).click();
  await once.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect(once).toHaveCount(0);
  await expect(settings.locator('[data-cron-job="cron-3"]')).toBeVisible();
});

test("keeps an empty list and retry state after invalid input and server refusal", async ({
  page,
}) => {
  let createCalls = 0;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/create") {
        createCalls += 1;
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: {
              code: -32000,
              message: "permission denied",
              data: { detail: "auth_scope_violation" },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await page.request.post(`${ORIGIN}/__test__/cron/empty`);
  await start(page);
  const settings = await openCron(page);
  await expect(settings.getByText("No scheduled tasks yet.")).toBeVisible();
  await openCreate(settings);
  await settings.getByLabel("Schedule type").selectOption("Every");
  await settings.getByLabel("Every (minutes)").fill("0");
  await settings
    .getByLabel("Message", { exact: true })
    .fill("Keep this message");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    settings.getByText("Enter a whole number of minutes greater than zero."),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await settings.getByLabel("Schedule type").selectOption("At");
  await settings.getByLabel("Run at").fill("2020-01-01T00:00");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    settings.getByText("Choose a future date and time."),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await settings.getByLabel("Schedule type").selectOption("Cron");
  await settings
    .getByLabel("Cron expression", { exact: true })
    .fill("0 9 * * *");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    settings.getByText(
      "Use a cron expression with seconds (six or seven fields).",
    ),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await settings.getByLabel("Schedule type").selectOption("Every");
  await settings.getByLabel("Every (minutes)").fill("30");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(settings.getByText("permission denied")).toBeVisible();
  await settings.getByText("Technical details", { exact: true }).click();
  await expect(
    settings.getByText("auth_scope_violation", { exact: true }),
  ).toBeVisible();
  await expect(settings.getByText("No scheduled tasks yet.")).toBeVisible();
  await expect(
    settings.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep this message");
  await expect(
    settings.getByRole("button", { name: "Create scheduled task" }),
  ).toBeEnabled();
});

test("reports an enabled job without a next run as unschedulable", async ({
  page,
}) => {
  await start(page);
  const settings = await openCron(page);
  await openCreate(settings);
  await settings.getByLabel("Schedule type").selectOption("Cron");
  await settings
    .getByLabel("Cron expression", { exact: true })
    .fill("x x x x x x");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Unschedulable job");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  const row = settings.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  await expect(row.getByRole("alert")).toHaveText(
    "This enabled task has no next run and is not scheduled. Check its schedule and server version.",
  );
});

test("refetches and releases loading when create/delete invalidate a list", async ({
  page,
}) => {
  const control = {
    holdFrom: 1,
    lists: 0,
    held: [] as (() => void)[],
  };
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    const lists = new Set<string>();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/list") {
        control.lists += 1;
        if (control.lists >= control.holdFrom) lists.add(String(frame.id));
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (lists.delete(String(frame.id))) {
        control.held.push(() => socket.send(message));
        return;
      }
      socket.send(message);
    });
  });
  await start(page);
  await page
    .locator("aside")
    .getByRole("button", { name: /^Settings$/ })
    .click();
  const settings = page.getByRole("dialog", { name: /Settings|设置/ });
  await settings.getByRole("button", { name: /Scheduled tasks/ }).click();
  await expect.poll(() => control.held.length).toBe(1);
  await openCreate(settings);
  await settings.getByLabel("Schedule type").selectOption("Every");
  await settings.getByLabel("Every (minutes)").fill("45");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Made while loading");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => control.held.length).toBe(2);
  for (const release of control.held.splice(0)) release();
  const row = settings.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  await expect(settings.getByText("Waiting for the server…")).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();

  control.holdFrom = control.lists + 1;
  await settings.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => control.held.length).toBe(1);
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect.poll(() => control.held.length).toBe(2);
  for (const release of control.held.splice(0)) release();
  await expect(row).toHaveCount(0);
  await expect(settings.getByText("Waiting for the server…")).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
});

test("ignores a late create response after the session view changes", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/create") {
        release = () => server.send(message);
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const settings = await openCron(page);
  await openCreate(settings);
  await settings.getByLabel("Run at").fill("2027-01-02T03:04");
  await settings
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Late job");
  await settings.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await settings.getByRole("button", { name: /Close/ }).click();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const next = await openCron(page);
  await openCreate(next);
  release?.();
  await expect(next.locator('[data-cron-job="cron-2"]')).toHaveCount(0);
  await expect(
    next.getByRole("button", { name: "Create scheduled task" }),
  ).toBeEnabled();
});

test("creates and deletes with Chinese labels on a phone using the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "octoscode.web.display.v1",
      JSON.stringify({
        version: 1,
        theme: "terminal",
        language: "zh",
        vimMode: false,
      }),
    );
  });
  await start(page);
  const settings = await openCron(page);
  await openCreate(settings);
  await settings.getByLabel("运行时间").fill("2027-01-02T03:04");
  await settings.getByLabel("消息", { exact: true }).fill("手机任务");
  const submit = settings.getByRole("button", { name: "创建定时任务" });
  await submit.focus();
  await page.keyboard.press("Enter");
  const job = settings.locator('[data-cron-job="cron-2"]');
  await expect(job).toBeVisible();
  await expect(
    job.getByText("手机任务", { exact: true }).first(),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(settings).toHaveScreenshot("cron-mobile-zh.png", SNAPSHOT);
  await job.getByRole("button", { name: "删除", exact: true }).click();
  await job.getByRole("button", { name: "删除定时任务" }).click();
  await expect(job).toHaveCount(0);
});
