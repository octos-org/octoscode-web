import { expect, test, type Page } from "@playwright/test";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";

const CWD = "/srv/work/expert-teams";

interface SentFrame {
  method: string;
  params?: Record<string, unknown>;
}

function observe(page: Page): SentFrame[] {
  const sent: SentFrame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload)) as SentFrame;
      if (frame.method) sent.push(frame);
    });
  });
  return sent;
}

async function openExperts(page: Page) {
  await page.locator('aside [data-experts-nav="entry"]').click();
  const center = page.locator("[data-expert-center]");
  await expect(
    center.getByRole("heading", { name: "Expert teams", level: 2 }),
  ).toBeVisible();
  return center;
}

async function startTeam(page: Page, goal: string, template = "plan-review") {
  const center = page.locator("[data-expert-center]");
  const row = center.locator(`[data-expert-template="${template}"]`);
  await row.getByRole("button", { name: "Choose" }).click();
  await row.getByRole("textbox").fill(goal);
  await row.getByRole("button", { name: /^Start \d experts$/ }).click();
  return row;
}

const prepares = (sent: SentFrame[]) =>
  sent.filter((frame) => frame.method === "peer/prepare");
const memberStarts = (sent: SentFrame[]) =>
  sent.filter(
    (frame) =>
      frame.method === "turn/start" &&
      String(frame.params?.session_id).includes("#peer-"),
  );
const masterStarts = (sent: SentFrame[]) =>
  sent.filter(
    (frame) =>
      frame.method === "turn/start" &&
      !String(frame.params?.session_id).includes("#peer-"),
  );
const turnText = (frame: SentFrame) =>
  JSON.stringify(
    (frame.params?.input as { text: string }[] | undefined)?.[0]?.text ?? "",
  );

test.beforeEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/usage/reset");
});

test("starts a team, shows each member's progress and result, and merges them here", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connectAndStartWorkspace(page, CWD);
  const center = await openExperts(page);
  await expect(center.locator("[data-expert-template]")).toHaveCount(6);

  const row = center.locator('[data-expert-template="plan-review"]');
  await row.getByRole("button", { name: "Choose" }).click();
  await expect(row.getByText("Risk reviewer", { exact: true })).toBeVisible();
  await expect(row.getByText(/roughly 4 times the usage/)).toBeVisible();
  await row.getByRole("button", { name: "Start 3 experts" }).click();
  await expect(
    row.getByText("Describe what the experts should work on."),
  ).toBeVisible();
  expect(prepares(sent)).toHaveLength(0);

  await row.getByRole("textbox").fill("Review docs/plan.md for the launch.");
  await row.getByRole("button", { name: "Start 3 experts" }).click();
  await expect(
    center.getByText("Plan review started: 3 experts are working."),
  ).toBeVisible();

  // One staging call for the whole team; each member is opened and started
  // with its own angle on top of the shared brief.
  expect(prepares(sent)).toHaveLength(1);
  const prepare = prepares(sent)[0]!.params!;
  expect(prepare.n).toBe(3);
  const names = prepare.names as string[];
  expect(names).toEqual([
    expect.stringMatching(/^Feasibility reviewer · [0-9a-f]{4}-1$/),
    expect.stringMatching(/^Risk reviewer · [0-9a-f]{4}-2$/),
    expect.stringMatching(/^User reviewer · [0-9a-f]{4}-3$/),
  ]);
  expect(String(prepare.brief)).toMatch(/^Octoscode expert team: plan-review /);
  await expect.poll(() => memberStarts(sent).length).toBe(3);
  for (const name of names)
    expect(
      memberStarts(sent).filter((frame) =>
        turnText(frame).includes(`You are “${name}”`),
      ),
    ).toHaveLength(1);

  const team = center.locator("[data-expert-team]");
  await expect(team).toHaveCount(1);
  await expect(
    team.getByText("Review docs/plan.md for the launch."),
  ).toBeVisible();
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(3, {
    timeout: 20_000,
  });
  await expect(team.getByText("3 of 3 done")).toBeVisible();
  await expect(
    team.getByText(
      /Risk reviewer · [0-9a-f]{4}-2: the most important problem is example problem 2/,
    ),
  ).toBeVisible();
  // The server's front matter is not shown.
  await expect(team.getByText(/outcome: completed/)).toHaveCount(0);

  const before = masterStarts(sent).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect(page.locator("[data-expert-center]")).toHaveCount(0);
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain("These are the results of the Plan review team");
  expect(merge).toContain("Merge the reviews into one report");
  expect(merge).toContain("Peer results gathered from the blackboard");
  expect(merge).not.toContain("These experts have no result");
});

const interrupts = (sent: SentFrame[]) =>
  sent.filter((frame) => frame.method === "turn/interrupt");

test("a failed member is named, a working member survives a refresh and is stopped once, and the merge leaves both out", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sent = observe(page);
  await connectAndStartWorkspace(page, CWD);
  const center = await openExperts(page);
  await startTeam(page, "Check the release notes. [slow-seat-2] [fail-seat-3]");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(team.locator('[data-expert-state="failed"]')).toHaveCount(1);
  await expect(team.locator('[data-expert-state="working"]')).toHaveCount(1);
  const failed = team.locator('[data-expert-member$="-3"]');
  await failed.getByText("Technical details").click();
  await expect(failed.getByText(/stub model is down/)).toBeVisible();
  const slowStart = memberStarts(sent).find((frame) =>
    String(frame.params?.session_id).endsWith("-2"),
  )!;

  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  const rebuilt = again.locator("[data-expert-team]");
  await expect(rebuilt).toHaveCount(1);
  await expect(rebuilt.getByText("Check the release notes.")).toBeVisible();
  // Finished and failed come from the blackboard; the slow member's own
  // session says it is still running, so it is working, with a Stop.
  await expect(rebuilt.locator('[data-expert-state="finished"]')).toHaveCount(
    1,
  );
  await expect(rebuilt.locator('[data-expert-state="failed"]')).toHaveCount(1);
  const slow = rebuilt.locator('[data-expert-member$="-2"]');
  await expect(slow.locator('[data-expert-state="working"]')).toBeVisible();
  await expect(slow.getByText(/It may still be working/)).toHaveCount(0);
  expect(interrupts(sent)).toHaveLength(0);

  await slow.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => interrupts(sent).length).toBe(1);
  // Exactly the turn the member was running, in its own session.
  expect(interrupts(sent)[0]!.params).toEqual({
    session_id: slowStart.params!.session_id,
    turn_id: slowStart.params!.turn_id,
  });
  await expect(slow.locator('[data-expert-state="stopped"]')).toBeVisible();
  await expect(slow.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(
    rebuilt.getByText("1 of 3 done · 1 did not finish · 1 stopped"),
  ).toBeVisible();
  await expect(
    rebuilt.getByText(
      "2 experts have no result yet. Merging now leaves their part out.",
    ),
  ).toBeVisible();

  // Another refresh: still stopped, from the member's session, and nothing
  // is stopped again.
  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const third = (await openExperts(page)).locator("[data-expert-team]");
  const slowAgain = third.locator('[data-expert-member$="-2"]');
  await expect(
    slowAgain.locator('[data-expert-state="stopped"]'),
  ).toBeVisible();
  await expect(slowAgain.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(third.locator('[data-expert-state="failed"]')).toHaveCount(1);
  expect(interrupts(sent)).toHaveLength(1);
  const accepted = await (
    await request.get(FIXTURE_ORIGIN + "/__test__/experts/interrupts")
  ).json();
  expect(accepted).toHaveLength(1);

  // The merge reads only the member with a result.
  const before = masterStarts(sent).length;
  await third
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const gathers = sent.filter((frame) => frame.method === "peer/gather");
  expect(gathers.at(-1)!.params!.slugs).toEqual([expect.stringMatching(/-1$/)]);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain("These experts have no result");
  expect(merge).toContain("Risk reviewer (Stopped)");
  expect(merge).toContain("User reviewer (Failed)");
});

test("a reconnect keeps a working member working, and sends no stop by itself", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connectAndStartWorkspace(page, CWD);
  const center = await openExperts(page);
  await startTeam(page, "Read the changelog. [slow-seat-2]");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(2, {
    timeout: 20_000,
  });
  const slow = team.locator('[data-expert-member$="-2"]');
  await expect(slow.locator('[data-expert-state="working"]')).toBeVisible();

  const sockets = sent.filter(
    (frame) => frame.method === "session/open",
  ).length;
  expect(
    (await request.post(FIXTURE_ORIGIN + "/__test__/disconnect")).status(),
  ).toBe(204);
  // The page reconnects and reopens its sessions on its own.
  await expect
    .poll(() => sent.filter((frame) => frame.method === "session/open").length)
    .toBeGreaterThan(sockets);
  // The reconnect returns the page to the conversation; come back.
  const back = await openExperts(page);
  const slowBack = back.locator('[data-expert-member$="-2"]');
  await expect(slowBack.locator('[data-expert-state="working"]')).toBeVisible();
  expect(interrupts(sent)).toHaveLength(0);

  await slowBack.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => interrupts(sent).length).toBe(1);
  await expect(slowBack.locator('[data-expert-state="stopped"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    back.locator('[data-expert-team] [data-expert-state="finished"]'),
  ).toHaveCount(2);
  expect(interrupts(sent)).toHaveLength(1);
});
