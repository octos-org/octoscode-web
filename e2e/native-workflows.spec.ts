import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { holdTerminals, releaseTerminal } from "./fixture-controls";
import { connectAndStartWorkspace, FIXTURE_ORIGIN } from "./fixture-session";
import {
  composer,
  newSessionIn,
  productNavigation,
  selectedSessionId,
} from "./sessions";
import { observeFrames } from "./turn-observers";

type Probe = ReturnType<typeof observeFrames>;
/** The selected row's id, which embeds the Session id. */
const selectedRow = (page: Page) => selectedSessionId(productNavigation(page));
async function selectSession(page: Page, sessionId: string) {
  await productNavigation(page)
    .locator(`[role="treeitem"][data-session-id*=${JSON.stringify(sessionId)}]`)
    .click();
  await expect.poll(() => selectedRow(page)).toContain(sessionId);
  await expect(composer(page)).toBeEnabled();
}
// v0.10.0's QueuedPrompts replaced our pre-rebase `.prompt-queue` div with
// `<section aria-label="Queued prompts">` under CSS-module class names
// (apps/web/src/features/composer/QueuedPrompts.tsx:14). Target the accessible
// name — the stable contract — never a module-hashed class.
const promptQueue = (page: Page) =>
  page.getByRole("region", { name: "Queued prompts" });

async function connect(page: Page, probe: Probe, name: string, native = true) {
  const cwd = `/srv/work/${native ? "native-workflows-" : "native-disabled-"}${name}`;
  await connectAndStartWorkspace(page, cwd);
  await expect
    .poll(() => probe.calls("session/open").length)
    .toBeGreaterThan(0);
  const sessionId = probe.calls("session/open").at(-1)!.params!.session_id;
  if (typeof sessionId !== "string")
    throw new Error("Expected a full Session ID");
  return {
    sessionId,
    workspace: cwd.split("/").at(-1)!,
  };
}
async function sibling(page: Page, probe: Probe, workspace: string) {
  const opens = probe.calls("session/open").length;
  await newSessionIn(productNavigation(page), workspace);
  await expect.poll(() => probe.calls("session/open").length).toBe(opens + 1);
  await expect(composer(page)).toBeEnabled();
  const sessionId = probe.calls("session/open").at(-1)!.params!.session_id;
  if (typeof sessionId !== "string")
    throw new Error("Expected a sibling Session ID");
  return { sessionId };
}
async function submit(page: Page, text: string) {
  await composer(page).fill(text);
  // Escape dismisses an open palette, but otherwise interrupts active work.
  // Ordinary prompt submission must not change the owning turn's lifecycle.
  if (await page.getByRole("listbox", { name: "Commands" }).isVisible()) {
    await composer(page).press("Escape");
  }
  await page
    .getByRole("button", { name: /^(Send|Queue|Steer) prompt$/ })
    .click();
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
      await request.post(`${FIXTURE_ORIGIN}/__test__/native/${action}?${query}`)
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
        `${FIXTURE_ORIGIN}/__test__/native/state?${new URLSearchParams({ session_id: sessionId })}`,
      );
      return ((await result.json()) as { held: string[] }).held;
    })
    .toContain(method);
}
async function terminal(probe: Probe, turnId: unknown) {
  await expect
    .poll(() =>
      probe
        .events("projection/envelope")
        .some(
          (frame) =>
            frame.params?.turn_id === turnId &&
            frame.params?.payload?.type === "turn_terminal",
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
  const probe = observeFrames(page);
  await connect(page, probe, "capabilities", false);
  // v0.10.0 promoted `turn/state/get` + `state.turn_state_get.v1` into the
  // fixture's BASE capabilities (mock-ui-server.mjs:1866,1899) and answers them
  // for non-native Sessions through the generic lookup (:2779-2783, :3418), so
  // `/turn` is no longer one of the withheld natives. Keep it covered on the
  // OTHER side of the same gate — an advertised command must resolve — rather
  // than dropping the case.
  await submit(page, "/turn state 00000000-0000-4000-8000-000000000001");
  const advertised = page.getByRole("dialog", { name: "Turn state" });
  await expect(advertised).toBeVisible();
  await advertised.getByRole("button", { name: "Close inspector" }).click();
  await expect(advertised).toHaveCount(0);
  for (const command of [
    "/btw explain",
    "/threads",
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
  // `turn/state/get` is intentionally absent from this list: it is advertised
  // here (see above) and the `/turn` case asserts it is actually driven.
  expect(
    probe.sent.filter((frame) =>
      [
        "session/btw",
        "thread/graph/get",
        "approval/scopes/list",
        "session/goal/get",
        "agent/list",
        "loop/create",
      ].includes(frame.method ?? ""),
    ),
  ).toHaveLength(0);
  expect(probe.calls("turn/state/get").length).toBeGreaterThanOrEqual(1);
});

test("Enter steers a compatible running turn by default, while the Queue control defers it", async ({
  page,
  request,
}) => {
  // Locks in the steer-by-default composer semantics (#202): the turn
  // controller starts with steering on, so a fresh native Session never
  // requires the /steer toggle for compatible text.
  const probe = observeFrames(page);
  const a = await connect(page, probe, "steering-default");
  await holdTerminals(request);
  await submit(page, "Default-steering active owner");
  await expect.poll(() => probe.calls("turn/start").length).toBe(1);
  const first = probe.calls("turn/start")[0]!;
  await probe.settled(first);

  // No /steer on: plain Enter must still steer the running turn.
  await submit(page, "Default-steered follow-up");
  await expect.poll(() => probe.calls("turn/steer").length).toBe(1);
  await probe.settled(probe.calls("turn/steer")[0]!);
  expect(probe.calls("turn/steer")[0]!.params).toEqual({
    session_id: a.sessionId,
    expected_turn_id: first.params!.turn_id,
    input: [{ kind: "text", text: "Default-steered follow-up" }],
  });
  expect(probe.calls("turn/interrupt")).toHaveLength(0);

  // The Queue control defers compatible input that Enter would steer: the
  // text rides the existing FIFO as a pending turn, never a second steer.
  await composer(page).fill("Explicitly queued after the active turn");
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(
    page.getByText("Explicitly queued after the active turn"),
  ).toBeVisible();
  expect(probe.calls("turn/steer")).toHaveLength(1);
  expect(probe.calls("turn/interrupt")).toHaveLength(0);

  // Tab still queues deliberately: the steer path must not swallow it. Empty
  // the FIFO first (Enter only steers while nothing is queued), then wait for
  // the queued row before counting, so the count cannot pass before Tab has
  // done anything.
  await promptQueue(page)
    .getByRole("button", { name: "Remove queued prompt 1" })
    .click();
  await expect(promptQueue(page)).toHaveCount(0);
  await composer(page).fill("Queued with Tab after the active turn");
  await composer(page).press("Tab");
  await expect(promptQueue(page)).toContainText(
    "Queued with Tab after the active turn",
  );
  expect(probe.calls("turn/steer")).toHaveLength(1);
  expect(probe.calls("turn/interrupt")).toHaveLength(0);
});

test("a dropped native steer returns once to its owning FIFO while a different Session is selected", async ({
  page,
  request,
}) => {
  const probe = observeFrames(page);
  const a = await connect(page, probe, "steering");
  await submit(page, "/steer on");
  await holdTerminals(request);
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
    expected_turn_id: first.params!.turn_id,
    input: [{ kind: "text", text: "Returned native steering text" }],
  });
  await submit(page, "/turn");
  const turn = page.getByRole("dialog", { name: "Turn state" });
  await expect(
    turn.getByRole("region", { name: "Native turn state" }),
  ).toContainText("active");
  expect(probe.calls("turn/state/get").at(-1)!.params).toEqual({
    session_id: a.sessionId,
    turn_id: first.params!.turn_id,
  });
  await turn.getByRole("button", { name: "Close inspector" }).click();
  const b = await sibling(page, probe, a.workspace);
  await submit(page, "Independent native owner B");
  await expect.poll(() => probe.calls("turn/start").length).toBe(2);
  await terminal(probe, probe.calls("turn/start")[1]!.params!.turn_id);
  await composer(page).fill("Retain native B draft");
  for (let count = 0; count < 2; count += 1)
    await nativeControl(request, "steer-drop", a.sessionId);
  await expect.poll(() => probe.events("turn/steer_dropped").length).toBe(2);
  expect(await selectedRow(page)).toContain(b.sessionId);
  await expect(promptQueue(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Retain native B draft");
  await selectSession(page, a.sessionId);
  await expect(promptQueue(page).locator("strong")).toHaveText("1 queued");
  await submit(page, "/steer off");
  await submit(page, "Ordinary native FIFO successor");
  await expect(promptQueue(page).locator("strong")).toHaveText("2 queued");
  await selectSession(page, b.sessionId);
  await releaseTerminal(request, a.sessionId);
  await expect.poll(() => probe.calls("turn/start").length).toBe(4);
  const aStarts = probe
    .calls("turn/start")
    .filter((frame) => frame.params!.session_id === a.sessionId);
  expect(aStarts.map((frame) => frame.params!.input[0].text)).toEqual([
    "Native steering active owner A",
    "Returned native steering text",
    "Ordinary native FIFO successor",
  ]);
  expect(new Set(aStarts.map((frame) => frame.params!.turn_id)).size).toBe(3);
  await terminal(probe, aStarts[2]!.params!.turn_id);
  expect(await selectedRow(page)).toContain(b.sessionId);
  await expect(composer(page)).toHaveValue("Retain native B draft");
  expect(probe.calls("turn/steer")).toHaveLength(1);
  await expect(page.locator(".timeline")).not.toContainText(
    "Returned native steering text",
  );
});

test("goal pause, resume and stop preserve the current objective and budget, and newer notifications cancel stale transitions", async ({
  page,
  request,
}) => {
  const probe = observeFrames(page);
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
  const probe = observeFrames(page);
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
  const reading = dialog.getByText("Reading agent details…");
  await expect(reading).toBeVisible();
  await nativeControl(request, "release", a.sessionId, "agent/status/read");
  await probe.settled(probe.calls("agent/status/read")[0]!);
  // The released read was answered before the close: it must not install
  // its stale running status.
  await expect(reading).toHaveCount(0);
  await expect(
    dialog.locator('[aria-label="Agent status detail"]'),
  ).toHaveCount(0);
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
  expect(await selectedRow(page)).toContain(b.sessionId);
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
  expect(admitted.params!.session_id).toBe(b.sessionId);
  expect(admitted.params!.input).toEqual([
    {
      kind: "text",
      text: "Spawn 2 agent(s) to accomplish in parallel: Independent finite native reviews",
    },
  ]);
  expect(admitted.params!.turn_id).toMatch(
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i,
  );
  await terminal(probe, admitted.params!.turn_id);
  expect(probe.calls("turn/start")).toHaveLength(1);
  expect(probe.calls("agent/spawn")).toHaveLength(0);
  expect(await selectedRow(page)).toContain(b.sessionId);
});
