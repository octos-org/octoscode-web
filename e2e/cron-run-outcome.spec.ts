import { expect, test, type Page } from "@playwright/test";

/**
 * T-0369: a run is only tied to a turn the server started near it; a person's
 * turn is never a run's result, and run times are read against the server's
 * clock, not this browser's. The cron list and the Session's turns are
 * rewritten on the wire in the shapes Core b95e756f returned in the T-0369
 * probe: a person's turn opens with their message, a scheduled run's with the
 * reply.
 */
const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

interface Turn {
  id: string;
  state: string;
  at: number;
  by: "person" | "system" | "unknown";
}
interface Job {
  id: string;
  name: string;
  lastRun: number;
  /** Turned off: Core lists no next run, so nothing gives its clock away. */
  off?: boolean;
}

async function start(page: Page) {
  await page.goto("/");
  await page.locator("#connection-origin").fill(ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const path = page.getByLabel(/Server workspace path|服务器工作区路径/);
  await path.fill(`/workspace/cron-outcome-${Date.now()}`);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: /Message Octos|消息/ }),
  ).toBeEnabled();
}

async function openTasks(page: Page, firstRow: string) {
  const entry = page
    .locator("aside")
    .getByRole("button", { name: /^Scheduled tasks$|^定时任务$/ });
  if (!(await entry.isVisible()))
    await page
      .getByRole("button", { name: /Open sessions|打开会话列表/ })
      .click();
  await entry.click();
  const tasks = page.locator("[data-scheduled-tasks]");
  await expect(tasks.getByText(firstRow).first()).toBeVisible();
  return tasks;
}

/** Serves `jobs` from cron/list and `turns()` from hydrate; counts the turn reads. */
async function serve(
  page: Page,
  serverNow: () => number,
  jobs: Job[],
  turns: (read: number) => { list: Turn[]; withThreads: boolean },
) {
  const reads = { count: 0 };
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
        const now = serverNow();
        const session = request.params.session_id!;
        // next_in is the server's own rounding of next_run − now.
        frame.result.jobs = jobs.map((job) => ({
          id: job.id,
          name: job.name,
          enabled: !job.off,
          schedule: { kind: "Every", every_ms: 3_600_000 },
          message: job.name,
          channel: null,
          last_run: new Date(job.lastRun).toISOString(),
          last_status: "ok",
          last_error: null,
          next_run: job.off ? null : now + 42_500,
          next_in: job.off ? null : "42s",
          timezone: null,
          origin: { session_id: session, profile_id: "default" },
        }));
        frame.result.count = jobs.length;
      }
      const include = request?.params.include ?? [];
      // The scheduled-task page's reads only; the conversation view's own
      // hydrate (which also asks for pending approvals) is left alone.
      if (
        request?.method === "session/hydrate" &&
        frame.result &&
        include.includes("turns") &&
        !include.includes("pending_approvals")
      ) {
        reads.count += 1;
        const { list, withThreads } = turns(reads.count);
        frame.result.turns = list.map((turn) => ({
          turn_id: turn.id,
          state: turn.state,
          started_at: new Date(turn.at).toISOString(),
          thread_id: turn.id,
        }));
        frame.result.messages = list.flatMap((turn, index) =>
          turn.by === "unknown"
            ? []
            : [
                {
                  seq: index * 2,
                  role: turn.by === "person" ? "user" : "assistant",
                  content: `${turn.id} ${turn.by}`,
                  persisted_at: new Date(turn.at).toISOString(),
                  media: [],
                },
              ],
        );
        if (withThreads)
          frame.result.threads = list.map((turn, index) => ({
            thread_id: turn.id,
            root_seq: index * 2,
            message_seqs: [index * 2],
          }));
        else delete frame.result.threads;
      }
      socket.send(JSON.stringify(frame));
    });
  });
  return reads;
}

const row = (page: Page, id: string) => page.locator(`[data-cron-job="${id}"]`);

test("a person's turn is never a run's result, and an unclear match says so", async ({
  page,
}) => {
  const now = Date.now();
  const min = 60_000;
  const jobs: Job[] = [
    // A reminder that delivers text and starts no turn; the person writes
    // 0.6 s later and their turn fails.
    { id: "notify", name: "Drink water", lastRun: now - 30 * min },
    // Two jobs a minute apart, each with its own turn.
    { id: "a", name: "Morning report", lastRun: now - 20 * min },
    { id: "b", name: "Run tests", lastRun: now - 19 * min },
    // Two jobs that fired together: two turns, no way to tell which is whose.
    { id: "c", name: "Backup", lastRun: now - 15 * min },
    { id: "d", name: "Sync", lastRun: now - 15 * min + 30 },
    // A turn too long after its run.
    { id: "e", name: "Weekly digest", lastRun: now - 10 * min },
    // A run whose turn is still going; later reads lose the threads.
    { id: "f", name: "Long check", lastRun: now - 2 * min },
  ];
  const base: Turn[] = [
    { id: "mine", state: "errored", at: now - 30 * min + 600, by: "person" },
    { id: "ta", state: "completed", at: now - 20 * min + 900, by: "system" },
    { id: "tb", state: "errored", at: now - 19 * min + 1_100, by: "system" },
    { id: "tc", state: "completed", at: now - 15 * min + 1_900, by: "system" },
    { id: "td", state: "completed", at: now - 15 * min + 3_900, by: "system" },
    { id: "te", state: "completed", at: now - 10 * min + 45_000, by: "system" },
  ];
  const reads = await serve(
    page,
    () => Date.now(),
    jobs,
    (read) => ({
      list: [
        ...base,
        {
          id: "tf",
          state: read === 1 ? "active" : "completed",
          at: now - 2 * min + 800,
          by: read === 1 ? "system" : "unknown",
        },
      ],
      withThreads: read === 1,
    }),
  );
  await start(page);
  const tasks = await openTasks(page, "Drink water");

  const notify = row(page, "notify");
  await expect(
    notify.getByText(/^Ran; it started no reply here/),
  ).toBeVisible();
  await expect(notify.getByText(/Run failed/)).toHaveCount(0);
  await expect(
    notify.getByRole("button", { name: "Open conversation" }),
  ).toBeVisible();

  await expect(
    row(page, "a").getByText(/^Success · 20 min ago$/),
  ).toBeVisible();
  await expect(
    row(page, "b").getByText(/^Run failed · 19 min ago$/),
  ).toBeVisible();
  for (const id of ["c", "d"])
    await expect(
      row(page, id).getByText(/^Ran; can't tell which reply is this run's/),
    ).toBeVisible();
  await expect(
    row(page, "e").getByText(/^Ran; a reply came too late/),
  ).toBeVisible();

  // Running first; the next read has no threads, yet the link stands and
  // the finished state comes through.
  const long = row(page, "f");
  await expect(long.getByText(/^Running/)).toBeVisible();
  await expect(long.getByText(/^Success · 2 min ago$/)).toBeVisible({
    timeout: 20_000,
  });
  expect(reads.count).toBeGreaterThanOrEqual(2);

  // The result button still jumps to the run's own turn.
  await row(page, "a").getByRole("button", { name: "View result" }).click();
  await expect(tasks).toBeHidden();
});

for (const skew of [-3_600_000, 3_600_000]) {
  test(`a browser clock ${skew < 0 ? "an hour behind" : "an hour ahead"} neither waits forever nor rereads`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const real = Date.now();
    await page.clock.setSystemTime(real + skew);
    // A reminder that ran 40 s ago by the server's clock and started no turn.
    const reads = await serve(
      page,
      () => Date.now(),
      [{ id: "notify", name: "Stand up", lastRun: real - 40_000 }],
      () => ({ list: [], withThreads: true }),
    );
    await start(page);
    await openTasks(page, "Stand up");
    const notify = row(page, "notify");
    // Loading takes a while, so "just now" or "1 min ago"; an hour off
    // either way would say "1 hr ago" or nothing at all.
    const settled = notify.getByText(
      /^Ran; it started no reply here · (just now|1 min ago)$/,
    );
    await expect(settled).toBeVisible();
    await expect(notify.getByText(/Within a minute/)).toBeVisible();
    // Two list beats later it has not gone back to read again.
    await page.waitForTimeout(21_000);
    expect(reads.count).toBe(1);
    await expect(settled).toBeVisible();
  });
}

test("with every job turned off and the browser an hour ahead, runs show their date", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const real = Date.now();
  await page.clock.setSystemTime(real + 3_600_000);
  await serve(
    page,
    () => Date.now(),
    [{ id: "notify", name: "Stand up", lastRun: real - 5 * 60_000, off: true }],
    () => ({ list: [], withThreads: true }),
  );
  await start(page);
  await openTasks(page, "Stand up");
  const last = row(page, "notify").locator("dd").nth(1);
  // With no server clock in the list, the window closes by this page's own
  // steady clock: a few beats, not forever.
  await expect(last).toContainText("Ran; it started no reply here · ", {
    timeout: 30_000,
  });
  // Nothing pins the server's clock, so no "1 hr ago" from this browser's.
  await expect(last).not.toContainText(/ago|just now/);
});
