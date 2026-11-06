import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const TOKEN = "tab-scoped-e2e-token";
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

async function connect(page: Page, cwd = CWD): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(TOKEN);
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .press("Enter");
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible())
    await chooser.getByRole("button", { name: "Add workspace" }).press("Enter");
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(cwd);
  await add
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .press("Enter");
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
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

test("the entry stays hidden when the server cannot stage and read back peers", async ({
  page,
}) => {
  await connect(page, "/srv/work/peer-control-no-fleet");
  await expect(page.locator("aside nav, aside").first()).toBeVisible();
  await expect(page.locator('[data-experts-nav="entry"]')).toHaveCount(0);
});

test("starts a team, shows each member's progress and result, and merges them here", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
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

test("a failed member and a stopped member are named, and the merge leaves them out", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "Review the rollout plan. [fail-seat-3] [slow-seat-2]");

  const team = center.locator("[data-expert-team]");
  const member = (seat: number) =>
    team.locator(`[data-expert-member$="-${seat}"]`);
  await expect(member(1).locator('[data-expert-state="finished"]')).toBeVisible(
    {
      timeout: 20_000,
    },
  );
  await expect(member(3).locator('[data-expert-state="failed"]')).toBeVisible();
  await member(3).getByText("Technical details").click();
  await expect(member(3).getByText(/stub model is down/)).toBeVisible();
  await expect(
    member(2).locator('[data-expert-state="working"]'),
  ).toBeVisible();

  await member(2).getByRole("button", { name: "Stop" }).click();
  await expect
    .poll(
      () => sent.filter((frame) => frame.method === "turn/interrupt").length,
    )
    .toBe(1);
  await expect(
    member(2).locator('[data-expert-state="stopped"]'),
  ).toBeVisible();
  await expect(member(2).getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(
    team.getByText("1 of 3 done · 1 did not finish · 1 stopped"),
  ).toBeVisible();
  await expect(
    team.getByText(
      "2 experts have no result yet. Merging now leaves their part out.",
    ),
  ).toBeVisible();

  const before = masterStarts(sent).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const gathers = sent.filter((frame) => frame.method === "peer/gather");
  const slugs = gathers.at(-1)!.params!.slugs as string[];
  expect(slugs).toHaveLength(1);
  expect(slugs[0]).toMatch(/-1$/);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain("These experts have no result");
  expect(merge).toContain("Risk reviewer (Stopped)");
  expect(merge).toContain("User reviewer (Failed)");
});

test("renders member Markdown, the merge names the experts, and a refresh keeps both", async ({
  page,
}) => {
  // T-0366: the real-model run showed raw ** / ## in member excerpts and a
  // merge report quoting bare handles. A Markdown-answering member plus a
  // failed member walks start → merge → refresh.
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "Review the plan. [md-seat-1] [fail-seat-3]");

  const team = center.locator("[data-expert-team]");
  const member = (seat: number) =>
    team.locator(`[data-expert-member$="-${seat}"]`);
  await expect(member(1).locator('[data-expert-state="finished"]')).toBeVisible(
    { timeout: 20_000 },
  );
  // The Markdown result renders: heading, bold and list are real elements,
  // never raw ** / ## characters.
  await expect(
    member(1).getByRole("heading", { name: "Conclusion" }),
  ).toBeVisible();
  await expect(member(1).locator("strong")).toHaveText(
    "The most important problem is example problem 1.",
  );
  await expect(member(1).getByText(/\*\*/)).toHaveCount(0);
  await expect(member(1).getByText(/##/)).toHaveCount(0);
  await expect(
    member(2).locator('[data-expert-state="finished"]'),
  ).toBeVisible();
  await expect(member(3).locator('[data-expert-state="failed"]')).toBeVisible();

  const before = masterStarts(sent).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const merge = turnText(masterStarts(sent).at(-1)!);
  // Headings lead with the role name (which already carries the handle), and
  // the instruction asks the merge to cite people, not numbers.
  expect(merge).toMatch(
    /## peer Feasibility reviewer · [0-9a-f]{4}-1 \(done\)/,
  );
  expect(merge).toMatch(/## peer Risk reviewer · [0-9a-f]{4}-2 \(done\)/);
  expect(merge).toContain(
    "In the report, refer to each expert by their role name",
  );
  expect(merge).toContain("User reviewer (Failed)");

  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  const rebuilt = again.locator("[data-expert-team]");
  await expect(rebuilt).toHaveCount(1);
  await expect(rebuilt.locator('[data-expert-state="finished"]')).toHaveCount(
    2,
  );
  await expect(rebuilt.locator('[data-expert-state="failed"]')).toHaveCount(1);
  await expect(
    rebuilt
      .locator('[data-expert-member$="-1"]')
      .getByRole("heading", { name: "Conclusion" }),
  ).toBeVisible();
});

test("a server without last_outcome trusts only the front matter, and the merge skips the error", async ({
  page,
}) => {
  // T-0370: an older Core omits last_outcome. The errored member's result
  // file carries outcome:errored with the error text as body — it must read
  // as a failure, never as a finished conclusion in the merge.
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(
    page,
    "Review the plan. [nooutcome-seat-1] [fail-nooutcome-seat-3]",
  );
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(team.locator('[data-expert-state="failed"]')).toHaveCount(1);

  // After a refresh the roster is gone: only the gather rows decide.
  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  const rebuilt = again.locator("[data-expert-team]");
  const member = (seat: number) =>
    rebuilt.locator(`[data-expert-member$="-${seat}"]`);
  // Seat 1 completed; the front matter it wrote still says so.
  await expect(
    member(1).locator('[data-expert-state="finished"]'),
  ).toBeVisible();
  await expect(
    member(1).getByText(/the most important problem is example problem 1/),
  ).toBeVisible();
  // Seat 3 errored: the error text is its failure detail, not its conclusion.
  await expect(member(3).locator('[data-expert-state="failed"]')).toBeVisible();
  await expect(member(3).getByText(/example problem/)).toHaveCount(0);
  await member(3).getByText("Technical details").click();
  await expect(member(3).getByText(/stub model is down/)).toBeVisible();

  const before = masterStarts(sent).length;
  await rebuilt
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const gathers = sent.filter((frame) => frame.method === "peer/gather");
  expect(gathers.at(-1)!.params!.slugs).toHaveLength(2);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain("User reviewer (Failed)");
  expect(merge).not.toContain("stub model is down");
});

const interrupts = (sent: SentFrame[]) =>
  sent.filter((frame) => frame.method === "turn/interrupt");

test("after a refresh a working member shows as working and can be stopped once", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "Check the release notes. [slow-seat-2] [fail-seat-3]");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(team.locator('[data-expert-state="failed"]')).toHaveCount(1);
  await expect(team.locator('[data-expert-state="working"]')).toHaveCount(1);
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
  expect(merge).toContain("Risk reviewer (Stopped)");
  expect(merge).toContain("User reviewer (Failed)");
});

test("a reconnect keeps a working member working, and sends no stop by itself", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
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

test("a name clash is retried with a new tag, and a refusal leaves the form usable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);

  await startTeam(
    page,
    "Look into charting libraries. [clash-once]",
    "research",
  );
  await expect(
    center.getByText("Research group started: 3 experts are working."),
  ).toBeVisible();
  expect(prepares(sent)).toHaveLength(2);
  const [first, second] = prepares(sent).map(
    (frame) => (frame.params!.names as string[])[0]!,
  );
  expect(first).not.toBe(second);
  await expect(center.locator("[data-expert-team]")).toHaveCount(1);

  const row = await startTeam(
    page,
    "Check the code. [refuse-prepare]",
    "code-check",
  );
  await expect(
    row.getByText(
      "The team was not started; nothing was created. You can try again.",
    ),
  ).toBeVisible();
  await row.getByText("Technical details").click();
  await expect(row.getByText(/no workspace root/)).toBeVisible();
  // A refusal is a definite answer, so the same conversation can start again.
  await row.getByRole("textbox").fill("Check the code in src/.");
  await row.getByRole("button", { name: "Start 3 experts" }).click();
  await expect(
    center.getByText("Code check-up started: 3 experts are working."),
  ).toBeVisible();
  await expect(center.locator("[data-expert-team]")).toHaveCount(2);
});

// T-0426: the two teams that deliver a file. Core 6fc12da3 records every file
// tool write as `modify` and only returns them with hydrate's messages, so the
// page reads each member's own record once its turn is over.
const fileReads = (sent: SentFrame[]) =>
  sent.filter(
    (frame) =>
      frame.method === "session/hydrate" &&
      String(frame.params?.session_id).includes("#peer-") &&
      JSON.stringify(frame.params?.include) === '["messages"]',
  );

test("a data cleanup team states each role's input and output, and delivers the new copy the server recorded", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  const row = center.locator('[data-expert-template="data-cleanup"]');
  await expect(
    row.getByText("Data inspector, Data cleaner, Data checker"),
  ).toBeVisible();
  await row.getByRole("button", { name: "Choose" }).click();
  const cleaner = row.locator("dl > div").filter({ hasText: "Data cleaner" });
  await expect(
    cleaner.getByText("Works from: The CSV file named in the goal."),
  ).toBeVisible();
  await expect(
    cleaner.getByText(
      "Hands back: A cleaned copy as a new file, and the rules applied with row counts.",
    ),
  ).toBeVisible();
  await expect(
    row.getByText(/roughly 4 times the usage of asking once\./),
  ).toBeVisible();
  await expect(
    row.getByText(
      "The cleaner writes the whole file again, so this team uses more than a review.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    row.getByText(
      /Data cleaner writes its result to a new file next to the original/,
    ),
  ).toBeVisible();
  await row
    .getByRole("textbox")
    .fill(
      "data/orders.csv: dates as YYYY-MM-DD [writes-seat-2=data/orders.cleaned-{tag}.csv]",
    );
  await row.getByRole("button", { name: "Start 3 experts" }).click();
  await expect(
    center.getByText("Data cleanup started: 3 experts are working."),
  ).toBeVisible();

  const prepare = prepares(sent)[0]!.params!;
  const names = prepare.names as string[];
  const tag = /· ([0-9a-f]{4})-1$/.exec(names[0]!)![1]!;
  expect(String(prepare.brief)).toContain(
    `Only Data cleaner · ${tag}-2 creates a file, as its angle says; everyone else only reads.`,
  );
  expect(String(prepare.brief)).not.toContain("Read only.");
  await expect.poll(() => memberStarts(sent).length).toBe(3);
  const kickoff = (seat: number) =>
    memberStarts(sent).find((frame) =>
      turnText(frame).includes(`${tag}-${seat}”`),
    )!;
  expect(turnText(kickoff(2))).toContain(
    `orders.csv becomes orders.cleaned-${tag}.csv`,
  );
  expect(turnText(kickoff(1))).not.toContain("new file next to the original");

  const team = center.locator("[data-expert-team]");
  const member = (seat: number) =>
    team.locator(`[data-expert-member$="-${seat}"]`);
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(3, {
    timeout: 20_000,
  });
  await expect(
    member(2)
      .locator("p", { hasText: "New file:" })
      .getByText(`data/orders.cleaned-${tag}.csv`, { exact: true }),
  ).toBeVisible();
  await expect(member(1).locator("p", { hasText: "New file:" })).toHaveCount(0);
  await expect(team.getByText(/which is not the team's new copy/)).toHaveCount(
    0,
  );
  // Each member's record is read once its turn is over, not polled.
  await expect.poll(() => fileReads(sent).length).toBe(3);
  await page.waitForTimeout(500);
  expect(fileReads(sent)).toHaveLength(3);

  const before = masterStarts(sent).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain("These are the results of the Data cleanup team");
  expect(merge).toContain(
    "Read the cleaned copy and check it against the checker's list",
  );
  expect(merge).toContain(
    `New files from experts that finished, as the server recorded them:\\n- Data cleaner: data/orders.cleaned-${tag}.csv`,
  );
  expect(merge).not.toContain("The server also recorded these file changes");
  expect(merge).not.toContain("These experts have no result");

  // Coming back to the page shows what was read, without reading it again.
  const back = await openExperts(page);
  await expect(
    back
      .locator('[data-expert-team] [data-expert-member$="-2"]')
      .locator("p", { hasText: "New file:" })
      .getByText(`data/orders.cleaned-${tag}.csv`, { exact: true }),
  ).toBeVisible();
  expect(fileReads(sent)).toHaveLength(3);

  // A refresh reads the record again from each member's session.
  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  await expect(
    again
      .locator('[data-expert-team] [data-expert-member$="-2"]')
      .locator("p", { hasText: "New file:" })
      .getByText(`data/orders.cleaned-${tag}.csv`, { exact: true }),
  ).toBeVisible();
  expect(fileReads(sent)).toHaveLength(6);
});

test("a document delivery team names a member that changed the original and one that failed, and delivers neither", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(
    page,
    "docs/proposal.md for the client's lead [writes-seat-1=docs/proposal.revised-{tag}.md] [writes-seat-2=docs/proposal.md] [fail-seat-3]",
    "document-delivery",
  );
  const team = center.locator("[data-expert-team]");
  const member = (seat: number) =>
    team.locator(`[data-expert-member$="-${seat}"]`);
  await expect(member(3).locator('[data-expert-state="failed"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    member(2).locator('[data-expert-state="finished"]'),
  ).toBeVisible();
  const tag = /([0-9a-f]{4})-1$/.exec(
    String(await member(1).getAttribute("data-expert-member")),
  )![1]!;
  await expect(
    member(1)
      .locator("p", { hasText: "New file:" })
      .getByText(`docs/proposal.revised-${tag}.md`, { exact: true }),
  ).toBeVisible();
  await expect(
    member(2).getByText(
      "It changed docs/proposal.md, which is not the team's new copy. The team was told to leave existing files alone; check that file.",
    ),
  ).toBeVisible();
  await expect(team.getByText("2 of 3 done · 1 did not finish")).toBeVisible();

  const before = masterStarts(sent).length;
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(before + 1);
  const merge = turnText(masterStarts(sent).at(-1)!);
  expect(merge).toContain(`- Reviser: docs/proposal.revised-${tag}.md`);
  expect(merge).toContain(
    "- Proofreader (changed a file that is not the team's new copy): docs/proposal.md",
  );
  expect(merge).toContain(
    "These experts have no result; say that their part is missing:",
  );
  expect(merge).toContain("- Summary writer (Failed)");
  // The failed member's answer is not among the gathered results.
  expect(merge).toMatch(new RegExp(`## peer Reviser · ${tag}-1 \\(done\\)`));
  expect(merge).not.toMatch(new RegExp(`## peer Summary writer · ${tag}-3`));
});

test("a writer whose answer claims a file the server never recorded is called out", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "data/orders.csv, dedupe rows", "data-cleanup");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(3, {
    timeout: 20_000,
  });
  await expect(
    team
      .locator('[data-expert-member$="-2"]')
      .getByText(
        "The server recorded no new file from this expert, whatever its answer says.",
      ),
  ).toBeVisible();
  await expect(team.locator("p", { hasText: "New file:" })).toHaveCount(0);
  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBeGreaterThan(0);
  expect(turnText(masterStarts(sent).at(-1)!)).not.toContain(
    "New files from experts",
  );
});

// T-0427: what a team cost. Each member's figure is its own session's ledger
// part; a merge is one turn of this conversation, with that turn's own usage.
test("shows each member's ledger usage and the merge's own, never a 0 for a member that reported none", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "Review the plan. [nousage-seat-3]");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(3, {
    timeout: 20_000,
  });
  const usage = (seat: number) =>
    team.locator(`[data-expert-usage$="-${seat}"]`);
  await expect(usage(1)).toHaveText(
    "Usage: 1,000 in · 100 out tokens · runs: 1",
  );
  // The prompt counts cache reads, as the usage page does.
  await expect(usage(2)).toHaveText(
    "Usage: 2,000 in · 200 out tokens · runs: 1",
  );
  await expect(usage(3)).toHaveText(
    "Usage unknown: the server recorded runs (1) without token counts.",
  );
  const block = team.locator("[data-expert-team-usage]");
  await expect(block).toContainText(
    "Experts3,000 in · 300 out tokens1 unknown",
  );
  await expect(block).toContainText("Not merged in this conversation yet.");
  await expect(block).toContainText(
    "Total3,000 in · 300 out tokensExperts only; no merge yet.Left out, no figure: 1.",
  );
  // Each member's own session, once its turn is over; nothing else.
  const reads = async () =>
    (
      (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/usage/reads")
      ).json()) as { sessionId: string | null }[]
    ).map((read) => read.sessionId);
  await expect.poll(async () => (await reads()).length).toBe(3);
  expect((await reads()).every((id) => id?.includes("#peer-"))).toBe(true);

  await team
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(1);
  await expect(page.getByText("Turn complete").first()).toBeVisible({
    timeout: 20_000,
  });
  const back = await openExperts(page);
  const merged = back.locator("[data-expert-team-usage]");
  await expect(merged).toContainText("Merges12 in · 9 out tokens (merges: 1)");
  await expect(merged).toContainText(
    "Total3,012 in · 309 out tokensExperts plus merges (1).",
  );
  // Returning reads nothing again from the ledger.
  expect(await reads()).toHaveLength(3);

  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  await expect(again.locator('[data-expert-usage$="-1"]')).toHaveText(
    "Usage: 1,000 in · 100 out tokens · runs: 1",
  );
  await expect(again.locator("[data-expert-team-usage]")).toContainText(
    "Total3,012 in · 309 out tokensExperts plus merges (1).",
  );
  const stored = await page.evaluate(
    () =>
      JSON.stringify({ ...localStorage }) +
      JSON.stringify({ ...sessionStorage }),
  );
  expect(stored).not.toMatch(/3,012|3012|run_count/);
});

test("a failed member's run without tokens is unknown, and another team's merge is not counted", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sent = observe(page);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "First plan.");
  const first = center.locator("[data-expert-team]");
  await expect(first.locator('[data-expert-state="finished"]')).toHaveCount(3, {
    timeout: 20_000,
  });
  await first
    .getByRole("button", { name: "Merge results in this conversation" })
    .click();
  await expect.poll(() => masterStarts(sent).length).toBe(1);
  await expect(page.getByText("Turn complete").first()).toBeVisible({
    timeout: 20_000,
  });
  await openExperts(page);
  await startTeam(page, "Second plan. [fail-seat-3]", "research");
  const second = center.locator('[data-expert-team^="research/"]');
  await expect(
    second.locator('[data-expert-member$="-3"] [data-expert-state="failed"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(second.locator('[data-expert-usage$="-3"]')).toHaveText(
    "Usage unknown: the server recorded runs (1) without token counts.",
  );
  const block = second.locator("[data-expert-team-usage]");
  await expect(block).toContainText("Not merged in this conversation yet.");
  await expect(block).toContainText("Total3,000 in · 300 out tokens");
  await expect(
    center.locator(
      '[data-expert-team^="plan-review/"] [data-expert-team-usage]',
    ),
  ).toContainText("(merges: 1)");
});
