import { expect, test } from "@playwright/test";

const fixtureOrigin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

for (const canonicalReplay of [false, true]) {
  test(`refresh shows the interrupted turn with ${canonicalReplay ? "complete canonical replay" : "legacy terminal state"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const starts: string[] = [];
    let turnId = "";
    let recoveryModuleRequests = 0;
    await page.route(
      // The cold recovery chunk. A dev server serves the module path; this
      // repo's e2e runs `vite preview`, which serves it as the built
      // /assets/canonical-hydrate-<hash>.js. Vite hashes may contain `-`;
      // exclude the sibling canonical-hydrate-loader module explicitly.
      /\/canonical-hydrate(\.ts|-(?!loader[-.])[A-Za-z0-9_-]+\.js)(\?|$)/,
      async (route) => {
        recoveryModuleRequests += 1;
        if (canonicalReplay) await route.continue();
        else await route.abort();
      },
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
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
        starts.push(turnId);
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
              thread_id: "recovery-thread",
              turn_id: turnId,
              seq: 1,
              cursor: { stream: request.params.session_id, seq: 501 },
              payload: {
                type: "assistant_delta",
                data: { text: "The first finding is preserved." },
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
          response.result.turns = turnId
            ? [
                {
                  turn_id: turnId,
                  thread_id: "recovery-thread",
                  state: "interrupted",
                },
              ]
            : [];
          if (turnId && canonicalReplay) {
            response.result.cursor = { stream: sessionId, seq: 503 };
            response.result.projection_thread_sequences = {
              "recovery-thread": 3,
            };
            response.result.replayed_projection_envelopes = [
              {
                type: "user_message",
                data: { text: "Investigate this interrupted turn" },
              },
              {
                type: "assistant_delta",
                data: { text: "The first finding is preserved." },
              },
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
              thread_id: "recovery-thread",
              turn_id: turnId,
              seq: index + 1,
              cursor: { stream: sessionId, seq: 501 + index },
              payload,
            }));
          }
        }
        socket.send(JSON.stringify(response));
      });
    });
    await page.goto("/");
    await page.getByLabel("Server origin").fill(fixtureOrigin);
    await page
      .getByLabel("Auth token", { exact: true })
      .fill("tab-scoped-e2e-token");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page
      .getByLabel("Server workspace path")
      .fill("/workspace/canonical-recovery");
    await page.getByRole("button", { name: "Start session" }).click();
    const composer = page.getByRole("textbox", { name: "Message Octos" });
    await composer.fill("Investigate this interrupted turn");
    await composer.press("Enter");
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The first finding is preserved.", { exact: true }),
    ).toBeVisible();
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    const timeline = page.getByRole("log", { name: "Conversation timeline" });
    await expect(
      timeline.getByText("Turn stopped", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await expect(composer).toBeEnabled();
    if (canonicalReplay) {
      await expect(
        timeline.getByText("Investigate this interrupted turn", {
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        timeline.getByText("The first finding is preserved.", { exact: true }),
      ).toHaveCount(1);
      await expect(timeline).toContainText(
        "The connection closed before the turn completed.",
      );
    } else {
      await expect(timeline).toContainText(
        "This turn was stopped before it completed.",
      );
      await expect(
        timeline.getByText("Investigate this interrupted turn", {
          exact: true,
        }),
      ).toHaveCount(0);
    }
    const before = await timeline.innerText();
    await page.reload();
    await expect(timeline).toHaveText(before, { useInnerText: true });
    expect(starts).toHaveLength(1);
    expect(recoveryModuleRequests > 0).toBe(canonicalReplay);
    expect(errors).toEqual([]);
  });
}
