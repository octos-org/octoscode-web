import { expect, test, type Page } from "@playwright/test";

// Run against a real Core containing #2882 and a slow streaming provider
// (the durability harness recognizes this prompt). No mocked OUP responses.
const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = process.env.OCTOSCODE_LIVE_TOKEN!;
const cwd = process.env.OCTOSCODE_LIVE_WORKSPACE!;
const composerPlaceholder = "Ask Octos to change, explain, or review code…";
const prompt = (marker: string) =>
  `Durability probe. Keep counting slowly from 1 to 300, then reply with the exact marker ${marker} and nothing else. Use no tools.`;

async function openSession(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(endpoint);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Add workspace" });
  const manual = page.getByRole("button", { name: "Enter path manually" });
  await expect(workspace.or(manual).first()).toBeVisible({ timeout: 30_000 });
  if (await manual.isVisible()) await manual.click();
  await workspace.getByLabel("Server workspace path").fill(cwd);
  await workspace.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByPlaceholder(composerPlaceholder)).toBeEnabled({
    timeout: 60_000,
  });
}

function observe(page: Page) {
  const starts: string[] = [];
  let scope: { session_id: string; profile_id: string; cwd: string };
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      if (frame.method === "turn/start") starts.push(frame.params.turn_id);
    });
    socket.on("framereceived", ({ payload }) => {
      const frame = JSON.parse(String(payload));
      const opened = frame.result?.opened;
      if (
        opened?.session_id &&
        opened?.active_profile_id &&
        opened?.workspace_root
      )
        scope = {
          session_id: opened.session_id,
          profile_id: opened.active_profile_id,
          cwd: opened.workspace_root,
        };
    });
  });
  return { starts, scope: () => scope };
}

const stop = (page: Page) =>
  page.getByRole("button", { name: "Stop", exact: true });
const strip = (page: Page) =>
  page.getByRole("button", { name: "Session settings" });

test("reload recognizes this tab's running turn without sending it again", async ({
  page,
}) => {
  const observed = observe(page);
  await openSession(page);
  const marker = `OWN_RELOAD_${Date.now()}`;
  await page.getByPlaceholder(composerPlaceholder).fill(prompt(marker));
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(stop(page)).toBeEnabled({ timeout: 30_000 });
  await page.reload();
  await expect(
    page.locator(".entry-user").filter({ hasText: marker }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(stop(page)).toBeEnabled({ timeout: 30_000 });
  await expect(strip(page)).not.toContainText("Another client");
  await expect(strip(page)).toHaveAttribute("data-state", "responding");
  await expect(strip(page)).toContainText(/Responding|Writing…|Thinking…/);
  await expect(page.getByPlaceholder(composerPlaceholder)).toBeEnabled();
  await page
    .getByPlaceholder(composerPlaceholder)
    .fill("Continue counting slowly.");
  await expect(
    page.getByRole("button", { name: "Steer prompt", exact: true }),
  ).toBeEnabled();
  await page.getByPlaceholder(composerPlaceholder).fill("");
  expect(observed.starts).toHaveLength(1);
  await stop(page).click();
  await expect(stop(page)).toHaveCount(0, { timeout: 30_000 });
  expect(observed.starts).toHaveLength(1);
});

test("a real second connection's turn is still identified as another client", async ({
  page,
}) => {
  const observed = observe(page);
  await openSession(page);
  const url = new URL(
    "/api/ui-protocol/ws",
    process.env.OCTOSCODE_LIVE_PROXY_TARGET,
  );
  url.protocol = "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url);
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const frame = JSON.parse(String(data));
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    if (frame.error) request.reject(new Error(frame.error.message));
    else request.resolve(frame.result);
  });
  const rpc = (method: string, params: unknown) =>
    new Promise((resolve, reject) => {
      const id = `other-${++sequence}`;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("Second client could not connect")),
        { once: true },
      );
    });
    await rpc("client_hello", {
      transport: "websocket",
      features: ["session.workspace_cwd.v1", "state.session_hydrate.v1"],
    });
    const scope = observed.scope();
    expect(scope?.session_id).toBeTruthy();
    await rpc("session/open", {
      session_id: scope.session_id,
      profile_id: scope.profile_id,
      cwd: scope.cwd,
    });
    await rpc("turn/start", {
      session_id: scope.session_id,
      turn_id: crypto.randomUUID(),
      input: [{ kind: "text", text: prompt(`OTHER_${Date.now()}`) }],
    });
    await expect(strip(page)).toContainText("Another client", {
      timeout: 30_000,
    });
    await page.reload();
    await expect(strip(page)).toContainText("Another client", {
      timeout: 30_000,
    });
    await expect(stop(page)).toBeEnabled();
    await stop(page).click();
    await expect(stop(page)).toHaveCount(0, { timeout: 30_000 });
    expect(observed.starts).toHaveLength(0);
  } finally {
    socket.close();
  }
});
