import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/history/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/gather/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
});

interface ObservedRpc {
  direction: "sent" | "received";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}
function observeRpc(page: Page) {
  const frames: ObservedRpc[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      frames.push({ ...JSON.parse(String(payload)), direction: "sent" }),
    );
    socket.on("framereceived", ({ payload }) =>
      frames.push({ ...JSON.parse(String(payload)), direction: "received" }),
    );
  });
  return {
    frames,
    requests: (method: string) =>
      frames.filter(
        (frame) => frame.direction === "sent" && frame.method === method,
      ),
    result: (request: ObservedRpc) =>
      frames.find(
        (frame) => frame.direction === "received" && frame.id === request.id,
      )?.result,
  };
}
async function armHistoryRefresh(
  request: APIRequestContext,
  sessionId: string,
) {
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/history/hold-refresh?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
}
async function expectHistoryRefreshHeld(
  request: APIRequestContext,
  sessionId: string,
  dialog: Locator,
) {
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/history/state")
      ).json()) as { held: string[] };
      return state.held;
    })
    .toEqual([sessionId]);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Applying and refreshing the owning Session…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close history", exact: true }),
  ).toBeDisabled();
}
async function releaseHistoryRefresh(
  request: APIRequestContext,
  sessionId: string,
) {
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/history/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
}

function productNavigation(page: Page): Locator {
  return page.locator("aside");
}

function composer(page: Page): Locator {
  return page.getByPlaceholder(COMPOSER_PLACEHOLDER);
}

function observeStartedTurns(page: Page): () => number {
  let starts = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) starts += 1;
    });
  });
  return () => starts;
}

async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: /Choose a workspace|Add workspace/ });
  await expect(productNavigation(page)).toBeVisible();
  await expect(chooser).toBeVisible();
  if (await chooser.getByRole("button", { name: "Add workspace" }).isVisible()) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: /Add & Start|Start session/ }).click();
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  await expect(composer(page)).toBeEnabled();
}

async function sendSlashCommand(page: Page, command: string): Promise<void> {
  await composer(page).fill(command);
  await page.getByRole("button", { name: "Send prompt" }).click();
}

/**
 * Product invariant: an unknown or unimplemented
 * command fails closed — it is never sent to the model as ordinary text and
 * never reaches turn/start.
 */
test("fails closed for an unknown command and sends no model input", async ({
  page,
}) => {
  const cwd = "/srv/work/unknown-command";
  const startedTurns = observeStartedTurns(page);
  await connectAndStartWorkspace(page, cwd);

  await sendSlashCommand(page, "/definitely-not-a-real-command");
  await expect(
    page.getByText("/definitely-not-a-real-command is unavailable"),
  ).toBeVisible();
  await expect(page.getByText("Nothing was sent to the model.")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  expect(startedTurns()).toBe(0);
});

/**
 * /activity opens the cross-Session ActivityNavigator modal; Inspecting the
 * current Session's task opens the real TaskDetailDialog (task heading with
 * the Task output close affordance), NOT a Trajectory tab and NOT a raw
 * payload dump. Nothing is sent to the model.
 */
test("opens Activity and inspects the current task in TaskDetailDialog", async ({
  page,
}) => {
  const cwd = "/srv/work/activity-navigator";
  const startedTurns = observeStartedTurns(page);
  await connectAndStartWorkspace(page, cwd);

  await sendSlashCommand(page, "/activity");

  const activity = page.getByRole("dialog", { name: "Activity" });
  await expect(activity).toBeVisible({ timeout: 15_000 });
  await expect(
    activity.getByText(
      "Server-owned tasks; no session is opened by this scan.",
    ),
  ).toBeVisible();

  // The current Session's row offers Inspect (not a cross-session Open).
  const taskRow = activity.getByText("Validate product checks");
  await expect(taskRow).toBeVisible();
  const inspect = activity.getByRole("button", { name: /^Inspect / });
  await expect(inspect).toBeEnabled();
  await inspect.click();

  // Inspect opens TaskDetailDialog: heading = task title or "Task output",
  // with the Close task output affordance. Not the Trajectory surface.
  const taskDetail = page.getByRole("dialog", { name: /Task output|Validate/ });
  await expect(taskDetail).toBeVisible({ timeout: 15_000 });
  await expect(
    taskDetail.getByRole("button", { name: "Close task output" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trajectory" })).toHaveCount(
    0,
  );
  expect(startedTurns()).toBe(0);

  // The task detail must show the scoped output/artifacts, not a raw JSON
  // dump: the fixture's mock task exposes an artifact list.
  await expect(
    taskDetail.getByText(/check\.txt|reports\//).first(),
  ).toBeVisible();
  await taskDetail.getByRole("button", { name: "Close task output" }).click();
  await expect(taskDetail).toHaveCount(0);
});

/**
 * /sessions focuses the sidebar Search sessions input (no modal), keeps the
 * active Session row, never re-starts a completed turn across repeated
 * invocations with Composer refocus between calls.
 */
test("keeps /sessions refocus stable on the active Session via sidebar search", async ({
  page,
}) => {
  const cwd = "/srv/work/sessions-refocus";
  const startedTurns = observeStartedTurns(page);
  await connectAndStartWorkspace(page, cwd);

  const sidebar = productNavigation(page);
  const selected = sidebar.locator(
    'button[role="treeitem"][aria-current="page"]',
  );
  const selectedTitle = await selected
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!selectedTitle) throw new Error("Expected a selected Session title");

  // First invocation focuses the sidebar search field, not a modal.
  await sendSlashCommand(page, "/sessions");
  const search = sidebar.locator('input[aria-label="Search sessions"]');
  await expect(search).toBeVisible({ timeout: 15_000 });
  await expect(search).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Refocus the Composer between invocations; repeat must stay stable on the
  // same active row and never start a new turn.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(selected).toHaveAttribute("aria-current", "page");
    await expect(selected).toContainText(selectedTitle);
    await composer(page).focus();
    await composer(page).fill("/sessions");
    await page.getByRole("button", { name: "Send prompt" }).click();
    await expect(search).toBeVisible({ timeout: 15_000 });
    await expect(search).toBeFocused();
  }
  await expect(selected).toHaveAttribute("aria-current", "page");
  await expect(selected).toContainText(selectedTitle);
  expect(startedTurns()).toBe(0);
});

test("keeps the confirmed fork receipt across parent refresh and opens the exact child without stealing focus", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  const cwd = "/srv/work/history-fork-receipt";
  await connectAndStartWorkspace(page, cwd);
  const sourceOpen = protocol.requests("session/open")[0]!;
  const sourceId = String(sourceOpen.params!.session_id);
  const selected = productNavigation(page).locator(
    'button[role="treeitem"][aria-current="page"]',
  );
  const sourceTitle = await selected
    .locator('[class*="sessionTitle"]')
    .textContent();
  const prompt = "Persist the source conversation before its fixture fork";
  await composer(page).fill(prompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await sendSlashCommand(page, "/fork");
  const dialog = page.getByRole("dialog", {
    name: "Fork conversation",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const name = "fixture-fork-receipt";
  await dialog.getByLabel("New conversation name", { exact: true }).fill(name);
  await armHistoryRefresh(request, sourceId);
  await dialog
    .getByRole("button", { name: "Create conversation fork", exact: true })
    .click();
  await expectHistoryRefreshHeld(request, sourceId, dialog);
  const forks = protocol.requests("session/fork");
  expect(forks).toHaveLength(1);
  expect(forks[0]!.params).toEqual({ session_id: sourceId, new_chat_id: name });
  const result = protocol.result(forks[0]!);
  expect(result).toMatchObject({
    parent_session_id: sourceId,
    copied_messages: 2,
  });
  const childId = String(result!.new_session_id);
  expect(childId).toBe(sourceId.split("#")[0] + "#" + name);
  expect(protocol.requests("session/open")).toHaveLength(1);
  await expect(selected).toContainText(sourceTitle!);
  await releaseHistoryRefresh(request, sourceId);
  const receipt = dialog.getByText(
    "Conversation fork opened in the background. Your selection was not changed.",
    { exact: true },
  );
  await expect(receipt).toBeVisible();
  await expect(receipt).toHaveCount(1);
  await expect(
    dialog.getByText("Fork: " + childId, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Create conversation fork",
      exact: true,
    }),
  ).toBeDisabled();
  const childOpens = protocol
    .requests("session/open")
    .filter((frame) => frame.params?.session_id === childId);
  expect(childOpens).toHaveLength(1);
  expect(childOpens[0]!.params).toMatchObject({
    session_id: childId,
    cwd,
    profile_id: sourceOpen.params!.profile_id,
  });
  const afterFork = protocol.frames.slice(
    protocol.frames.indexOf(forks[0]!) + 1,
  );
  expect(
    afterFork
      .filter(
        (frame) =>
          frame.direction === "sent" && frame.method === "session/hydrate",
      )
      .map((frame) => frame.params!.session_id),
  ).toEqual([sourceId, childId]);
  expect(protocol.requests("session/fork")).toHaveLength(1);
  expect(protocol.requests("turn/start")).toHaveLength(1);
  await expect(selected).toContainText(sourceTitle!);
  await dialog
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(
    productNavigation(page).getByRole("treeitem", { name: /Session / }),
  ).toHaveCount(2);
  const childRow = productNavigation(page)
    .locator('button[role="treeitem"]')
    .filter({ hasText: "Session " + childId.slice(-8) });
  await childRow.click();
  await expect(childRow).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  expect(protocol.requests("turn/start")).toHaveLength(1);
});

test("keeps the workspace restore receipt through canonical refresh without rewinding its conversation", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await connectAndStartWorkspace(page, "/srv/work/history-undo-receipt");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  const prompt = "Keep this conversation while restoring workspace files";
  await composer(page).fill(prompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await sendSlashCommand(page, "/undo");
  const dialog = page.getByRole("dialog", {
    name: "Undo workspace changes",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: /^Before fixture changes ·/ })
    .click();
  await armHistoryRefresh(request, sessionId);
  await dialog
    .getByRole("button", { name: "Confirm workspace restore", exact: true })
    .click();
  await expectHistoryRefreshHeld(request, sessionId, dialog);
  expect(protocol.requests("snapshot/list")).toHaveLength(2);
  for (const frame of protocol.requests("snapshot/list"))
    expect(frame.params).toEqual({ session_id: sessionId });
  expect(
    protocol.requests("snapshot/restore").map((frame) => frame.params),
  ).toEqual([
    { session_id: sessionId, snapshot_id: "snapshot-fixture-before" },
  ]);
  await releaseHistoryRefresh(request, sessionId);
  const receipt = dialog.getByText(
    "Workspace snapshot restored. Conversation history was not changed.",
    { exact: true },
  );
  await expect(receipt).toBeVisible();
  await expect(receipt).toHaveCount(1);
  await expect(
    dialog.getByRole("button", {
      name: "Confirm workspace restore",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  expect(protocol.requests("snapshot/restore")).toHaveLength(1);
  expect(protocol.requests("session/rollback")).toHaveLength(0);
  expect(protocol.requests("session/open")).toHaveLength(1);
  expect(protocol.requests("turn/start")).toHaveLength(1);
});

test("keeps the rewind receipt and restores only the owning prompt draft after canonical refresh", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await connectAndStartWorkspace(page, "/srv/work/history-rewind-receipt");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  const prompts = [
    "First user-rooted checkpoint",
    "Second user-rooted checkpoint",
  ];
  for (const [index, prompt] of prompts.entries()) {
    await composer(page).fill(prompt);
    await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .click();
    await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(index + 1);
  }
  await sendSlashCommand(page, "/rewind");
  const dialog = page.getByRole("dialog", {
    name: "Rewind conversation",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "#1 · " + prompts[0], exact: true })
    .click();
  await armHistoryRefresh(request, sessionId);
  await dialog
    .getByRole("button", { name: "Confirm conversation rewind", exact: true })
    .click();
  await expectHistoryRefreshHeld(request, sessionId, dialog);
  expect(
    protocol.requests("session/rollback").map((frame) => frame.params),
  ).toEqual([{ session_id: sessionId, num_turns: 2 }]);
  await releaseHistoryRefresh(request, sessionId);
  const receipt = dialog.getByText(
    "Conversation rewound. Workspace files were not restored.",
    { exact: true },
  );
  await expect(receipt).toBeVisible();
  await expect(receipt).toHaveCount(1);
  await expect(
    dialog.getByRole("button", {
      name: "Confirm conversation rewind",
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await expect(composer(page)).toHaveValue(prompts[0]!);
  await expect(composer(page)).toBeEnabled();
  const conversation = page.locator(
    '[role="region"][aria-label="Conversation"]',
  );
  for (const prompt of prompts)
    await expect(conversation.getByText(prompt, { exact: true })).toHaveCount(
      0,
    );
  await expect(conversation.getByText(COMPLETION_TEXT)).toHaveCount(0);
  expect(protocol.requests("session/rollback")).toHaveLength(1);
  expect(protocol.requests("snapshot/restore")).toHaveLength(0);
  expect(protocol.requests("session/open")).toHaveLength(1);
  expect(protocol.requests("turn/start")).toHaveLength(2);
});

test("queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  const cwd = "/srv/work/gather-exact-owner";
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const sourceOpen = protocol.requests("session/open")[0]!;
  const sessionId = String(sourceOpen.params!.session_id);
  const aTitle = await sidebar
    .locator(
      'button[role="treeitem"][aria-current="page"] [class*="sessionTitle"]',
    )
    .textContent();
  const a = sidebar
    .locator('button[role="treeitem"]')
    .filter({ hasText: aTitle! });
  const brief = "Gather this exact peer receipt";
  await sendSlashCommand(page, "/peer");
  const peers = page.getByRole("dialog", {
    name: "Session peers",
    exact: true,
  });
  await peers.getByLabel("Peer brief", { exact: true }).fill(brief);
  await peers.getByRole("button", { name: "Start peers", exact: true }).click();
  await expect.poll(() => protocol.requests("turn/start").length).toBe(1);
  const staged = protocol.frames.find(
    (frame) => frame.direction === "received" && frame.method === "peer/staged",
  )!.params!;
  const slug = String(staged.slug);
  const peerId =
    String(staged.profile_id) + ":local:tui#" + String(staged.topic);
  const terminals = () =>
    protocol.frames.filter(
      (frame) =>
        frame.direction === "received" &&
        frame.method === "projection/envelope" &&
        (frame.params?.payload as { type?: string })?.type === "turn_terminal",
    );
  await expect
    .poll(() =>
      terminals().some((frame) => frame.params!.session_id === peerId),
    )
    .toBe(true);
  await peers.getByRole("button", { name: "Close peers", exact: true }).click();
  await expect(a).toHaveAttribute("aria-current", "page");
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/terminal/hold-next")
    ).status(),
  ).toBe(204);
  const activePrompt = "Keep A active while its gather result is in flight";
  await composer(page).fill(activePrompt);
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/gather/hold-next?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await composer(page).fill("/gather " + slug);
    await page
      .getByRole("button", { name: "Queue prompt", exact: true })
      .click();
  }
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(FIXTURE_ORIGIN + "/__test__/gather/state")
          ).json()
        ).held,
    )
    .toEqual([sessionId]);
  expect(protocol.requests("peer/gather")).toHaveLength(1);
  expect(protocol.requests("peer/gather")[0]!.params).toEqual({
    session_id: sessionId,
    profile_id: sourceOpen.params!.profile_id,
    slugs: [slug],
  });
  await sidebar
    .getByRole("treeitem", { name: "gather-exact-owner", exact: true })
    .getByRole("button", { name: "gather-exact-owner", exact: true })
    .hover();
  await sidebar
    .getByRole("button", {
      name: "New session in gather-exact-owner",
      exact: true,
    })
    .click();
  await expect(sidebar.getByRole("treeitem", { name: /Session / })).toHaveCount(
    3,
  );
  await expect(a).not.toHaveAttribute("aria-current", "page");
  const bTitle = await sidebar
    .locator(
      'button[role="treeitem"][aria-current="page"] [class*="sessionTitle"]',
    )
    .textContent();
  const b = sidebar
    .locator('button[role="treeitem"]')
    .filter({ hasText: bTitle! });
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/gather/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  await a.click();
  await expect(page.getByText("1 queued", { exact: true })).toBeVisible();
  expect(protocol.requests("turn/start")).toHaveLength(2);
  await b.click();
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText(/Peer results gathered|Keep A active/),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = (await (
        await request.get(FIXTURE_ORIGIN + "/__test__/terminal/state")
      ).json()) as { held: Array<{ session_id: string }> };
      return state.held.some((held) => held.session_id === sessionId);
    })
    .toBe(true);
  expect(
    (
      await request.post(
        FIXTURE_ORIGIN +
          "/__test__/terminal/release?session_id=" +
          encodeURIComponent(sessionId),
      )
    ).status(),
  ).toBe(204);
  await expect.poll(() => protocol.requests("turn/start").length).toBe(3);
  const synthesis = protocol.requests("turn/start")[2]!;
  const expected =
    "Peer results gathered from the blackboard:\n\n## peer " +
    slug +
    " (done)\nBrief: " +
    brief +
    "\n\nFixture peer completed";
  expect(synthesis.params).toMatchObject({
    session_id: sessionId,
    input: [{ kind: "text", text: expected }],
  });
  expect(Buffer.byteLength(expected, "utf8")).toBeLessThanOrEqual(64 * 1024);
  expect(synthesis.params!.turn_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect
    .poll(
      () =>
        terminals().filter((frame) => frame.params!.session_id === sessionId)
          .length,
    )
    .toBe(2);
  await expect(b).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText(/Peer results gathered|Keep A active/),
  ).toHaveCount(0);
  await a.click();
  await expect(page.getByText(expected, { exact: true })).toHaveCount(1);
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  await sendSlashCommand(page, "/peer");
  await peers
    .getByRole("button", { name: "Refresh blackboard", exact: true })
    .click();
  await expect.poll(() => protocol.requests("peer/gather").length).toBe(2);
  await expect
    .poll(() => protocol.result(protocol.requests("peer/gather")[1]!))
    .toBeTruthy();
  expect(protocol.requests("turn/start")).toHaveLength(3);
  expect(protocol.requests("turn/interrupt")).toHaveLength(0);
});

test("reports an empty filtered gather without sending synthesis or opening a Session", async ({
  page,
}) => {
  const protocol = observeRpc(page);
  await connectAndStartWorkspace(page, "/srv/work/gather-empty-owner");
  const source = protocol.requests("session/open")[0]!.params!;
  await sendSlashCommand(page, "/gather fixture-missing-peer");
  await expect(
    page.getByText("No peers staged on the blackboard.", { exact: true }),
  ).toBeVisible();
  expect(protocol.requests("peer/gather").map((frame) => frame.params)).toEqual(
    [
      {
        session_id: source.session_id,
        profile_id: source.profile_id,
        slugs: ["fixture-missing-peer"],
      },
    ],
  );
  expect(protocol.requests("turn/start")).toHaveLength(0);
  expect(protocol.requests("session/open")).toHaveLength(1);
  await expect(
    page
      .locator('[role="dialog"]')
      .filter({ has: page.locator('h2:text-is("Session peers")') }),
  ).toHaveCount(0);
});
