import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

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
          socket.send(
            JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
          );
          return;
        }
      }
      if (frame.method === "turn/interrupt")
        interrupts.push(frame.params.session_id);
      if (frame.method === "turn/state/get") {
        emitBackgroundProgress = () =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "projection/envelope",
              params: {
                session_id: frame.params.session_id,
                turn_id: frame.params.turn_id,
                thread_id: "background-tail",
                seq: 1,
                cursor: { stream: frame.params.session_id, seq: 1000 },
                payload: {
                  type: "tool_progress",
                  data: {
                    name: "run",
                    tool_call_id: "background-cleanup",
                    message: "Cleaning up background work",
                  },
                },
              },
            }),
          );
        finishLookup = () =>
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              result: { ...frame.params, state: "unknown" },
            }),
          );
        if (!holdLookup) finishLookup();
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/runtime-recovery");
  await page.getByLabel("Server workspace path").press("Enter");
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
  await request.post(`${FIXTURE_ORIGIN}/__test__/disconnect`);
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
    .getByRole("treeitem", { name: /Session / })
    .first()
    .locator('[class*="sessionTitle"]')
    .textContent();
  if (!originalSession) throw new Error("Missing original Session");
  await workspace.hover();
  await page
    .getByRole("button", { name: "New session in runtime-recovery" })
    .click();
  await expect.poll(() => opens.length).toBe(3);
  expect(opens[2]).not.toBe(sessionId);
  expect(starts).toHaveLength(2);
  await expect(composer).toHaveValue("");
  await page
    .getByRole("treeitem", { name: /Session / })
    .filter({ hasText: originalSession })
    .click();
  await expect(composer).toHaveValue(
    "Keep this draft while the status is unknown",
  );
  expect(interrupts).toEqual([]);
});
