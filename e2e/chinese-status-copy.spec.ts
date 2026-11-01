import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = { animations: "disabled" as const, maxDiffPixelRatio: 0.01 };

async function startChinese(page: Page, workspace: string) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "octoscode.web.display.v1",
      JSON.stringify({
        version: 1,
        theme: "terminal",
        language: "zh",
        vimMode: false,
      }),
    );
  });
  await page.goto("/");
  await page.locator("#connection-origin").fill(ORIGIN);
  await page.locator("#connection-token").fill("tab-scoped-e2e-token");
  await page.locator('form[class*="card"] button[type="submit"]').click();
  const path = page.getByLabel(/Server workspace path|服务器工作区路径/);
  await path.fill(`${workspace}-${Date.now()}`);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: /Message Octos|消息/ }),
  ).toBeEnabled();
}

test("Chinese connector refusal keeps a useful summary and raw technical detail", async ({
  page,
}) => {
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "mcp/connector/create") {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            error: {
              code: -32602,
              message: "private or loopback MCP endpoints are refused",
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await startChinese(page, "/srv/work/chinese-connector-management-refusal");
  await page
    .locator("aside")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "连接器", exact: true }).click();
  await settings.getByRole("button", { name: "添加 HTTP 连接器" }).click();
  await settings.getByLabel("连接器名称").fill("私有服务");
  await settings.getByLabel("HTTP URL").fill("http://127.0.0.1:8080/mcp");
  const save = settings.getByRole("button", { name: "保存连接器" });
  await save.click();
  await expect(
    settings.getByText(
      "连接器使用了服务器拒绝的私有或回环地址，请改用获准的公网 HTTP(S) 地址。",
    ),
  ).toBeVisible();
  const raw = settings.getByText(
    "private or loopback MCP endpoints are refused",
    { exact: true },
  );
  await expect(raw).toBeHidden();
  await settings.getByText("技术详情", { exact: true }).click();
  await expect(raw).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(
    settings.getByRole("button", { name: "刷新", exact: true }),
  ).toBeEnabled();
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(settings).toHaveScreenshot(
    "connector-private-refusal-zh.png",
    SNAPSHOT,
  );
});

test("a completed controlled peer shows Chinese status and announcement", async ({
  page,
  request,
}) => {
  const sent: Array<{ method?: string; params?: { session_id?: string } }> = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      sent.push(JSON.parse(String(payload))),
    );
  });
  await request.post(`${ORIGIN}/__test__/peers/reset`);
  await startChinese(page, "/srv/work/peer-control-chinese-finished");
  await page.locator('aside [data-fleet-nav="entry"]').click();
  const fleet = page
    .locator("section[data-fleet-view], section[aria-label]")
    .filter({
      has: page.locator('[data-fleet-field="brief"]'),
    });
  await fleet
    .locator('[data-fleet-field="model"]')
    .selectOption("lane-primary");
  await fleet.locator('[data-fleet-field="brief"]').fill("完成状态中文验证");
  const start = fleet.locator('[data-fleet-action="start"]');
  await expect(start).toBeEnabled();
  await start.click();
  const row = fleet.locator("[data-fleet-row]").first();
  await expect(row).toHaveAttribute("data-fleet-status", "Working", {
    timeout: 30_000,
  });
  await expect(
    row.getByRole("heading", { name: /Peer 1 — .*工作/ }),
  ).toBeVisible();
  const slug = await row.getAttribute("data-fleet-row");
  const sessionId = sent.find(
    (frame) => frame.method === "session/open" && frame.params?.session_id,
  )?.params?.session_id;
  expect(sessionId).toBeTruthy();
  const completed = await request.post(
    `${ORIGIN}/__test__/peer-control/peer-activity?session_id=${encodeURIComponent(sessionId!)}&kind=complete&slug=${encodeURIComponent(slug!)}`,
  );
  expect(completed.status()).toBe(204);
  await fleet.getByRole("button", { name: "已完成（1）", exact: true }).click();
  const finishedRow = fleet.locator(`[data-fleet-row="${slug}"]`);
  await expect(finishedRow).toHaveAttribute("data-fleet-status", "Finished", {
    timeout: 20_000,
  });
  await expect(
    finishedRow.getByRole("heading", { name: "Peer 1 — 已完成", exact: true }),
  ).toBeVisible();
  await expect(finishedRow.getByText("Finished", { exact: true })).toHaveCount(
    0,
  );
  await expect(fleet.locator('[aria-live="polite"]')).toContainText(
    /Peer.*已完成/,
  );
  await fleet
    .locator('[data-fleet-field="brief"]')
    .fill("完成状态中文验证，再启动");
  await expect(start).toBeEnabled();
  await expect(fleet.locator('[data-fleet-action="stop"]')).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include("[data-fleet-row]").analyze())
      .violations,
  ).toEqual([]);
  await expect(finishedRow).toHaveScreenshot(
    "fleet-peer-finished-zh.png",
    SNAPSHOT,
  );
});

test("an interrupted turn keeps Chinese guidance and raw connection detail", async ({
  page,
}) => {
  let turnId = "";
  await page.routeWebSocket(/\/api\/ui-protocol\/ws/, (socket) => {
    const server = socket.connectToServer();
    const methods = new Map<string, string>();
    socket.onMessage((message) => {
      const request = JSON.parse(String(message));
      methods.set(request.id, request.method);
      if (request.method !== "turn/start") {
        server.send(message);
        return;
      }
      turnId = request.params.turn_id;
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { accepted: true },
        }),
      );
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "projection/envelope",
          params: {
            session_id: request.params.session_id,
            thread_id: "chinese-recovery-thread",
            turn_id: turnId,
            seq: 1,
            cursor: { stream: request.params.session_id, seq: 501 },
            payload: {
              type: "assistant_delta",
              data: { text: "保留这段恢复证据" },
            },
          },
        }),
      );
    });
    server.onMessage((message) => {
      const response = JSON.parse(String(message));
      if (turnId && response.method === "projection/envelope") return;
      if (methods.get(response.id) === "session/hydrate") {
        const sessionId = response.result.session_id;
        response.result.messages = [];
        response.result.replayed_envelopes = [];
        response.result.replayed_tool_envelopes = [];
        response.result.turns = [
          {
            turn_id: turnId,
            thread_id: "chinese-recovery-thread",
            state: "interrupted",
          },
        ];
        response.result.cursor = { stream: sessionId, seq: 503 };
        response.result.projection_thread_sequences = {
          "chinese-recovery-thread": 3,
        };
        response.result.replayed_projection_envelopes = [
          { type: "user_message", data: { text: "验证断线原因" } },
          { type: "assistant_delta", data: { text: "保留这段恢复证据" } },
          {
            type: "turn_terminal",
            data: {
              outcome: "interrupted",
              error: {
                code: "connection_closed",
                message: "The connection closed before the turn completed.",
              },
            },
          },
        ].map((payload, index) => ({
          thread_id: "chinese-recovery-thread",
          turn_id: turnId,
          seq: index + 1,
          cursor: { stream: sessionId, seq: 501 + index },
          payload,
        }));
      }
      socket.send(JSON.stringify(response));
    });
  });
  await startChinese(page, "/workspace/chinese-recovery");
  const composer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await composer.fill("验证断线原因");
  await composer.press("Enter");
  await expect(
    page.getByText("保留这段恢复证据", { exact: true }),
  ).toBeVisible();
  await page.reload();
  const timeline = page.getByRole("log");
  await expect(timeline.getByText("本轮已停止", { exact: true })).toBeVisible();
  await expect(
    timeline.getByText("本轮在完成前已停止。", { exact: true }),
  ).toBeVisible();
  const raw = timeline.getByText(
    "The connection closed before the turn completed.",
    {
      exact: true,
    },
  );
  await expect(raw).toBeHidden();
  await timeline.getByText("技术详情", { exact: true }).click();
  await expect(raw).toBeVisible();
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await expect(composer).toBeEnabled();
  const terminal = timeline.getByRole("region", { name: "本轮汇总" });
  expect(
    (
      await new AxeBuilder({ page })
        .include('section[aria-label="本轮汇总"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(terminal).toHaveScreenshot(
    "disconnect-terminal-zh.png",
    SNAPSHOT,
  );
});
