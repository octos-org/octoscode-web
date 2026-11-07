import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * T-0392: the usage page reads Core #1376's ledger over its REST routes. The
 * fixture aggregates runs the way Core's UsageAnalytics::from_events does
 * (shapes captured from Core 6fc12da3 in packages/client/tests/fixtures).
 */
const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const DAY = 86_400_000;
const PRICED = "usage-priced-model";
const UNPRICED = "usage-local-model";

const TITLES = Array.from({ length: 10 }, (_, index) =>
  index === 0 ? "Plan the launch" : `Usage session ${index}`,
);
// Runs by listed Session index; -1 is a Session the sidebar does not list.
const RUNS = [
  {
    session: 0,
    ago_ms: 5_000,
    model: PRICED,
    input: 400,
    cache_read: 800,
    output: 300,
    cost: 0.012,
  },
  {
    session: 0,
    ago_ms: 9_000,
    model: PRICED,
    input: 400,
    cache_read: 800,
    output: 300,
    cost: 0.012,
  },
  { session: -1, ago_ms: 7_000, model: UNPRICED, input: 50, output: 5 },
  { session: 1, ago_ms: 3 * DAY, model: UNPRICED, input: 900, output: 90 },
  {
    session: 2,
    ago_ms: 20 * DAY,
    model: PRICED,
    input: 100,
    output: 10,
    cost: 0.002,
  },
  { session: 3, ago_ms: 60 * DAY, model: UNPRICED, input: 10, output: 1 },
];

async function seed(
  request: APIRequestContext,
  workspace: string,
  runs: readonly object[],
) {
  await request.post(`${ORIGIN}/__test__/usage/reset`);
  await request.post(
    `${ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(workspace)}`,
  );
  const response = await request.post(`${ORIGIN}/__test__/usage/seed`, {
    data: { workspace, profile: "_main", sessions: TITLES, runs },
  });
  return ((await response.json()) as { sessionIds: string[] }).sessionIds;
}

async function mode(request: APIRequestContext, query: string) {
  await request.post(`${ORIGIN}/__test__/usage/mode?${query}`);
}

async function reads(request: APIRequestContext) {
  return (await (
    await request.get(`${ORIGIN}/__test__/usage/reads`)
  ).json()) as {
    path: string;
    sessionId: string | null;
    from: string | null;
    bearer: boolean;
    tokenInUrl: boolean;
  }[];
}

async function openUsage(page: Page, workspace: string) {
  await page.goto("/");
  await page.locator("#connection-origin").fill(ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const path = page.getByLabel(/Server workspace path/);
  await path.fill(workspace);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: /Message Octos/ }),
  ).toBeEnabled();
  const entry = page.locator('aside [data-usage-nav="entry"]');
  if (!(await entry.isVisible()))
    await page.getByRole("button", { name: /Open sessions/ }).click();
  await entry.click();
  return page.locator("[data-usage-ledger]");
}

const totals = (usage: ReturnType<Page["locator"]>) =>
  usage.locator("[data-usage-totals]");
const figure = (usage: ReturnType<Page["locator"]>, label: string) =>
  totals(usage)
    .locator("div")
    .filter({ has: usage.page().locator(`dt:text-is("${label}")`) })
    .locator("dd");

test.afterEach(async ({ request }) => {
  await request.post(`${ORIGIN}/__test__/usage/reset`);
});

test("shows the server's totals by model, date and session, and switches without mixing results", async ({
  page,
  request,
}) => {
  const workspace = `/workspace/usage-${Date.now()}`;
  const ids = await seed(request, workspace, RUNS);
  const usage = await openUsage(page, workspace);
  await expect(usage.getByRole("heading", { name: "Usage" })).toBeVisible();

  // Last 30 days: four listed runs plus one from a Session the sidebar does not list.
  await expect(figure(usage, "Runs")).toHaveText("5");
  // Input counts cache reads, as the composer chip does: 2×(400+800) + 50 + 900 + 100.
  await expect(figure(usage, "Input tokens")).toContainText("3,450");
  await expect(figure(usage, "Input tokens")).toContainText("1,600 from cache");
  await expect(figure(usage, "Output tokens")).toHaveText("705");
  await expect(usage.locator("[data-usage-cost]")).toContainText("$0.03");
  await expect(usage.locator("[data-usage-cost]")).toContainText(
    "priced runs only",
  );
  const models = usage.locator('[data-usage-breakdown="model"] tbody tr');
  await expect(models).toHaveCount(2);
  await expect(models.first()).toContainText(PRICED);
  await expect(models.nth(1)).toContainText(UNPRICED);
  await expect(models.nth(1)).toContainText("Not recorded");
  await expect(
    usage.locator('[data-usage-breakdown="day"] tbody tr'),
  ).toHaveCount(3);

  // One read per Session on the page; the token rides only in a header.
  const sessions = usage.locator("[data-usage-sessions] tbody tr");
  await expect(sessions).toHaveCount(8);
  const planRow = usage.locator(`[data-usage-session="${ids[0]}"]`);
  await expect(planRow).toContainText("2");
  await expect(planRow).toContainText("$0.02");
  await expect(usage.locator(`[data-usage-session="${ids[4]}"]`)).toContainText(
    "No runs in this period.",
  );
  let log = await reads(request);
  expect(log.every((entry) => entry.bearer && !entry.tokenInUrl)).toBe(true);
  const readSessions = () =>
    new Set(log.map((entry) => entry.sessionId).filter(Boolean)).size;
  expect(readSessions()).toBe(8);

  // The page's rows are not the totals: the server's count stays 5.
  await usage.getByRole("button", { name: "Next page" }).click();
  await expect(usage.getByText("Page 2 of 2")).toBeVisible();
  await expect(sessions).toHaveCount(3);
  await expect(usage.locator(`[data-usage-session="${ids[9]}"]`)).toBeVisible();
  await expect(figure(usage, "Runs")).toHaveText("5");
  log = await reads(request);
  expect(readSessions()).toBe(11);
  await usage.getByRole("button", { name: "Previous page" }).click();

  // One Session's share, then back to all of them.
  await planRow.getByRole("button", { name: "Plan the launch" }).click();
  await expect(
    usage.getByRole("heading", { name: "One session" }),
  ).toBeVisible();
  await expect(usage.locator("[data-usage-filter]")).toHaveText(
    "Plan the launch",
  );
  await expect(figure(usage, "Runs")).toHaveText("2");
  await expect(models).toHaveCount(1);
  await usage.getByRole("button", { name: "Show all sessions" }).click();
  await expect(figure(usage, "Runs")).toHaveText("5");

  // A slow all-time answer that lands after Today was chosen is never shown.
  await mode(request, "mode=ok&delay_all_ms=1500");
  await usage.getByRole("radio", { name: "All time" }).check();
  await usage.getByRole("radio", { name: "Today" }).check();
  await expect(figure(usage, "Runs")).toHaveText("3");
  await page.waitForTimeout(2_000);
  await expect(figure(usage, "Runs")).toHaveText("3");
  await expect(usage.locator(`[data-usage-session="${ids[1]}"]`)).toContainText(
    "No runs in this period.",
  );
  await mode(request, "mode=ok");
  await usage.getByRole("radio", { name: "All time" }).check();
  await expect(figure(usage, "Runs")).toHaveText("6");
  await usage.getByRole("radio", { name: "Last 7 days" }).check();
  await expect(figure(usage, "Runs")).toHaveText("4");
  const ranges = (await reads(request))
    .filter((entry) => !entry.sessionId)
    .map((entry) => entry.from);
  expect(ranges.at(-1)).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );

  // Nothing from the ledger is kept in the browser.
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain(PRICED);
  expect(stored).not.toContain("estimated_cost");

  const axe = await new AxeBuilder({ page })
    .include("[data-usage-ledger]")
    .analyze();
  expect(axe.violations).toEqual([]);
});

test("an empty ledger, a failed read, an unsupported server and a refresh each say so", async ({
  page,
  request,
}) => {
  const workspace = `/workspace/usage-empty-${Date.now()}`;
  const ids = await seed(request, workspace, []);
  const usage = await openUsage(page, workspace);
  await expect(usage.locator("[data-usage-empty]")).toHaveText(
    "No runs in this period.",
  );
  await usage.getByRole("radio", { name: "All time" }).check();
  await expect(usage.locator("[data-usage-empty]")).toContainText(
    "No runs recorded yet.",
  );

  // A run lands; Refresh shows it.
  await request.post(`${ORIGIN}/__test__/usage/seed`, {
    data: {
      profile: "_main",
      runs: [
        { session: -1, ago_ms: 1_000, model: UNPRICED, input: 7, output: 3 },
      ],
    },
  });
  await usage.getByRole("button", { name: "Refresh" }).click();
  await expect(figure(usage, "Runs")).toHaveText("1");
  // No price: no money, and no "$0.00".
  await expect(usage.locator("[data-usage-cost]")).toContainText(
    "Not recorded",
  );
  await expect(usage.locator("[data-usage-cost]")).not.toContainText("$");

  await mode(request, `mode=ok&fail_session=${encodeURIComponent(ids[1]!)}`);
  await usage.getByRole("button", { name: "Refresh" }).click();
  await expect(usage.locator(`[data-usage-session="${ids[1]}"]`)).toContainText(
    "Couldn't read this session.",
  );
  await expect(figure(usage, "Runs")).toHaveText("1");

  await mode(request, "mode=fail");
  await usage.getByRole("button", { name: "Refresh" }).click();
  const failure = usage.locator('[data-usage-failure="failed"]').first();
  await expect(failure).toContainText(
    "Couldn't read usage. Check the connection and try again.",
  );
  await expect(failure).not.toContainText("analytics");
  await expect(usage.locator("[data-usage-totals]")).toHaveCount(0);
  await mode(request, "mode=ok");
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(figure(usage, "Runs")).toHaveText("1");

  await mode(request, "mode=unsupported");
  await usage.getByRole("button", { name: "Refresh" }).click();
  await expect(
    usage.locator('[data-usage-failure="unsupported"]'),
  ).toContainText("This server does not keep a usage ledger.");
});

test("reads at phone width without spilling sideways", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = `/workspace/usage-phone-${Date.now()}`;
  await seed(request, workspace, RUNS);
  const usage = await openUsage(page, workspace);
  await expect(figure(usage, "Runs")).toHaveText("5");
  await expect(usage.locator("[data-usage-sessions] tbody tr")).toHaveCount(8);
  const spill = await usage.evaluate((element) => {
    const wide = [...element.querySelectorAll("*")].filter(
      (node) => node.getBoundingClientRect().right > window.innerWidth + 1,
    );
    return wide.map((node) => node.outerHTML.slice(0, 80));
  });
  expect(spill).toEqual([]);
  // A row below the fold filters the totals and brings them into view.
  await usage.getByRole("button", { name: "Usage session 1" }).click();
  await expect(figure(usage, "Runs")).toHaveText("1");
  await expect(
    usage.getByRole("heading", { name: "One session" }),
  ).toBeInViewport();
});

test("periods follow the server's UTC clock, never the browser's", async ({
  browser,
  request,
}) => {
  // T-0432: the server pins its clock to 2026-11-06T00:10 UTC; the browser
  // sits at UTC+14 (already 14:10 local). A run at 23:30 UTC the day before
  // is yesterday by the server's clock, though still "today" locally — and
  // local midnight is 10:00 UTC, so a local-midnight window would wrongly
  // include it.
  const context = await browser.newContext({
    timezoneId: "Pacific/Kiritimati",
    // The app keeps its own origin (a different port than the fixture);
    // only the timezone changes.
    baseURL: `http://127.0.0.1:${process.env.OCTOSCODE_E2E_WEB_PORT ?? "4173"}`,
  });
  const page = await context.newPage();
  try {
    const workspace = `/workspace/usage-utc-${Date.now()}`;
    await seed(request, workspace, [
      { session: 0, at: "2026-11-05T23:30:00.000Z", model: UNPRICED, input: 9 },
      { session: 1, at: "2026-11-06T00:05:00.000Z", model: UNPRICED, input: 9 },
    ]);
    // After seeding: seeding resets the fixture ledger, pinned clock included,
    // and an unpinned server answers with the real date.
    await mode(
      request,
      "mode=ok&date=" + encodeURIComponent("Fri, 06 Nov 2026 00:10:00 GMT"),
    );
    const usage = await openUsage(page, workspace);
    await usage.getByRole("radio", { name: "Today" }).check();
    // Only the 00:05 UTC run counts; the window sent is the UTC midnight —
    // and never the browser's local midnight (10:00 UTC at UTC+14).
    await expect(figure(usage, "Runs")).toHaveText("1");
    const sent = await reads(request);
    expect(sent.some((read) => read.from === "2026-11-06T00:00:00.000Z")).toBe(
      true,
    );
    expect(sent.some((read) => read.from === "2026-11-05T10:00:00.000Z")).toBe(
      false,
    );
    await usage.getByRole("radio", { name: "Last 7 days" }).check();
    await expect(figure(usage, "Runs")).toHaveText("2");
    // The by-day rows use the server's UTC keys: yesterday's run lands on
    // 2026-11-05 even though it is still the 5th locally nowhere near UTC+14.
    await expect(usage.locator('[data-usage-breakdown="day"]')).toContainText(
      "2026-11-05",
    );
    await expect(usage.locator('[data-usage-breakdown="day"]')).toContainText(
      "2026-11-06",
    );
  } finally {
    await context.close();
  }
});

test("an auth probe 404 is a retryable failure, never a missing ledger", async ({
  page,
  request,
}) => {
  // T-0432: auth/me 404 (older server, route gone) must not be read as
  // "this server does not keep a usage ledger"; the usage route's own 404
  // still means exactly that.
  const workspace = `/workspace/usage-auth404-${Date.now()}`;
  await seed(request, workspace, RUNS.slice(0, 1));
  await mode(request, "mode=ok&auth_status=404");
  const usage = await openUsage(page, workspace);
  const failure = usage.locator('[data-usage-failure="probe-failed"]');
  await expect(failure).toContainText(
    "Couldn't confirm the sign-in for usage. Try again.",
  );
  await expect(failure).not.toContainText("usage ledger");
  await expect(usage.locator("[data-usage-totals]")).toHaveCount(0);

  // The probe recovers; the ledger then reads normally.
  await mode(request, "mode=ok");
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(figure(usage, "Runs")).toHaveText("1");
});
