import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPOSER = "Ask Octos to change, explain, or review code…";
interface Frame {
  id?: string;
  method?: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
}
function observe(page: Page) {
  const sent: Frame[] = [];
  const received: Frame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      sent.push(JSON.parse(String(payload)) as Frame),
    );
    socket.on("framereceived", ({ payload }) =>
      received.push(JSON.parse(String(payload)) as Frame),
    );
  });
  return {
    sent,
    received,
    calls: (method: string) => sent.filter((frame) => frame.method === method),
    async settled(call: Frame) {
      await expect
        .poll(() => received.some((frame) => frame.id === call.id))
        .toBe(true);
    },
  };
}
type Probe = ReturnType<typeof observe>;
function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Product navigation" });
}
async function selectedTitle(page: Page) {
  // A ModalSurface dialog (thread/turn/goal/agents inspector) sets aria-hidden
  // on main.workspace-grid — the required a11y contract — which hides the
  // product nav from ROLE queries. Read the selected row through a CSS locator
  // that ignores aria-hidden so the title stays readable under an open dialog.
  const value = await page
    .locator(
      'aside[aria-label="Product navigation"] button[role="treeitem"][aria-current="page"] [class*="sessionTitle"]',
    )
    .textContent();
  if (!value) throw new Error("A confirmed selected Session is required");
  return value;
}
async function selectSession(page: Page, title: string) {
  await sidebar(page)
    .locator('button[role="treeitem"]')
    .filter({ hasText: title })
    .click();
  await expect.poll(() => selectedTitle(page)).toBe(title);
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
}
async function connect(page: Page, probe: Probe, name: string, native = true) {
  const cwd = `/srv/work/${native ? "native-workflows-" : "native-disabled-"}${name}`;
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(cwd);
  await add.getByRole("button", { name: "Add & Start" }).click();
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  await expect
    .poll(() => probe.calls("session/open").length)
    .toBeGreaterThan(0);
  const sessionId = probe.calls("session/open").at(-1)!.params.session_id;
  if (typeof sessionId !== "string")
    throw new Error("Expected a full Session ID");
  return {
    sessionId,
    title: await selectedTitle(page),
    workspace: cwd.split("/").at(-1)!,
  };
}
async function sibling(page: Page, probe: Probe, workspace: string) {
  const before = await selectedTitle(page);
  const opens = probe.calls("session/open").length;
  const workspaceRow = sidebar(page).getByRole("treeitem", {
    name: workspace,
    exact: true,
  });
  await workspaceRow
    .getByRole("button", { name: workspace, exact: true })
    .hover();
  await sidebar(page)
    .getByRole("button", { name: `New session in ${workspace}` })
    .click();
  await expect.poll(() => probe.calls("session/open").length).toBe(opens + 1);
  await expect.poll(() => selectedTitle(page)).not.toBe(before);
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  const sessionId = probe.calls("session/open").at(-1)!.params.session_id;
  if (typeof sessionId !== "string")
    throw new Error("Expected a sibling Session ID");
  return { sessionId, title: await selectedTitle(page) };
}
async function submit(page: Page, text: string) {
  const composer = page.getByPlaceholder(COMPOSER);
  await composer.fill(text);
  // Escape dismisses an open palette, but otherwise interrupts active work.
  // Ordinary prompt submission must not change the owning turn's lifecycle.
  if ((await composer.getAttribute("aria-expanded")) === "true") {
    await composer.press("Escape");
  }
  await page.getByRole("button", { name: /^(Send|Queue) prompt$/ }).click();
}
async function nativeControl(
  request: APIRequestContext,
  action: string,
  sessionId: string,
  method?: string,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    session_id: sessionId,
    ...(method ? { method } : {}),
    ...extra,
  });
  expect(
    (
      await request.post(`${ORIGIN}/__test__/native/${action}?${query}`)
    ).status(),
  ).toBe(204);
}
async function held(
  request: APIRequestContext,
  sessionId: string,
  method: string,
) {
  await expect
    .poll(async () => {
      const result = await request.get(
        `${ORIGIN}/__test__/native/state?${new URLSearchParams({ session_id: sessionId })}`,
      );
      return ((await result.json()) as { held: string[] }).held;
    })
    .toContain(method);
}
async function terminal(probe: Probe, turnId: unknown) {
  await expect
    .poll(() =>
      probe.received.some(
        (frame) =>
          frame.method === "projection/envelope" &&
          frame.params.turn_id === turnId &&
          (frame.params.payload as { type?: string })?.type === "turn_terminal",
      ),
    )
    .toBe(true);
}
function autonomy(page: Page) {
  return page.getByRole("dialog", { name: "Session autonomy", exact: true });
}
async function openAutonomy(page: Page, command = "/goal") {
  await submit(page, command);
  const dialog = autonomy(page);
  await expect(
    dialog.getByRole("button", { name: "Close autonomy", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Set session goal", exact: true }),
  ).toBeVisible();
  return dialog;
}

test("native commands fail closed when the original fixture does not advertise them", async ({
  page,
}) => {
  const probe = observe(page);
  await connect(page, probe, "capabilities", false);
  for (const command of [
    "/btw explain",
    "/threads",
    "/turn state 00000000-0000-4000-8000-000000000001",
    "/goal",
    "/agents",
    "/loop",
    "/permissions",
  ]) {
    await submit(page, command);
    await expect(
      page.getByText(`${command.split(" ")[0]} is unavailable`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  expect(probe.calls("turn/start")).toHaveLength(0);
  expect(
    probe.sent.filter((frame) =>
      [
        "session/btw",
        "thread/graph/get",
        "turn/state/get",
        "approval/scopes/list",
        "session/goal/get",
        "agent/list",
        "loop/create",
      ].includes(frame.method ?? ""),
    ),
  ).toHaveLength(0);
});

test("native asides remain ephemeral and owned by their original Session across delayed A to B replies", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "aside");
  await nativeControl(request, "hold", a.sessionId, "session/btw");
  await submit(page, "/btw question for native A");
  await held(request, a.sessionId, "session/btw");
  expect(probe.calls("session/btw")[0]!.params).toEqual({
    session_id: a.sessionId,
    question: "question for native A",
  });
  const b = await sibling(page, probe, a.workspace);
  await submit(page, "/aside question for native B");
  const aside = page.getByRole("complementary", { name: "Aside — /btw" });
  await expect(aside).toContainText(
    `Native aside for ${b.sessionId}: question for native B`,
  );
  await page.getByPlaceholder(COMPOSER).fill("Unsent native B draft");
  await nativeControl(request, "release", a.sessionId, "session/btw");
  await probe.settled(probe.calls("session/btw")[0]!);
  expect(await selectedTitle(page)).toBe(b.title);
  await expect(aside).not.toContainText(a.sessionId);
  await expect(page.getByPlaceholder(COMPOSER)).toHaveValue(
    "Unsent native B draft",
  );
  await selectSession(page, a.title);
  await expect(aside).toContainText(
    `Native aside for ${a.sessionId}: question for native A`,
  );
  await aside.getByRole("button", { name: "Dismiss aside" }).click();
  await expect(aside).toHaveCount(0);
  await expect(
    page.locator(".timeline").getByText("question for native A"),
  ).toHaveCount(0);
  expect(probe.calls("turn/start")).toHaveLength(0);
  expect(probe.calls("session/btw")).toHaveLength(2);
});

test("thread, turn and remembered-scope inspectors use exact owners and discard closed A reads after B opens", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "inspection");
  await submit(page, "Create one native inspection thread");
  await expect.poll(() => probe.calls("turn/start").length).toBe(1);
  const turnId = probe.calls("turn/start")[0]!.params.turn_id;
  await terminal(probe, turnId);
  // An idle empty draft correctly disables Send; terminal admission is proven
  // by the captured native receipt and the composer returning to idle mode.
  await expect(page.getByPlaceholder(COMPOSER)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Queue prompt" })).toHaveCount(
    0,
  );
  await nativeControl(request, "hold", a.sessionId, "thread/graph/get");
  await submit(page, "/threads");
  await held(request, a.sessionId, "thread/graph/get");
  expect(probe.calls("thread/graph/get")[0]!.params).toEqual({
    session_id: a.sessionId,
  });
  await page.getByRole("button", { name: "Close inspector" }).click();
  const b = await sibling(page, probe, a.workspace);
  await submit(page, "/thread");
  const graph = page.getByRole("dialog", { name: "Thread graph" });
  await expect(graph).toContainText("No threads returned for this Session.");
  await nativeControl(request, "release", a.sessionId, "thread/graph/get");
  await probe.settled(probe.calls("thread/graph/get")[0]!);
  await graph.getByRole("button", { name: "Refresh inspection" }).click();
  await expect(graph).toContainText("No threads returned for this Session.");
  await expect(graph).not.toContainText(a.sessionId);
  expect(await selectedTitle(page)).toBe(b.title);
  await graph.getByRole("button", { name: "Close inspector" }).click();
  await submit(page, `/turn state ${String(turnId)}`);
  let turn = page.getByRole("dialog", { name: "Turn state" });
  await expect(
    turn.getByRole("region", { name: "Native turn state" }),
  ).toContainText("unknown");
  expect(probe.calls("turn/state/get").at(-1)!.params).toEqual({
    session_id: b.sessionId,
    turn_id: turnId,
  });
  await turn.getByRole("button", { name: "Close inspector" }).click();
  await selectSession(page, a.title);
  await submit(page, `/turn state ${String(turnId)}`);
  turn = page.getByRole("dialog", { name: "Turn state" });
  await expect(
    turn.getByRole("region", { name: "Native turn state" }),
  ).toContainText("completed");
  expect(probe.calls("turn/state/get").at(-1)!.params).toEqual({
    session_id: a.sessionId,
    turn_id: turnId,
  });
  await turn.getByRole("button", { name: "Close inspector" }).click();
  for (const invalid of [
    "/turn",
    "/turn state malformed",
    `/turn ${String(turnId)}`,
  ])
    await submit(page, invalid);
  await expect(
    page.getByText("/turn is unavailable", { exact: true }),
  ).toHaveCount(3);
  expect(probe.calls("turn/state/get")).toHaveLength(2);
  await submit(page, "/permissions");
  const permissions = page.getByRole("dialog", {
    name: "Remembered approvals",
  });
  await expect(permissions).toContainText(`Match: /srv/work/${a.workspace}`);
  await expect(permissions).toContainText("Decision: allow");
  expect(probe.calls("approval/scopes/list").at(-1)!.params).toEqual({
    session_id: a.sessionId,
  });
  expect(probe.calls("turn/start")).toHaveLength(1);
  expect(probe.calls("approval/scopes/clear")).toHaveLength(0);
});

test("a dropped native steer returns once to its owning FIFO while a different Session is selected", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "steering");
  await submit(page, "/steer on");
  await expect(
    page.getByText(/Steering enabled for this Session/),
  ).toBeVisible();
  expect(
    (await request.post(`${ORIGIN}/__test__/terminal/hold-next`)).status(),
  ).toBe(204);
  await submit(page, "Native steering active owner A");
  await expect.poll(() => probe.calls("turn/start").length).toBe(1);
  const first = probe.calls("turn/start")[0]!;
  await probe.settled(first);
  expect(probe.calls("turn/interrupt")).toHaveLength(0);
  await submit(page, "Returned native steering text");
  await expect.poll(() => probe.calls("turn/steer").length).toBe(1);
  await probe.settled(probe.calls("turn/steer")[0]!);
  expect(probe.calls("turn/interrupt")).toHaveLength(0);
  expect(probe.calls("turn/steer")[0]!.params).toEqual({
    session_id: a.sessionId,
    expected_turn_id: first.params.turn_id,
    input: [{ kind: "text", text: "Returned native steering text" }],
  });
  await submit(page, "/turn");
  const turn = page.getByRole("dialog", { name: "Turn state" });
  await expect(
    turn.getByRole("region", { name: "Native turn state" }),
  ).toContainText("active");
  expect(probe.calls("turn/state/get").at(-1)!.params).toEqual({
    session_id: a.sessionId,
    turn_id: first.params.turn_id,
  });
  await turn.getByRole("button", { name: "Close inspector" }).click();
  const b = await sibling(page, probe, a.workspace);
  await submit(page, "Independent native owner B");
  await expect.poll(() => probe.calls("turn/start").length).toBe(2);
  await terminal(probe, probe.calls("turn/start")[1]!.params.turn_id);
  await page.getByPlaceholder(COMPOSER).fill("Retain native B draft");
  for (let count = 0; count < 2; count += 1)
    await nativeControl(request, "steer-drop", a.sessionId);
  await expect
    .poll(
      () =>
        probe.received.filter((frame) => frame.method === "turn/steer_dropped")
          .length,
    )
    .toBe(2);
  expect(await selectedTitle(page)).toBe(b.title);
  await expect(page.locator(".prompt-queue")).toHaveCount(0);
  await expect(page.getByPlaceholder(COMPOSER)).toHaveValue(
    "Retain native B draft",
  );
  await selectSession(page, a.title);
  await expect(page.locator(".prompt-queue strong")).toHaveText("1 queued");
  await submit(page, "/steer off");
  await submit(page, "Ordinary native FIFO successor");
  await expect(page.locator(".prompt-queue strong")).toHaveText("2 queued");
  await selectSession(page, b.title);
  await expect
    .poll(async () =>
      (
        (await (
          await request.get(`${ORIGIN}/__test__/terminal/state`)
        ).json()) as { held: { session_id: string }[] }
      ).held.some((entry) => entry.session_id === a.sessionId),
    )
    .toBe(true);
  expect(
    (
      await request.post(
        `${ORIGIN}/__test__/terminal/release?${new URLSearchParams({ session_id: a.sessionId })}`,
      )
    ).status(),
  ).toBe(204);
  await expect.poll(() => probe.calls("turn/start").length).toBe(4);
  const aStarts = probe
    .calls("turn/start")
    .filter((frame) => frame.params.session_id === a.sessionId);
  expect(
    aStarts.map((frame) => (frame.params.input as { text: string }[])[0]!.text),
  ).toEqual([
    "Native steering active owner A",
    "Returned native steering text",
    "Ordinary native FIFO successor",
  ]);
  expect(new Set(aStarts.map((frame) => frame.params.turn_id)).size).toBe(3);
  await terminal(probe, aStarts[2]!.params.turn_id);
  expect(await selectedTitle(page)).toBe(b.title);
  await expect(page.getByPlaceholder(COMPOSER)).toHaveValue(
    "Retain native B draft",
  );
  expect(probe.calls("turn/steer")).toHaveLength(1);
  await expect(page.locator(".timeline")).not.toContainText(
    "Returned native steering text",
  );
});

test("goal pause, resume and stop preserve the current objective and budget, and newer notifications cancel stale transitions", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "goal");
  const dialog = await openAutonomy(page);
  await dialog
    .getByLabel("Goal objective", { exact: true })
    .fill("Initial native goal objective");
  await dialog.getByLabel("Goal token budget, optional").fill("17");
  await dialog
    .getByRole("button", { name: "Set session goal", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Pause session goal" }),
  ).toBeEnabled();
  expect(probe.calls("session/goal/set")[0]!.params).toEqual({
    session_id: a.sessionId,
    objective: "Initial native goal objective",
    status: "active",
    transition_actor: "user",
    token_budget: 17,
  });
  for (const [label, status] of [
    ["Pause", "paused"],
    ["Resume", "active"],
  ]) {
    const reads = probe.calls("session/goal/get").length;
    await dialog.getByRole("button", { name: `${label} session goal` }).click();
    await expect
      .poll(() => probe.calls("session/goal/get").length)
      .toBe(reads + 1);
    await expect(
      dialog.getByRole("button", { name: "Close autonomy", exact: true }),
    ).toBeEnabled();
    expect(probe.calls("session/goal/set").at(-1)!.params).toEqual({
      session_id: a.sessionId,
      objective: "Initial native goal objective",
      status,
      transition_actor: "user",
    });
  }
  await nativeControl(request, "hold", a.sessionId, "session/goal/get");
  await dialog.getByRole("button", { name: "Pause session goal" }).click();
  await held(request, a.sessionId, "session/goal/get");
  await expect(
    dialog.getByRole("button", { name: "Close autonomy", exact: true }),
  ).toBeDisabled();
  await nativeControl(request, "goal-revision", a.sessionId);
  await expect(
    dialog.getByRole("region", { name: "Session goal", exact: true }),
  ).toContainText("Newer server-owned objective");
  await nativeControl(request, "release", a.sessionId, "session/goal/get");
  await expect(
    dialog.getByRole("button", { name: "Close autonomy", exact: true }),
  ).toBeEnabled();
  expect(probe.calls("session/goal/set")).toHaveLength(3);
  await dialog.getByRole("button", { name: "Stop session goal" }).click();
  await expect.poll(() => probe.calls("session/goal/set").length).toBe(4);
  await expect(
    dialog.getByRole("button", { name: "Stop session goal" }),
  ).toHaveCount(0);
  expect(probe.calls("session/goal/set")[3]!.params).toEqual({
    session_id: a.sessionId,
    objective: "Newer server-owned objective",
    status: "complete",
    transition_actor: "user",
  });
  await dialog.getByRole("button", { name: "Clear session goal" }).click();
  await expect(dialog).toContainText("No active goal for this session.");
  expect(probe.calls("session/goal/clear").at(-1)!.params).toEqual({
    session_id: a.sessionId,
  });
  expect(probe.calls("turn/start")).toHaveLength(0);
});

test("native agent receipts settle terminal status and delayed artifact reads cannot cross Session ownership", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "agents");
  let dialog = await openAutonomy(page, "/agents");
  await expect(
    dialog.getByRole("list", { name: "Agent list" }).getByRole("listitem"),
  ).toHaveCount(2);
  await nativeControl(request, "hold", a.sessionId, "agent/status/read");
  await dialog
    .getByRole("button", {
      name: "Read status of agent native-agent-1",
      exact: true,
    })
    .click();
  await held(request, a.sessionId, "agent/status/read");
  await dialog
    .getByRole("button", { name: "Close agent native-agent-1", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Close agent native-agent-1",
      exact: true,
    }),
  ).toBeDisabled();
  await expect.poll(() => probe.calls("agent/close").length).toBe(1);
  await probe.settled(probe.calls("agent/close")[0]!);
  await nativeControl(request, "release", a.sessionId, "agent/status/read");
  await probe.settled(probe.calls("agent/status/read")[0]!);
  await dialog
    .getByRole("button", {
      name: "Read status of agent native-agent-1",
      exact: true,
    })
    .click();
  await expect(
    dialog.locator('[aria-label="Agent status detail"]'),
  ).toContainText("closed");
  await expect(
    dialog.getByRole("button", {
      name: "Interrupt agent native-agent-1",
      exact: true,
    }),
  ).toBeDisabled();
  expect(probe.calls("agent/close")[0]!.params).toEqual({
    session_id: a.sessionId,
    agent_id: "native-agent-1",
  });
  await dialog
    .getByRole("button", {
      name: "List artifacts of agent native-agent-2",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Read artifact native-report", exact: true })
    .click();
  await expect(
    dialog.locator('[aria-label="Agent artifact content"]'),
  ).toContainText(`Redacted native report owned by ${a.sessionId}`);
  await expect(dialog).not.toContainText(
    "NESTED_UNREDACTED_CONTENT_MUST_NOT_RENDER",
  );
  expect(probe.calls("agent/artifact/read").at(-1)!.params).toEqual({
    session_id: a.sessionId,
    agent_id: "native-agent-2",
    artifact_id: "native-report",
  });
  await nativeControl(request, "hold", a.sessionId, "agent/artifact/read");
  await dialog
    .getByRole("button", {
      name: "List artifacts of agent native-agent-2",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Read artifact native-report", exact: true })
    .click();
  await held(request, a.sessionId, "agent/artifact/read");
  const oldRead = probe.calls("agent/artifact/read").at(-1)!;
  await dialog
    .getByRole("button", { name: "Close autonomy", exact: true })
    .click();
  const b = await sibling(page, probe, a.workspace);
  dialog = await openAutonomy(page, "/agents");
  await dialog
    .getByRole("button", {
      name: "List artifacts of agent native-agent-2",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Read artifact native-report", exact: true })
    .click();
  await expect(
    dialog.locator('[aria-label="Agent artifact content"]'),
  ).toContainText(`Redacted native report owned by ${b.sessionId}`);
  await nativeControl(request, "release", a.sessionId, "agent/artifact/read");
  await probe.settled(oldRead);
  await dialog
    .getByRole("button", {
      name: "Interrupt agent native-agent-2",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Close autonomy", exact: true }),
  ).toBeEnabled();
  expect(probe.calls("agent/interrupt").at(-1)!.params).toEqual({
    session_id: b.sessionId,
    agent_id: "native-agent-2",
  });
  await expect(dialog).not.toContainText(a.sessionId);
  expect(await selectedTitle(page)).toBe(b.title);
  expect(probe.calls("turn/start")).toHaveLength(0);
  // Native /agents spawn is deliberately an ordinary prompt, not a made-up
  // agent/spawn RPC. No fixture scheduler or provider is started by the form.
  const spawn = dialog.getByRole("form", { name: "Request parallel agents" });
  await spawn.getByLabel("Agent count").fill("2");
  await spawn
    .getByLabel("Agent task")
    .fill("Independent finite native reviews");
  await spawn
    .getByRole("button", { name: "Request parallel agents", exact: true })
    .click();
  await expect.poll(() => probe.calls("turn/start").length).toBe(1);
  const admitted = probe.calls("turn/start")[0]!;
  expect(admitted.params.session_id).toBe(b.sessionId);
  expect(admitted.params.input).toEqual([
    {
      kind: "text",
      text: "Spawn 2 agent(s) to accomplish in parallel: Independent finite native reviews",
    },
  ]);
  expect(admitted.params.turn_id).toMatch(
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i,
  );
  await terminal(probe, admitted.params.turn_id);
  expect(probe.calls("turn/start")).toHaveLength(1);
  expect(probe.calls("agent/spawn")).toHaveLength(0);
  expect(await selectedTitle(page)).toBe(b.title);
});

test("native maintenance, self-paced and fixed loops send one typed creation each without automatic firing", async ({
  page,
  request,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "loops");
  const dialog = await openAutonomy(page, "/loop");
  const form = dialog.getByRole("form", { name: "Create native loop" });
  await expect(form.getByLabel("Loop cadence")).toHaveValue("maintenance");
  await form.getByRole("button", { name: "Create loop", exact: true }).click();
  await expect(
    dialog.getByRole("list", { name: "Loop list" }).getByRole("listitem"),
  ).toHaveCount(1);
  expect(probe.calls("loop/create")[0]!.params).toEqual({
    session_id: a.sessionId,
    mode: "maintenance",
    prompt: "",
  });
  await form.getByLabel("Loop cadence").selectOption("self_paced");
  await form.getByLabel("New loop prompt").fill("Native self-paced check");
  await nativeControl(request, "hold", a.sessionId, "loop/create");
  await form.getByRole("button", { name: "Create loop", exact: true }).click();
  await held(request, a.sessionId, "loop/create");
  await expect(
    form.getByRole("button", { name: "Create loop", exact: true }),
  ).toBeDisabled();
  await expect(form.getByLabel("New loop prompt")).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Close autonomy", exact: true }),
  ).toBeDisabled();
  expect(probe.calls("loop/create")).toHaveLength(2);
  await nativeControl(request, "release", a.sessionId, "loop/create");
  await expect(
    dialog.getByRole("list", { name: "Loop list" }).getByRole("listitem"),
  ).toHaveCount(2);
  expect(probe.calls("loop/create")[1]!.params).toEqual({
    session_id: a.sessionId,
    mode: "self_paced",
    prompt: "Native self-paced check",
  });
  await form.getByLabel("Loop cadence").selectOption("fixed_interval");
  await form.getByLabel("New loop prompt").fill("Native fixed interval check");
  for (const invalid of [
    "0s",
    "-1m",
    "1.5m",
    "25h",
    "1fortnight",
    "9007199254740992s",
  ]) {
    await form.getByLabel("Loop interval").fill(invalid);
    await expect(
      form.getByRole("button", { name: "Create loop", exact: true }),
    ).toBeDisabled();
  }
  expect(probe.calls("loop/create")).toHaveLength(2);
  await form.getByLabel("Loop interval").fill("5min");
  await form.getByRole("button", { name: "Create loop", exact: true }).click();
  await expect(
    dialog.getByRole("list", { name: "Loop list" }).getByRole("listitem"),
  ).toHaveCount(3);
  expect(probe.calls("loop/create")[2]!.params).toEqual({
    session_id: a.sessionId,
    mode: "fixed_interval",
    prompt: "Native fixed interval check",
    interval_seconds: 300,
  });
  const row = dialog
    .getByRole("list", { name: "Loop list" })
    .getByRole("listitem")
    .filter({ hasText: "Native fixed interval check" });
  await row.getByRole("button", { name: /^Pause loop / }).click();
  await expect(
    row.getByRole("button", { name: /^Resume loop / }),
  ).toBeEnabled();
  await row.getByRole("button", { name: /^Resume loop / }).click();
  await expect(row.getByRole("button", { name: /^Pause loop / })).toBeEnabled();
  await row.getByRole("button", { name: /^Delete loop / }).click();
  await expect(row).toHaveCount(0);
  const loopId = probe.calls("loop/pause")[0]!.params.loop_id;
  for (const method of ["loop/pause", "loop/resume", "loop/delete"])
    expect(probe.calls(method)[0]!.params).toEqual({
      session_id: a.sessionId,
      loop_id: loopId,
    });
  expect(probe.calls("loop/create")).toHaveLength(3);
  expect(probe.calls("loop/fire_now")).toHaveLength(0);
  expect(probe.calls("turn/start")).toHaveLength(0);
});

test("goal notifications admit arbitrary-base strictly-increasing generations and drop stale or foreign owners", async ({
  page,
  request,
}) => {
  // Browser-side ACTUAL WebSocket receipt barrier. The hook is installed
  // BEFORE connect() navigates, so every goal frame is recorded inside the
  // page the moment the app's socket receives it — not merely observed by
  // Playwright's framereceived on the transport.
  // Seam: `window.WebSocket` is replaced by a SUBCLASS of the native
  // constructor whose constructor calls super() and then registers ONE
  // metadata-only observer on that real instance through its own UNMODIFIED
  // native addEventListener. No prototype method (addEventListener,
  // onmessage setter) is replaced and no app listener is wrapped, so the
  // app's listener identity, ordering, and removeEventListener semantics are
  // entirely native. Static constants (CONNECTING/OPEN/CLOSING/CLOSED) are
  // inherited. Only `session/goal/updated` metadata (method/owner/
  // generation/objective) is retained — no whole-frame capture.
  await page.addInitScript(() => {
    type GoalMeta = {
      method?: string;
      session_id?: string;
      generation?: number;
      objective?: string;
    };
    const receipts: GoalMeta[] = [];
    (window as unknown as { __goalReceipts?: GoalMeta[] }).__goalReceipts =
      receipts;
    const observeGoalFrames = (socket: WebSocket) => {
      socket.addEventListener("message", (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as {
            method?: string;
            params?: {
              session_id?: string;
              generation?: number;
              goal?: { objective?: string };
            };
          };
          if (frame?.method === "session/goal/updated") {
            const params = frame.params;
            const objective = params?.goal?.objective;
            // exactOptionalPropertyTypes forbids `key: undefined` for an
            // optional property, so omit each absent key rather than pass it
            // through; consumers only compare present fields.
            receipts.push({
              method: frame.method,
              ...(params?.session_id !== undefined
                ? { session_id: params.session_id }
                : {}),
              ...(params?.generation !== undefined
                ? { generation: params.generation }
                : {}),
              ...(objective !== undefined ? { objective } : {}),
            });
          }
        } catch {
          // Non-JSON control traffic is irrelevant to this barrier.
        }
      });
    };
    const NativeWebSocket = window.WebSocket;
    class GoalReceiptWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        observeGoalFrames(this);
      }
    }
    window.WebSocket = GoalReceiptWebSocket;
  });
  const probe = observe(page);
  const a = await connect(page, probe, "goal-gen");
  // Await an EXACT owner + generation + objective frame that is NEWLY
  // observed at/after the captured pre-injection count. Pinning the payload
  // and slicing from `start` means a duplicate-generation barrier can never
  // be satisfied by an EARLIER valid delivery of the same generation.
  const awaitNewGoalFrame = (
    start: number,
    generation: number,
    sessionId: string,
    objective: string,
  ) =>
    expect
      .poll(() =>
        probe.received
          .slice(start)
          .some(
            (frame) =>
              frame.method === "session/goal/updated" &&
              frame.params.session_id === sessionId &&
              frame.params.generation === generation &&
              (frame.params.goal as { objective?: string } | undefined)
                ?.objective === objective,
          ),
      )
      .toBe(true);
  type GoalReceipt = {
    method?: string;
    session_id?: string;
    generation?: number;
    objective?: string;
  };
  const browserGoalFrames = (): Promise<GoalReceipt[]> =>
    page.evaluate(
      () =>
        (window as unknown as { __goalReceipts?: GoalReceipt[] })
          .__goalReceipts ?? [],
    );
  // Browser-side barrier: the PAGE itself received and dispatched the exact
  // owner + generation + objective frame at/after the captured in-page count.
  const awaitBrowserGoalFrame = async (
    start: number,
    generation: number,
    sessionId: string,
    objective: string,
  ) => {
    await expect
      .poll(async () =>
        (await browserGoalFrames())
          .slice(start)
          .some(
            (frame) =>
              frame.method === "session/goal/updated" &&
              frame.session_id === sessionId &&
              frame.generation === generation &&
              frame.objective === objective,
          ),
      )
      .toBe(true);
  };
  const dialog = await openAutonomy(page);
  await dialog
    .getByLabel("Goal objective", { exact: true })
    .fill("Generation audit base goal");
  await dialog
    .getByRole("button", { name: "Set session goal", exact: true })
    .click();
  const goalRegion = dialog.getByRole("region", {
    name: "Session goal",
    exact: true,
  });
  await expect(goalRegion).toContainText("Generation audit base goal");
  // Core keeps ONE scalar goal_event_generation shared across sessions and
  // profiles, so a single session can observe an arbitrary base (not 1) and
  // interleaved gaps. A strictly-greater generation must always be admitted.
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "37",
    objective: "Arbitrary base 37",
  });
  await expect(goalRegion).toContainText("Arbitrary base 37");
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "92",
    objective: "Gap advance to 92",
  });
  await expect(goalRegion).toContainText("Gap advance to 92");
  // Rendering-drain helper: after the exact in-page receipt, let the page run
  // a macrotask and TWO animation frames so React commits and paints
  // everything queued behind the consumed (rejected) frame. The text poll
  // alone cannot prove draining — the still-92 text was already true before
  // injection — so the negative assertions below run only after these
  // browser turns complete. No later goal event is injected to substitute.
  const awaitGoalRegionSettled = async (applied: string) => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }, 0);
        }),
    );
    await expect.poll(() => goalRegion.textContent()).toContain(applied);
  };
  // A non-increasing generation must be dropped: the objective stays put.
  // Capture the pre-injection frame counts (transport AND in-page receipt
  // log), then require the EXACT newly observed duplicate frame (owner +
  // generation + objective) at BOTH barriers, await rendering settlement on
  // the still-applied objective, and only then run the negative assertion.
  const beforeDuplicate = probe.received.length;
  const beforeDuplicateInPage = (await browserGoalFrames()).length;
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "92",
    objective: "DUPLICATE 92 MUST NOT RENDER",
  });
  await awaitNewGoalFrame(
    beforeDuplicate,
    92,
    a.sessionId,
    "DUPLICATE 92 MUST NOT RENDER",
  );
  await awaitBrowserGoalFrame(
    beforeDuplicateInPage,
    92,
    a.sessionId,
    "DUPLICATE 92 MUST NOT RENDER",
  );
  await awaitGoalRegionSettled("Gap advance to 92");
  await expect(goalRegion).not.toContainText("DUPLICATE 92 MUST NOT RENDER");
  // A strictly-lower generation must be dropped the same way.
  // "Gap advance to 92" stays the applied objective: no intermediate valid
  // event is admitted between the negatives, so a later legitimate frame can
  // never mask this rejection.
  const beforeStale = probe.received.length;
  const beforeStaleInPage = (await browserGoalFrames()).length;
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "50",
    objective: "STALE MUST NOT RENDER",
  });
  await awaitNewGoalFrame(
    beforeStale,
    50,
    a.sessionId,
    "STALE MUST NOT RENDER",
  );
  await awaitBrowserGoalFrame(
    beforeStaleInPage,
    50,
    a.sessionId,
    "STALE MUST NOT RENDER",
  );
  await awaitGoalRegionSettled("Gap advance to 92");
  await expect(goalRegion).not.toContainText("STALE MUST NOT RENDER");
  // A wrong-owner event with a huge generation must not mutate this session.
  // It advances the shared scalar (so later genuine stamps are higher) but the
  // browser's per-owner watermark must not be poisoned by it.
  const beforeForeign = probe.received.length;
  const beforeForeignInPage = (await browserGoalFrames()).length;
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "5000",
    objective: "FOREIGN MUST NOT RENDER",
    foreign: "1",
  });
  await awaitNewGoalFrame(
    beforeForeign,
    5000,
    `${a.sessionId}-other`,
    "FOREIGN MUST NOT RENDER",
  );
  await awaitBrowserGoalFrame(
    beforeForeignInPage,
    5000,
    `${a.sessionId}-other`,
    "FOREIGN MUST NOT RENDER",
  );
  await awaitGoalRegionSettled("Gap advance to 92");
  await expect(goalRegion).not.toContainText("FOREIGN MUST NOT RENDER");
  // A genuine same-owner event after a huge foreign stamp is still strictly
  // greater than the last APPLIED owner generation (92) yet far BELOW the
  // foreign 5000 stamp, so it renders only if the foreign frame never
  // poisoned this owner's watermark.
  const beforeOwner = probe.received.length;
  const beforeOwnerInPage = (await browserGoalFrames()).length;
  await nativeControl(request, "generation", a.sessionId, undefined, {
    to: "93",
    objective: "Owner 93 after foreign",
  });
  await awaitNewGoalFrame(
    beforeOwner,
    93,
    a.sessionId,
    "Owner 93 after foreign",
  );
  await awaitBrowserGoalFrame(
    beforeOwnerInPage,
    93,
    a.sessionId,
    "Owner 93 after foreign",
  );
  await expect(goalRegion).toContainText("Owner 93 after foreign");
  expect(probe.calls("turn/start")).toHaveLength(0);
});

test("native monitors create, list, pause, resume and delete through typed receipts", async ({
  page,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "monitors");
  const dialog = await openAutonomy(page, "/monitor");
  await dialog
    .getByLabel("New monitor name", { exact: true })
    .fill("watch-build");
  await dialog
    .getByLabel("New monitor probe command", { exact: true })
    .fill('["./scripts/watch.sh", "--verbose"]');
  await dialog
    .getByRole("button", { name: "Create monitor", exact: true })
    .click();
  await expect(
    dialog.getByRole("list", { name: "Monitor list" }).getByRole("listitem"),
  ).toHaveCount(1);
  expect(probe.calls("monitor/create")[0]!.params).toEqual({
    session_id: a.sessionId,
    name: "watch-build",
    argv: ["./scripts/watch.sh", "--verbose"],
    mode: "poll",
  });
  const row = dialog
    .getByRole("list", { name: "Monitor list" })
    .getByRole("listitem")
    .filter({ hasText: "watch-build" });
  const createdCall = probe.calls("monitor/create")[0]!;
  await probe.settled(createdCall);
  const createdReply = probe.received.find(
    (frame) => frame.id === createdCall.id,
  );
  const createdResult = createdReply?.result as
    | { ok?: boolean; status?: string; created?: boolean; monitor_id?: string }
    | undefined;
  expect(createdResult?.ok).toBe(true);
  expect(createdResult?.created).toBe(true);
  expect(createdResult?.status).toBe("active");
  expect(typeof createdResult?.monitor_id).toBe("string");
  await row.getByRole("button", { name: /^Pause monitor / }).click();
  const pauseCall = probe.calls("monitor/pause")[0]!;
  expect(pauseCall.params.monitor_id).toBe(createdResult?.monitor_id);
  await probe.settled(pauseCall);
  const pauseReply = probe.received.find((frame) => frame.id === pauseCall.id);
  expect(
    (pauseReply?.result as { ok?: boolean; status?: string } | undefined)?.ok,
  ).toBe(true);
  expect(
    (
      pauseReply?.result as
        | { status?: string; monitor?: { pause_reason?: string | null } }
        | undefined
    )?.status,
  ).toBe("paused");
  expect(
    (
      pauseReply?.result as
        { monitor?: { pause_reason?: string | null } } | undefined
    )?.monitor?.pause_reason,
  ).toBe("user");
  await expect(
    row.getByRole("button", { name: /^Resume monitor / }),
  ).toBeEnabled();
  await row.getByRole("button", { name: /^Resume monitor / }).click();
  const resumeCall = probe.calls("monitor/resume")[0]!;
  await probe.settled(resumeCall);
  const resumeReply = probe.received.find(
    (frame) => frame.id === resumeCall.id,
  );
  expect(
    (resumeReply?.result as { ok?: boolean; status?: string } | undefined)?.ok,
  ).toBe(true);
  expect((resumeReply?.result as { status?: string } | undefined)?.status).toBe(
    "active",
  );
  await expect(
    row.getByRole("button", { name: /^Pause monitor / }),
  ).toBeEnabled();
  await row.getByRole("button", { name: /^Delete monitor / }).click();
  const deleteCall = probe.calls("monitor/delete")[0]!;
  await probe.settled(deleteCall);
  const deleteReply = probe.received.find(
    (frame) => frame.id === deleteCall.id,
  );
  expect(
    (deleteReply?.result as { ok?: boolean; deleted?: boolean } | undefined)
      ?.ok,
  ).toBe(true);
  expect(
    (deleteReply?.result as { deleted?: boolean } | undefined)?.deleted,
  ).toBe(true);
  await expect(row).toHaveCount(0);
  const monitorId = probe.calls("monitor/pause")[0]!.params.monitor_id;
  for (const method of ["monitor/pause", "monitor/resume", "monitor/delete"])
    expect(probe.calls(method)[0]!.params).toEqual({
      session_id: a.sessionId,
      monitor_id: monitorId,
    });
  expect(probe.calls("turn/start")).toHaveLength(0);
});

test("native fixed-loop fire now sends one typed manual receipt without changing loop status", async ({
  page,
}) => {
  const probe = observe(page);
  const a = await connect(page, probe, "fire-now");
  const dialog = await openAutonomy(page, "/loop");
  const form = dialog.getByRole("form", { name: "Create native loop" });
  await form.getByLabel("Loop cadence").selectOption("fixed_interval");
  await form.getByLabel("New loop prompt").fill("Native manual fire loop");
  await form.getByLabel("Loop interval").fill("5min");
  await form.getByRole("button", { name: "Create loop", exact: true }).click();
  const row = dialog
    .getByRole("list", { name: "Loop list" })
    .getByRole("listitem")
    .filter({ hasText: "Native manual fire loop" });
  const created = probe.calls("loop/create")[0]!;
  await probe.settled(created);
  const createdReply = probe.received.find((frame) => frame.id === created.id);
  const loopId = (createdReply?.result as { loop_id?: string } | undefined)
    ?.loop_id;
  if (typeof loopId !== "string")
    throw new Error("Expected a created native loop id");
  await expect(row.getByRole("button", { name: /^Fire loop / })).toBeEnabled();
  await row.getByRole("button", { name: /^Fire loop / }).click();
  const fireCall = probe.calls("loop/fire_now")[0]!;
  await probe.settled(fireCall);
  expect(probe.calls("loop/fire_now")).toHaveLength(1);
  expect(fireCall.params).toEqual({
    session_id: a.sessionId,
    loop_id: loopId,
  });
  const fireReply = probe.received.find((frame) => frame.id === fireCall.id);
  const fireResult = fireReply?.result as
    | {
        ok?: boolean;
        status?: string;
        loop_id?: string;
        loop?: {
          status?: string;
          loop_id?: string;
          last_run_at_ms?: number | null;
        };
        fire?: {
          queued?: boolean;
          duplicate?: boolean;
          continuation_id?: number;
          reason?: string;
        };
      }
    | undefined;
  expect(fireResult?.ok).toBe(true);
  expect(fireResult?.loop_id).toBe(loopId);
  expect(fireResult?.loop?.loop_id).toBe(loopId);
  // Core returns top-level status "queued" (the enqueue outcome) while the
  // nested loop record keeps its own unchanged "active" status.
  expect(fireResult?.status).toBe("queued");
  expect(fireResult?.loop?.status).toBe("active");
  expect(fireResult?.fire?.queued).toBe(true);
  expect(fireResult?.fire?.duplicate).toBe(false);
  expect(typeof fireResult?.fire?.continuation_id).toBe("number");
  expect(fireResult?.fire?.reason).toBe("LoopFire");
  // The fire is visible in the panel's status region.
  await expect(
    autonomy(page).getByRole("status").filter({ hasText: `${loopId} fired` }),
  ).toContainText(`${loopId} fired`);
  // Firing is not pausing: the loop stays active and pause remains available.
  await expect(row.getByRole("button", { name: /^Pause loop / })).toBeEnabled();
  expect(probe.calls("turn/start")).toHaveLength(0);
});
