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
  await expect(center.locator("[data-expert-template]")).toHaveCount(4);

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

test("after a refresh the team is read back from the server", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await connect(page);
  const center = await openExperts(page);
  await startTeam(page, "Check the release notes. [slow-seat-2] [fail-seat-3]");
  const team = center.locator("[data-expert-team]");
  await expect(team.locator('[data-expert-state="finished"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(team.locator('[data-expert-state="failed"]')).toHaveCount(1);

  await page.reload();
  await expect(page.getByText(CWD, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const again = await openExperts(page);
  const rebuilt = again.locator("[data-expert-team]");
  await expect(rebuilt).toHaveCount(1);
  await expect(rebuilt.getByText("Check the release notes.")).toBeVisible();
  await expect(rebuilt.locator('[data-expert-state="finished"]')).toHaveCount(
    1,
  );
  await expect(rebuilt.locator('[data-expert-state="failed"]')).toHaveCount(1);
  // This tab no longer holds the slow member's session: the page says what it
  // does not know instead of claiming it is still working, and offers no Stop.
  const slow = rebuilt.locator('[data-expert-member$="-2"]');
  await expect(slow.locator('[data-expert-state="no-result"]')).toBeVisible();
  await expect(
    slow.getByText(/It may still be working, or it may have been stopped/),
  ).toBeVisible();
  await expect(slow.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(
    rebuilt.getByRole("button", { name: "Merge results in this conversation" }),
  ).toBeEnabled();
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
