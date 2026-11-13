import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { connect } from "./fixture-session";
import { sendError } from "./wire";

async function controlledHydrates(page: Page) {
  const sockets: WebSocketRoute[] = [];
  const opens: string[] = [];
  const hydrates: string[] = [];
  const control = { failures: 0, unreachable: false };
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    if (control.unreachable) return socket.close({ code: 1006 });
    sockets.push(socket);
    const server = socket.connectToServer();
    const requests = new Map<string, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      requests.set(String(request.id), request.method);
      if (request.method === "session/open")
        opens.push(request.params.session_id);
      if (request.method === "session/hydrate")
        hydrates.push(request.params.session_id);
      server.send(message);
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (
        control.failures > 0 &&
        requests.get(String(response.id)) === "session/hydrate"
      ) {
        control.failures -= 1;
        sendError(socket, response.id, {
          code: -32603,
          message: "response_bytes_limit",
          data: { retryable: false },
        });
        return;
      }
      socket.send(message);
    });
  });
  return { sockets, opens, hydrates, control };
}

test("a cold hydrate failure stays honest and Start retries without a phantom record", async ({
  page,
}) => {
  const probe = await controlledHydrates(page);
  probe.control.failures = 1;
  await connect(page);
  const path = page.getByLabel("Server workspace path");
  await path.fill("/workspace/diff-review");
  const startButton = page.getByRole("button", { name: "Start session" });
  await startButton.click();
  await expect(
    page.getByText("response_bytes_limit", { exact: true }),
  ).toBeVisible();
  await expect(startButton).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveCount(0);
  await expect(page.locator('[role="treeitem"][data-session-id]')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /^Session panel/ }),
  ).toHaveCount(0);

  await startButton.click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await expect(
    page.getByText("response_bytes_limit", { exact: true }),
  ).toHaveCount(0);
  expect(probe.opens).toHaveLength(2);
  // Open already succeeded before hydrate failed. Retry that server Session
  // instead of creating an abandoned Session for every recovery attempt.
  expect(probe.opens[0]).toBe(probe.opens[1]);
  await expect(page.locator('[role="treeitem"][data-session-id]')).toHaveCount(
    1,
  );
});
