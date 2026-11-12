import { expect, test } from "@playwright/test";
import { disconnect } from "./fixture-controls";
import { startSession } from "./fixture-session";
import { productNavigation, sessionRow } from "./sessions";
import { sendEnvelope, sendResult } from "./wire";

test("continues past an unknown turn without replaying it or losing the queue and new draft", async ({
  page,
  request,
}) => {
  const opens: string[] = [];
  const starts: { sessionId: string; turnId: string; text: string }[] = [];
  const interrupts: string[] = [];
  let holdLookup = false;
  let finishLookup: (() => void) | undefined;
  let emitBackgroundProgress: (() => void) | undefined;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "session/open") opens.push(frame.params.session_id);
      if (frame.method === "turn/start") {
        starts.push({
          sessionId: frame.params.session_id,
          turnId: frame.params.turn_id,
          text: frame.params.input[0].text,
        });
        if (starts.length === 1) {
          sendResult(socket, frame.id, {});
          return;
        }
      }
      if (frame.method === "turn/interrupt")
        interrupts.push(frame.params.session_id);
      if (frame.method === "turn/state/get") {
        emitBackgroundProgress = () =>
          sendEnvelope(
            socket,
            frame.params,
            { thread: "background-tail", seq: 1, cursor: 1000 },
            "tool_progress",
            {
              name: "run",
              tool_call_id: "background-cleanup",
              message: "Cleaning up background work",
            },
          );
        finishLookup = () =>
          sendResult(socket, frame.id, { ...frame.params, state: "unknown" });
        if (!holdLookup) finishLookup();
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await startSession(page, "/workspace/runtime-recovery");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeVisible();
  await composer.fill(
    "A turn whose acknowledgement survives but ledger does not",
  );
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await composer.fill("Send this queued message once");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await disconnect(request);
  const check = page.getByRole("button", { name: "Check status", exact: true });
  await expect(check).toBeVisible({ timeout: 15_000 });
  // Core can keep emitting canonical tool activity after foreground terminal.
  // This must not erase an observer's unresolved foreground lifecycle state.
  if (!emitBackgroundProgress) throw new Error("Missing lifecycle lookup");
  emitBackgroundProgress();
  await expect(check).toBeVisible();
  expect(opens).toHaveLength(2);
  const sessionId = opens[0];
  await composer.fill("Keep this draft while the status is unknown");
  const workspace = page.getByRole("button", {
    name: "runtime-recovery",
    exact: true,
  });
  await workspace.hover();
  await page
    .getByRole("button", { name: "New session in runtime-recovery" })
    .click();

  await expect(
    page.getByText(/Check the current turn status before switching Sessions/),
  ).toBeVisible();
  await expect(check).toBeVisible();
  await expect(composer).toHaveValue(
    "Keep this draft while the status is unknown",
  );
  expect(opens).toEqual([sessionId, sessionId]);
  expect(starts).toHaveLength(1);

  const continueButton = page.getByRole("button", {
    name: "Continue without it",
    exact: true,
  });
  holdLookup = true;
  await check.click();
  await expect(
    page.getByRole("button", { name: "Checking status…" }),
  ).toBeDisabled();
  await expect(continueButton).toHaveCount(0);
  if (!finishLookup) throw new Error("Missing lifecycle lookup");
  finishLookup();
  await continueButton.click();
  await expect(check).toHaveCount(0);
  await expect.poll(() => starts.length).toBe(2);
  expect(starts.map((turn) => turn.text)).toEqual([
    "A turn whose acknowledgement survives but ledger does not",
    "Send this queued message once",
  ]);
  expect(starts.every((turn) => turn.sessionId === sessionId)).toBe(true);
  expect(new Set(starts.map((turn) => turn.turnId)).size).toBe(2);
  expect(interrupts).toEqual([]);
  await expect(
    page.getByText("Response outcome unknown", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Turn stopped", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Completed with/)).toBeVisible();
  await expect(composer).toHaveValue(
    "Keep this draft while the status is unknown",
  );
  const originalSession = await page
    .locator('[role="treeitem"][data-session-id]')
    .first()
    .getAttribute("data-session-id");
  if (!originalSession) throw new Error("Missing original Session");
  await workspace.hover();
  await page
    .getByRole("button", { name: "New session in runtime-recovery" })
    .click();
  await expect.poll(() => opens.length).toBe(3);
  expect(opens[2]).not.toBe(sessionId);
  expect(starts).toHaveLength(2);
  await expect(composer).toHaveValue("");
  await sessionRow(productNavigation(page), originalSession).click();
  await expect(composer).toHaveValue(
    "Keep this draft while the status is unknown",
  );
  expect(interrupts).toEqual([]);
});
