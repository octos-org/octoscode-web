import { expect, test, type Page } from "@playwright/test";
import { disconnect } from "./fixture-controls";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import { observeFrames, type WireFrame } from "./turn-observers";

const CWD = "/srv/work/expert-teams";
type Wire = ReturnType<typeof observeFrames>;

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

const memberStarts = (wire: Wire) =>
  wire
    .calls("turn/start")
    .filter((frame) => String(frame.params?.session_id).includes("#peer-"));
const masterStarts = (wire: Wire) =>
  wire
    .calls("turn/start")
    .filter((frame) => !String(frame.params?.session_id).includes("#peer-"));
const turnText = (frame: WireFrame) =>
  JSON.stringify(frame.params?.input?.[0]?.text ?? "");

test.beforeEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/usage/reset");
});

test("starts a team, shows each member's progress and result, and merges them here", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const wire = observeFrames(page);
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
  expect(wire.calls("peer/prepare")).toHaveLength(0);

  await row.getByRole("textbox").fill("Review docs/plan.md for the launch.");
  await row.getByRole("button", { name: "Start 3 experts" }).click();
  await expect(
    center.getByText("Plan review started: 3 experts are working."),
  ).toBeVisible();

  // One staging call for the whole team; each member is opened and started
  // with its own angle on top of the shared brief.
  expect(wire.calls("peer/prepare")).toHaveLength(1);
  const prepare = wire.calls("peer/prepare")[0]!.params!;
  expect(prepare.n).toBe(3);
  const names = prepare.names as string[];
  expect(names).toEqual([
    expect.stringMatching(/^Feasibility reviewer · [0-9a-f]{4}-1$/),
    expect.stringMatching(/^Risk reviewer · [0-9a-f]{4}-2$/),
    expect.stringMatching(/^User reviewer · [0-9a-f]{4}-3$/),
  ]);
  expect(String(prepare.brief)).toMatch(/^Octoscode expert team: plan-review /);
  await expect.poll(() => memberStarts(wire).length).toBe(3);
  for (const name of names)
    expect(
      memberStarts(wire).filter((frame) =>
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

  const before = masterStarts(wire).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect(page.locator("[data-expert-center]")).toHaveCount(0);
  await expect.poll(() => masterStarts(wire).length).toBe(before + 1);
  const merge = turnText(masterStarts(wire).at(-1)!);
  expect(merge).toContain("These are the results of the Plan review team");
  expect(merge).toContain("Merge the reviews into one report");
  expect(merge).toContain("Peer results gathered from the blackboard");
  expect(merge).not.toContain("These experts have no result");
});

test("a failed member is named, a working member survives a refresh and is stopped once, and the merge leaves both out", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const wire = observeFrames(page);
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
  const slowStart = memberStarts(wire).find((frame) =>
    String(frame.params?.session_id).endsWith("-2"),
  )!;

  // A dropped transport keeps the member this tab started working: the page
  // reopens its sessions on its own and stops nothing by itself.
  const opens = wire.calls("session/open").length;
  await disconnect(request);
  await expect
    .poll(() => wire.calls("session/open").length)
    .toBeGreaterThan(opens);
  // The reconnect returns the page to the conversation; come back.
  await openExperts(page);
  await expect(
    team.locator('[data-expert-member$="-2"] [data-expert-state="working"]'),
  ).toBeVisible();
  expect(wire.calls("turn/interrupt")).toHaveLength(0);

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
  expect(wire.calls("turn/interrupt")).toHaveLength(0);

  await slow.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => wire.calls("turn/interrupt").length).toBe(1);
  // Exactly the turn the member was running, in its own session.
  expect(wire.calls("turn/interrupt")[0]!.params).toEqual({
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
  expect(wire.calls("turn/interrupt")).toHaveLength(1);
  const accepted = await (
    await request.get(FIXTURE_ORIGIN + "/__test__/experts/interrupts")
  ).json();
  expect(accepted).toHaveLength(1);

  // The merge reads only the member with a result.
  const before = masterStarts(wire).length;
  await third
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(wire).length).toBe(before + 1);
  const gathers = wire.calls("peer/gather");
  expect(gathers.at(-1)!.params!.slugs).toEqual([expect.stringMatching(/-1$/)]);
  const merge = turnText(masterStarts(wire).at(-1)!);
  expect(merge).toContain("These experts have no result");
  expect(merge).toContain("Risk reviewer (Stopped)");
  expect(merge).toContain("User reviewer (Failed)");
});
