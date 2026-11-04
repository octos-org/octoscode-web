import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

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
  return openCronWith(page, /Queue check|No scheduled tasks yet|暂无定时任务/);
}

async function openCronWith(page: Page, firstRow: string | RegExp) {
  const entry = page
    .locator("aside")
    .getByRole("button", { name: /^Scheduled tasks$|^定时任务$/ });
  if (!(await entry.isVisible())) {
    await page
      .getByRole("button", { name: /Open sessions|打开会话列表/ })
      .click();
  }
  await entry.click();
  const tasks = page.locator("[data-scheduled-tasks]");
  await expect(tasks.getByText(firstRow).first()).toBeVisible();
  return tasks;
}

async function openCreate(tasks: Locator) {
  const submit = tasks.getByRole("button", {
    name: /Create scheduled task|创建定时任务/,
  });
  if (!(await submit.isVisible())) {
    await tasks.getByText(/New scheduled task|新建定时任务/).click();
  }
  await expect(submit).toBeVisible();
}

async function useCron(tasks: Locator) {
  if (!(await tasks.getByLabel("Cron expression").isVisible())) {
    await tasks.getByText("Advanced options").click();
  }
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
  const tasks = await openCron(page);
  await openCreate(tasks);

  await tasks.getByRole("radio", { name: "Once" }).check();
  await tasks.getByLabel("Run at").fill("2027-01-02T03:04");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Run once");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const once = tasks.locator('[data-cron-job="cron-2"]');
  await expect(once).toBeVisible();
  await expect(once.getByRole("heading", { name: "Run once" })).toBeVisible();
  await expect(once.getByRole("checkbox")).toBeChecked();
  await expect(once.getByText("Has not run yet")).toBeVisible();
  await expect(tasks.getByText("“Run once” is scheduled.")).toBeVisible();

  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  await tasks.getByLabel("Every", { exact: true }).fill("45");
  await tasks.getByLabel("Unit").selectOption("minutes");
  await tasks.getByRole("radio", { name: "Run tests and report" }).check();
  await expect(
    tasks.getByRole("textbox", { name: "What should Octos do?" }),
  ).toHaveValue(/^Run tests and report\nRun this project's tests\./);
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const interval = tasks.locator('[data-cron-job="cron-3"]');
  await expect(interval).toBeVisible();
  await expect(
    interval.getByRole("heading", { name: "Run tests and report" }),
  ).toBeVisible();
  await expect(interval.getByText("Every 45 minutes")).toBeVisible();

  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "Every week" }).check();
  await tasks.getByRole("combobox", { name: /^Day/ }).selectOption("WED");
  await tasks.getByLabel("Time", { exact: true }).fill("18:30");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Weekly check");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const weekly = tasks.locator('[data-cron-job="cron-4"]');
  await expect(weekly).toBeVisible();
  await expect(weekly.getByText(/^Every Wednesday at 18:30/)).toBeVisible();

  await openCreate(tasks);
  await useCron(tasks);
  await tasks
    .getByLabel("Cron expression", { exact: true })
    .fill("0 0 9 1 * *");
  await tasks.getByLabel("Timezone").fill("UTC");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Cron check");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(tasks.locator('[data-cron-job="cron-5"]')).toBeVisible();
  expect(created.map((params) => params.schedule)).toEqual([
    { kind: "At", at_ms: created[0]!.schedule.at_ms },
    { kind: "Every", every_ms: 2_700_000 },
    { kind: "Cron", expr: "0 30 18 * * WED" },
    { kind: "Cron", expr: "0 0 9 1 * *" },
  ]);
  expect(
    created.every(
      (params) =>
        typeof params.session_id === "string" && params.session_id.length > 0,
    ),
  ).toBe(true);
  expect(created.every((params) => params.mode === "agent")).toBe(true);

  expect(
    (await new AxeBuilder({ page }).include("[data-scheduled-tasks]").analyze())
      .violations,
  ).toEqual([]);
  await once.getByRole("button", { name: "Delete", exact: true }).click();
  await once.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect(once).toHaveCount(0);
  await expect(tasks.locator('[data-cron-job="cron-3"]')).toBeVisible();
});

test("uses the current session scope for list, toggle, create and delete", async ({
  page,
}) => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method?.startsWith("cron/")) {
        calls.push({ method: frame.method, params: frame.params });
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const tasks = await openCron(page);
  await tasks.locator('[data-cron-job="cron-1"]').getByRole("checkbox").click();
  await expect
    .poll(() => calls.some((call) => call.method === "cron/toggle"))
    .toBe(true);

  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Scoped job");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const row = tasks.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect(row).toHaveCount(0);

  const methods = new Set(calls.map((call) => call.method));
  expect(methods).toEqual(
    new Set(["cron/list", "cron/toggle", "cron/create", "cron/delete"]),
  );
  const scopes = new Set(calls.map((call) => call.params.session_id));
  expect(scopes.size).toBe(1);
  expect([...scopes][0]).toEqual(expect.any(String));
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
  const tasks = await openCron(page);
  await expect(tasks.getByText("No scheduled tasks yet.")).toBeVisible();
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  await tasks.getByLabel("Every", { exact: true }).fill("0");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Keep this message");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    tasks.getByText("Enter a whole number from 1 to 10000."),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await tasks.getByRole("radio", { name: "Once" }).check();
  await tasks.getByLabel("Run at").fill("2020-01-01T00:00");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(tasks.getByText("Choose a future date and time.")).toBeVisible();
  expect(createCalls).toBe(0);

  await useCron(tasks);
  await tasks.getByLabel("Cron expression", { exact: true }).fill("0 9 * * *");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    tasks.getByText("Use a cron expression with seconds (six fields)."),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await tasks
    .getByLabel("Cron expression", { exact: true })
    .fill("0 0 9 * * * 2027");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(
    tasks.getByText("Use a cron expression with seconds (six fields)."),
  ).toBeVisible();
  expect(createCalls).toBe(0);

  await tasks.getByLabel("Cron expression", { exact: true }).fill("");
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  await tasks.getByLabel("Every", { exact: true }).fill("30");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect(tasks.getByText("permission denied")).toBeVisible();
  await tasks.getByText("Technical details", { exact: true }).click();
  await expect(
    tasks.getByText("auth_scope_violation", { exact: true }),
  ).toBeVisible();
  await expect(tasks.getByText("No scheduled tasks yet.")).toBeVisible();
  await expect(
    tasks.getByRole("textbox", { name: "What should Octos do?" }),
  ).toHaveValue("Keep this message");
  await expect(
    tasks.getByRole("button", { name: "Create scheduled task" }),
  ).toBeEnabled();
});

test("reports an enabled job without a next run as unschedulable", async ({
  page,
}) => {
  await start(page);
  const tasks = await openCron(page);
  await openCreate(tasks);
  await useCron(tasks);
  await tasks
    .getByLabel("Cron expression", { exact: true })
    .fill("x x x x x x");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Unschedulable job");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const row = tasks.locator('[data-cron-job="cron-2"]');
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
    .getByRole("button", { name: /^Scheduled tasks$/ })
    .click();
  const tasks = page.locator("[data-scheduled-tasks]");
  await expect.poll(() => control.held.length).toBe(1);
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  await tasks.getByLabel("Every", { exact: true }).fill("45");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Made while loading");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => control.held.length).toBe(2);
  for (const release of control.held.splice(0)) release();
  const row = tasks.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  await expect(tasks.getByText("Waiting for the server…")).toHaveCount(0);
  await expect(
    tasks.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();

  control.holdFrom = control.lists + 1;
  await tasks.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => control.held.length).toBe(1);
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect.poll(() => control.held.length).toBe(2);
  for (const release of control.held.splice(0)) release();
  await expect(row).toHaveCount(0);
  await expect(tasks.getByText("Waiting for the server…")).toHaveCount(0);
  await expect(
    tasks.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
});

test("keeps a create success when Refresh serves the list first", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let listRequests = 0;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/list") listRequests += 1;
      if (frame.method === "cron/create" && !release) {
        release = () => server.send(message);
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await start(page);
  const tasks = await openCron(page);
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  const message = tasks.getByRole("textbox", {
    name: "What should Octos do?",
  });
  await message.fill("Refreshed during create");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await tasks.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(tasks.getByText("Waiting for the server…")).toHaveCount(0);
  await expect(tasks.locator('[data-cron-job="cron-2"]')).toHaveCount(0);
  const before = listRequests;
  release!();
  const row = tasks.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveCount(1);
  await openCreate(tasks);
  await expect(message).toHaveValue("");
  await expect.poll(() => listRequests).toBeGreaterThan(before);
});

test("keeps create/delete success when a committed list lands first", async ({
  page,
}) => {
  const requests = new Map<string, string>();
  let heldMethod: string | null = "cron/create";
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      requests.set(String(frame.id), frame.method);
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (requests.get(String(frame.id)) === heldMethod) {
        const method = heldMethod;
        heldMethod = null;
        release = () => socket.send(message);
        expect(method).toMatch(/^cron\/(create|delete)$/);
        return;
      }
      socket.send(message);
    });
  });
  await start(page);
  const tasks = await openCron(page);
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "At an interval" }).check();
  const message = tasks.getByRole("textbox", {
    name: "What should Octos do?",
  });
  await message.fill("Refreshed after commit");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await tasks.getByRole("button", { name: "Refresh", exact: true }).click();
  const row = tasks.locator('[data-cron-job="cron-2"]');
  await expect(row).toBeVisible();
  release!();
  await expect(
    tasks.getByText("“Refreshed after commit” is scheduled."),
  ).toBeVisible();
  await openCreate(tasks);
  await expect(message).toHaveValue("");
  await expect(row).toHaveCount(1);
  await expect(
    tasks.getByRole("button", { name: "Create scheduled task" }),
  ).toBeEnabled();

  heldMethod = "cron/delete";
  release = undefined;
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await tasks.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row).toHaveCount(0);
  release!();
  await expect(row).toHaveCount(0);
  await expect(
    tasks.getByRole("button", { name: "Delete scheduled task" }),
  ).toHaveCount(0);
  await expect(
    tasks.getByRole("button", { name: "Refresh", exact: true }),
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
  const tasks = await openCron(page);
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "Once" }).check();
  await tasks.getByLabel("Run at").fill("2027-01-02T03:04");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Late job");
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
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
  const tasks = await openCron(page);
  await openCreate(tasks);
  await tasks.getByRole("radio", { name: "只运行一次" }).check();
  await tasks.getByLabel("运行时间").fill("2027-01-02T03:04");
  await tasks.getByLabel("要 Octos 做什么？").fill("手机任务");
  const submit = tasks.getByRole("button", { name: "创建定时任务" });
  await submit.focus();
  await page.keyboard.press("Enter");
  const job = tasks.locator('[data-cron-job="cron-2"]');
  await expect(job).toBeVisible();
  await expect(job.getByRole("heading", { name: "手机任务" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("[data-scheduled-tasks]").analyze())
      .violations,
  ).toEqual([]);
  await job.getByRole("button", { name: "删除", exact: true }).click();
  await job.getByRole("button", { name: "删除定时任务" }).click();
  await expect(job).toHaveCount(0);
});

test("shows how each run really went and opens the run it points at", async ({
  page,
}) => {
  const now = Date.now();
  const ago = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();
  const job = (id: string, name: string, lastRun: string, session: string) => ({
    id,
    name,
    enabled: true,
    schedule: { kind: "Every", every_ms: 600_000 },
    message: name,
    channel: null,
    // Core reports ok once the Session accepts the run, whatever happens next.
    last_run: lastRun,
    last_status: "ok",
    last_error: null,
    next_run: now + 300_000,
    next_in: "5m",
    timezone: null,
    origin: { session_id: session, profile_id: "default" },
  });
  const turns = [
    { turn_id: "run-ok", state: "completed", started_at: ago(20) },
    { turn_id: "run-bad", state: "errored", started_at: ago(10) },
    { turn_id: "later-chat", state: "completed", started_at: ago(5) },
  ];
  const message = (seq: number, turnId: string) => ({
    seq,
    role: "assistant",
    content: Array.from(
      { length: 40 },
      (_, line) => `${turnId} line ${line}`,
    ).join("\n\n"),
    turn_id: turnId,
    persisted_at: ago(5),
    media: [],
  });
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    const requests = new Map<
      string,
      { method: string; params: { session_id?: string; include?: string[] } }
    >();
    socket.onMessage((data) => {
      const frame = JSON.parse(String(data));
      requests.set(String(frame.id), frame);
      server.send(data);
    });
    server.onMessage((data) => {
      const frame = JSON.parse(String(data));
      const request = requests.get(String(frame.id));
      if (request?.method === "cron/list" && frame.result) {
        const session = request.params.session_id!;
        frame.result.jobs = [
          job("job-ok", "Weekly report", ago(20.1), session),
          job("job-bad", "Run tests", ago(10.1), session),
          job("job-gone", "Old task", ago(30), "coding:api:gone"),
        ];
        frame.result.count = 3;
      }
      if (request?.method === "session/hydrate" && frame.result) {
        frame.result.turns = turns;
        const include = request.params.include ?? [];
        if (include.includes("threads")) {
          frame.result.messages = turns
            .filter((turn) => turn.state === "completed")
            .map((turn, index) => message(index + 1, turn.turn_id));
        } else if (include.includes("messages")) {
          frame.result.replayed_projection_envelopes = [
            {
              session_id: request.params.session_id,
              thread_id: "run-bad",
              seq: 1,
              turn_id: "run-bad",
              payload: {
                type: "turn_terminal",
                data: {
                  outcome: "errored",
                  error: {
                    code: "turn_failed",
                    message: "The model is down [lanes: provider trace]",
                  },
                },
              },
            },
          ];
          frame.result.projection_thread_sequences = { "run-bad": 1 };
        }
      }
      socket.send(JSON.stringify(frame));
    });
  });
  await start(page);
  const tasks = await openCronWith(page, /^Weekly report$/);

  const ok = tasks.locator('[data-cron-job="job-ok"]');
  const bad = tasks.locator('[data-cron-job="job-bad"]');
  await expect(ok.getByText(/^Success · 20 min ago$/)).toBeVisible();
  await expect(bad.getByText(/^Run failed · 10 min ago$/)).toBeVisible();
  await expect(
    bad.getByText("The model is down", { exact: true }),
  ).toBeVisible();

  const gone = tasks.locator('[data-cron-job="job-gone"]');
  await expect(gone.getByText(/no record of how it went/)).toBeVisible();
  await gone.getByRole("button", { name: "View result" }).click();
  await expect(gone.getByRole("alert")).toContainText("can't be opened here");

  await ok.getByRole("button", { name: "View result" }).click();
  await expect(tasks).toBeHidden();
  const run = page.locator('[data-turn-id="run-ok"]').first();
  await expect(run).toBeInViewport();
  await expect(page.getByText("later-chat line 39")).not.toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Back to latest" }),
  ).toBeVisible();
});
