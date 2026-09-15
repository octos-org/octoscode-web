import { expect, test } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

test("retains an unresolved turn when navigation would discard its only status record", async ({
  page,
  request,
}) => {
  const opens: string[] = [];
  const starts: string[] = [];
  let completed = false;
  let emitBackgroundProgress: (() => void) | undefined;
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "session/open") opens.push(frame.params.session_id);
      if (frame.method === "turn/start") {
        starts.push(frame.params.turn_id);
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
        );
        return;
      }
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
                    progress: "Cleaning up background work",
                  },
                },
              },
            }),
          );
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            result: {
              ...frame.params,
              state: completed ? "completed" : "unknown",
            },
          }),
        );
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
  const composer = page.getByRole("combobox", { name: "Message Octos" });
  await expect(composer).toBeVisible();
  await composer.fill(
    "A turn whose acknowledgement survives but ledger does not",
  );
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
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

  completed = true;
  await check.click();
  await expect(check).toHaveCount(0);
  await workspace.hover();
  await page
    .getByRole("button", { name: "New session in runtime-recovery" })
    .click();
  await expect.poll(() => opens.length).toBe(3);
  expect(opens[2]).not.toBe(sessionId);
  expect(starts).toHaveLength(1);
});
