import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const fixture = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

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
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: response.id,
            error: {
              code: -32603,
              message: "response_bytes_limit",
              data: { retryable: false },
            },
          }),
        );
        return;
      }
      socket.send(message);
    });
  });
  return { sockets, opens, hydrates, control };
}

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(fixture);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const path = page.getByLabel("Server workspace path");
  await path.fill(workspace);
  await path.press("Enter");
}

test("a failed reconnect hydrate retains the current Session, Changes and draft", async ({
  page,
}) => {
  const probe = await controlledHydrates(page);
  await start(page, "/workspace/diff-review");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");
  const panel = page.getByRole("button", {
    name: "Session panel, 1 changed",
  });
  await expect(panel).toBeVisible();
  const timeline = page.getByRole("log", { name: "Conversation timeline" });
  const before = await timeline.innerText();
  const original = await page
    .locator('[role="treeitem"][data-session-id][aria-current="page"]')
    .getAttribute("data-session-id");
  expect(original).toBeTruthy();
  await composer.fill("Keep this draft through hydrate failure");

  probe.control.failures = 1;
  probe.sockets.at(-1)?.close({ code: 1012, reason: "hydrate failure probe" });
  await expect(page.getByText(/could not be recovered/).first()).toBeVisible({
    timeout: 15_000,
  });
  expect(await timeline.innerText()).toBe(before);
  await expect(panel).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Keep this draft through hydrate failure");
  await expect(
    page.getByText("Choose a workspace", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      `[role="treeitem"][data-session-id=${JSON.stringify(original)}][aria-current="page"]`,
    ),
  ).toBeVisible();

  // A later healthy reconnect is a real retry of the same retained record.
  probe.sockets.at(-1)?.close({ code: 1012, reason: "hydrate retry probe" });
  await expect(page.getByText(/could not be recovered/)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("Keep this draft through hydrate failure");
  await expect(panel).toBeVisible();
  await expect(timeline).toContainText("Review syntax fixture");
  await expect(timeline).toContainText(
    "Completed with pnpm check and all tests passing.",
  );
  expect(probe.opens.length).toBeGreaterThan(1);
  expect(new Set(probe.opens).size).toBe(1);

  // While Octos cannot be reached, the Session stays on screen, read-only, as
  // reconnecting; nothing can be sent until it is back, draft and all.
  probe.control.unreachable = true;
  probe.sockets.at(-1)?.close({ code: 1006 });
  await expect(page.getByText("Reconnecting to Octos")).toBeVisible();
  await expect(timeline).toContainText("Review syntax fixture");
  await expect(page.getByText("Choose a workspace")).toHaveCount(0);
  await expect(composer).toHaveCount(0);
  probe.control.unreachable = false;
  await expect(composer).toHaveValue(
    "Keep this draft through hydrate failure",
    {
      timeout: 15_000,
    },
  );
  await expect(page.getByText("Reconnecting to Octos")).toHaveCount(0);
});

test("a cold hydrate failure stays honest and Start retries without a phantom record", async ({
  page,
}) => {
  const probe = await controlledHydrates(page);
  probe.control.failures = 1;
  await page.goto("/");
  await page.getByLabel("Server origin").fill(fixture);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
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
