import { expect, test } from "@playwright/test";
import { holdTerminals, releaseTerminal } from "./fixture-controls";
import { FIXTURE_ORIGIN, connectAndStartWorkspace } from "./fixture-session.ts";
import {
  newSessionIn,
  productNavigation,
  selectSession,
  selectedSessionId,
  sendPrompt,
} from "./sessions";
import {
  observeFrames,
  observeStartedTurns,
  observeInterrupts,
  trackRuntimeErrors,
  type StartedTurn,
} from "./turn-observers";

const WORKSPACE_NAME = "multi-session-recovery-soak";
const WORKSPACE_PARKED = `${WORKSPACE_NAME}-parked`;
const APPROVAL_TITLE = "Run product checks?";

// Every case must leave the fixture inert even when an assertion throws.
test.afterEach(async ({ request }) => {
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/reset");
  await request.post(FIXTURE_ORIGIN + "/__test__/peers/reset");
});

/** The Session id that admitted the ONE turn whose prompt text is `text`. */
function sessionIdForPrompt(started: StartedTurn[], text: string): string {
  const matched = started.filter((turn) => turn.text === text);
  if (matched.length !== 1) {
    throw new Error(
      `Expected exactly one turn/start for ${text}, saw ${matched.length}`,
    );
  }
  return matched[0]!.sessionId;
}

test("parks a background approval on its owning Session across A/B/C switching, drains its queued followup, and survives an observer reconnect", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cwd = `/srv/work/${WORKSPACE_PARKED}`;
  const started = observeStartedTurns(page);
  const frames = observeFrames(page);
  const terminals = () =>
    frames
      .events("projection/envelope")
      .filter((frame) => frame.params?.payload?.type === "turn_terminal");
  const interrupts = observeInterrupts(page);
  const errors = trackRuntimeErrors(page);
  await request.post(FIXTURE_ORIGIN + "/__test__/terminal/reset");
  await connectAndStartWorkspace(page, cwd);
  const sidebar = productNavigation(page);
  const trace = "A-after-parked-approval";

  const titleA = await selectedSessionId(sidebar);
  // The composer — and the "N queued" strip it renders (v0.10.0's QueuedPrompts,
  // `<section aria-label="Queued prompts">`) — is mounted only
  // while NO interaction owns the surface: the shipped contract swaps in
  // ApprovalPanel/UserQuestionPanel and replaces `.composer` outright
  // (see the takeover branch in App.tsx). The "1 queued" observation therefore has to happen
  // BEFORE the approval parks, never behind it.
  //
  // Hold the approval turn's turn/start acknowledgement: the fixture raises
  // approval/requested from streamTurn(), which the held-admission path only
  // reaches once the acknowledgement is released, so the composer stays mounted.
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/hold-next")
    ).status(),
  ).toBe(204);
  await sendPrompt(page, "Request approval fixture");
  await expect(page.getByRole("button", { name: /^Starting/ })).toBeVisible();

  // A queued followup admitted behind the not-yet-raised approval must not
  // start yet.
  await sendPrompt(page, trace);
  await expect(page.getByText(/\b1 queued\b/)).toBeVisible();

  // Admit the held approval turn: it raises approval/requested, the panel takes
  // over the composer, and `trace` stays queued behind the parked interaction.
  //
  // Use /release, not /admit: /admit calls the raw admit() closure and leaves
  // `heldTurnStart` set for session A (mock-ui-server.mjs:1057 never reaches
  // takeHeldTurnStart()). The turn/start guard then rejects EVERY later
  // turn/start for A — including the queued `trace` — through its
  // `heldTurnStart?.sessionId === sessionId` disjunct (mock-ui-server.mjs:2767)
  // as "the Session is already active", so trace never starts and never
  // consumes the armed terminal hold. /release clears the held record via
  // takeHeldTurnStart() and admits in one step (mock-ui-server.mjs:1102-1114).
  expect(
    (
      await request.post(FIXTURE_ORIGIN + "/__test__/turn-start/release")
    ).status(),
  ).toBe(204);
  const dialog = page.getByRole("dialog", { name: APPROVAL_TITLE });
  await expect(dialog).toBeVisible();
  const approval = frames.events("approval/requested")[0]!;
  const sessionA = String(approval.params!.session_id);

  const titleB = await newSessionIn(sidebar, WORKSPACE_PARKED);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  const titleC = await newSessionIn(sidebar, WORKSPACE_PARKED);
  expect(new Set([titleA, titleB, titleC]).size).toBe(3);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  expect(started().map((turn) => turn.text)).not.toContain(trace);

  // correction2150 gap: B/C previously only created the parked A/B/C shape but
  // never ran real work there. Each now runs ONE independent ordinary
  // (non-approval) turn while A stays parked, and must reach ITS EXACT
  // captured (session_id, turn_id) completed terminal exactly once.
  const promptB = "B-independent-turn";
  const promptC = "C-independent-turn";
  await selectSession(sidebar, titleB);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await sendPrompt(page, promptB);
  await selectSession(sidebar, titleC);
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await sendPrompt(page, promptC);
  await expect
    .poll(() => started().filter((turn) => turn.text === promptB).length)
    .toBe(1);
  await expect
    .poll(() => started().filter((turn) => turn.text === promptC).length)
    .toBe(1);
  const turnB = started().find((turn) => turn.text === promptB)!;
  const turnC = started().find((turn) => turn.text === promptC)!;
  // B and C own DIFFERENT native ids, each distinct from the parked Session A.
  expect(turnB.sessionId).not.toBe(turnC.sessionId);
  expect(turnB.sessionId).not.toBe(sessionA);
  expect(turnC.sessionId).not.toBe(sessionA);
  expect(turnB.turnId).not.toBe(turnC.turnId);
  const completedTerminals = (turn: StartedTurn) =>
    terminals().filter(
      (terminal) =>
        terminal.params!.session_id === turn.sessionId &&
        terminal.params!.turn_id === turn.turnId &&
        terminal.params!.payload.data?.outcome === "completed",
    );
  await expect.poll(() => completedTerminals(turnB).length).toBe(1);
  await expect.poll(() => completedTerminals(turnC).length).toBe(1);
  // No output leaks either way: A authored no terminal yet, and each B/C
  // Session admitted ONLY its own prompt.
  expect(
    terminals().filter((terminal) => terminal.params!.session_id === sessionA),
  ).toHaveLength(0);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnB.sessionId)
      .map((turn) => turn.text),
  ).toEqual([promptB]);
  expect(
    started()
      .filter((turn) => turn.sessionId === turnC.sessionId)
      .map((turn) => turn.text),
  ).toEqual([promptC]);
  // Before returning: nothing was answered and the queued followup waits.
  expect(frames.calls("approval/respond")).toHaveLength(0);
  expect(frames.calls("user_question/respond")).toHaveLength(0);
  expect(frames.events("approval/requested")).toHaveLength(1);
  expect(started().map((turn) => turn.text)).not.toContain(trace);

  // Returning to A restores the parked interaction: the panel replaces the
  // composer again, so the queued strip is NOT re-rendered here (`trace` is
  // still waiting behind the untouched parked record).
  await selectSession(sidebar, titleA);
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await holdTerminals(request, 1);
  await dialog.getByRole("button", { name: /Allow once/ }).click();
  await expect(page.getByRole("dialog", { name: APPROVAL_TITLE })).toHaveCount(
    0,
  );
  const respond = frames.calls("approval/respond");
  expect(respond).toHaveLength(1);
  expect(respond[0]!.params).toMatchObject({
    session_id: sessionA,
    approval_id: approval.params!.approval_id,
  });

  await expect
    .poll(() => started().filter((turn) => turn.text === trace).length)
    .toBe(1);
  expect(sessionIdForPrompt(started(), trace)).toBe(sessionA);
  await releaseTerminal(request, sessionA);
  await expect
    .poll(
      () =>
        terminals().filter(
          (terminal) =>
            terminal.params!.session_id === sessionA &&
            terminal.params!.payload.data?.outcome === "completed",
        ).length,
    )
    .toBe(2);
  expect(interrupts()).toBe(0);

  // Observer reconnect: the transcript and admission count must be stable.
  const admissionCount = started().length;
  await page.reload();
  const restored = productNavigation(page);
  await selectSession(restored, titleA);
  await expect(page.getByText(trace, { exact: true })).toBeVisible();
  await expect(page.getByText(/\b1 queued\b/)).toHaveCount(0);
  await selectSession(restored, titleB);
  await expect(page.getByText(trace, { exact: true })).toHaveCount(0);
  expect(started()).toHaveLength(admissionCount);
  expect(errors().unhandled).toEqual([]);
  expect(errors().consoleErrors).toEqual([]);
});
