import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session";
import { axeViolations } from "./axe";

/**
 * T-0392: the usage page reads Core #1376's ledger over its REST routes. The
 * fixture aggregates runs the way Core's UsageAnalytics::from_events does
 * (shapes captured from Core 6fc12da3 in packages/client/tests/fixtures).
 */
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
  await request.post(`${FIXTURE_ORIGIN}/__test__/usage/reset`);
  await request.post(
    `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(workspace)}`,
  );
  const response = await request.post(`${FIXTURE_ORIGIN}/__test__/usage/seed`, {
    data: { workspace, profile: "_main", sessions: TITLES, runs },
  });
  return ((await response.json()) as { sessionIds: string[] }).sessionIds;
}

async function mode(request: APIRequestContext, query: string) {
  await request.post(`${FIXTURE_ORIGIN}/__test__/usage/mode?${query}`);
}

async function reads(request: APIRequestContext) {
  return (await (
    await request.get(`${FIXTURE_ORIGIN}/__test__/usage/reads`)
  ).json()) as {
    path: string;
    sessionId: string | null;
    from: string | null;
    bearer: boolean;
    tokenInUrl: boolean;
  }[];
}

async function openUsage(page: Page, workspace: string) {
  await startSession(page, workspace);
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
  await request.post(`${FIXTURE_ORIGIN}/__test__/usage/reset`);
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

  expect(await axeViolations(page, "[data-usage-ledger]")).toEqual([]);
});
