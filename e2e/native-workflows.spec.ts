import { expect, test, type Page } from "@playwright/test";
import { holdTerminals } from "./fixture-controls";
import { connectAndStartWorkspace } from "./fixture-session";
import { composer } from "./sessions";
import { observeFrames } from "./turn-observers";

type Probe = ReturnType<typeof observeFrames>;
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
