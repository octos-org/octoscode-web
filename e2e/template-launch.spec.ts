import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
}

test("a template selection survives reload without creating or sending work", async ({
  page,
}) => {
  const methods: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      methods.push(JSON.parse(String(payload)).method);
    }),
  );
  await connect(page);
  await page
    .getByRole("button", { name: "Use this: Write a weekly report" })
    .dblclick();
  expect(methods).not.toContain("session/open");
  expect(methods).not.toContain("turn/start");
  await page.reload();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "“Write a weekly report” is ready" }),
  ).toBeVisible();
  expect(methods).not.toContain("session/open");
  expect(methods).not.toContain("turn/start");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Or start from a template" })
      .getByRole("status"),
  ).toBeEmpty();
});

test("a rejected template launch retries its session identity and preserves the draft on reload", async ({
  page,
}) => {
  const opened: string[] = [];
  const turns: string[] = [];
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "turn/start") turns.push(frame.params.turn_id);
      if (frame.method === "session/open") {
        opened.push(frame.params.session_id);
        if (opened.length === 1) {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: {
                code: -32603,
                message: "Template launch refused for this test",
              },
            }),
          );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await connect(page);
  await page
    .getByRole("button", { name: "Use this: Write a weekly report" })
    .click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/template-retry");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Template launch refused" }),
  ).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  expect(turns).toHaveLength(0);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .dblclick();
  await expect(composer(page)).toHaveValue(/^Using \[the data or notes/);
  expect(new Set(opened).size).toBe(1);
  await composer(page).fill(
    "Write a weekly report from these supplied facts: completed the release; next week review feedback.",
  );
  await page.reload();
  await expect(composer(page)).toHaveValue(
    /^Write a weekly report from these supplied facts/,
  );
  expect(new Set(opened).size).toBe(1);
  expect(turns).toHaveLength(0);
  await page
    .getByRole("button", { name: "Send prompt", exact: true })
    .dblclick();
  await expect(page.locator(".entry-user")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Turn summary", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".entry-user")).toHaveCount(1);
  expect(turns).toHaveLength(1);
  expect(new Set(opened).size).toBe(1);
});
