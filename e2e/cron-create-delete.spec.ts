import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session";

test.beforeEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/cron/reset`);
});

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
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "cron/create") created.push(frame.params);
      if (frame.method?.startsWith("cron/")) {
        calls.push({ method: frame.method, params: frame.params });
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await startSession(page, `/workspace/cron-create-${Date.now()}`);
  const tasks = await openCron(page);
  await tasks.locator('[data-cron-job="cron-1"]').getByRole("checkbox").click();
  await expect
    .poll(() => calls.some((call) => call.method === "cron/toggle"))
    .toBe(true);
  await openCreate(tasks);

  await tasks.getByRole("radio", { name: "Once" }).check();
  await tasks.getByLabel("Run at").fill("2027-01-02T03:04");
  await tasks
    .getByRole("textbox", { name: "What should Octos do?" })
    .fill("Run once");
  // A one-time run outside the current year must name the year, both in the
  // creation summary and later in the list (T-0352).
  await expect(tasks.getByText(/Once, on .*(2027)/)).toBeVisible();
  await tasks.getByRole("button", { name: "Create scheduled task" }).click();
  const once = tasks.locator('[data-cron-job="cron-2"]');
  await expect(once).toBeVisible();
  await expect(once.getByRole("heading", { name: "Run once" })).toBeVisible();
  await expect(once.getByRole("checkbox")).toBeChecked();
  await expect(once.getByText("Has not run yet")).toBeVisible();
  await expect(once.getByText(/Once, on .*(2027)/)).toBeVisible();
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
  expect(created.every((params) => params.mode === "agent")).toBe(true);

  expect(
    (await new AxeBuilder({ page }).include("[data-scheduled-tasks]").analyze())
      .violations,
  ).toEqual([]);
  await once.getByRole("button", { name: "Delete", exact: true }).click();
  await once.getByRole("button", { name: "Delete scheduled task" }).click();
  await expect(once).toHaveCount(0);
  await expect(interval).toBeVisible();
  // List, toggle, create and delete all name the current session's scope.
  expect(new Set(calls.map((call) => call.method))).toEqual(
    new Set(["cron/list", "cron/toggle", "cron/create", "cron/delete"]),
  );
  const scopes = new Set(calls.map((call) => call.params.session_id));
  expect(scopes.size).toBe(1);
  expect([...scopes][0]).toEqual(expect.any(String));
  // Scheduled tasks belongs to the open Session, so a new Session closes it: a
  // late cron reply never has another Session's list to land in (T-0586).
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(tasks).toHaveCount(0);
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
        frame.result.turns = turns.map((turn) => ({
          ...turn,
          thread_id: turn.turn_id,
        }));
        const include = request.params.include ?? [];
        if (include.includes("threads")) {
          // As Core keeps them: a person's turn opens with their message, a
          // scheduled run's with the reply (its prompt is not kept).
          frame.result.messages = [
            message(1, "run-ok"),
            message(2, "run-bad"),
            { ...message(3, "later-chat"), role: "user", content: "hi" },
            message(4, "later-chat"),
          ];
          frame.result.threads = [
            { thread_id: "run-ok", root_seq: 1, message_seqs: [1] },
            { thread_id: "run-bad", root_seq: 2, message_seqs: [2] },
            { thread_id: "later-chat", root_seq: 3, message_seqs: [3, 4] },
          ];
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
  await startSession(page, `/workspace/cron-create-${Date.now()}`);
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
  await gone.getByRole("button", { name: "Open conversation" }).click();
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
