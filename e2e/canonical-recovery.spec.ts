import { expect, test } from "@playwright/test";
import { startSession } from "./fixture-session";
import { sendEnvelope, sendResult } from "./wire";
import { stopButton } from "./sessions";

test("refresh shows the interrupted turn with complete canonical replay", async ({
  page,
}) => {
  const errors: string[] = [];
  const starts: string[] = [];
  let turnId = "";
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
      sendResult(socket, request.id, { accepted: true });
      sendEnvelope(
        socket,
        request.params,
        { thread: "recovery-thread", seq: 1, cursor: 501 },
        "assistant_delta",
        { text: "The first finding is preserved." },
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
        if (turnId) {
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
  await startSession(page, "/workspace/canonical-recovery");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Investigate this interrupted turn");
  await composer.press("Enter");
  await expect(stopButton(page)).toBeVisible();
  await expect(
    page.getByText("The first finding is preserved.", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const timeline = page.getByRole("log", { name: "Conversation timeline" });
  await expect(
    timeline.getByText("Turn stopped", { exact: true }),
  ).toBeVisible();
  await expect(stopButton(page)).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await expect(
    timeline.getByText("Investigate this interrupted turn", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    timeline.getByText("The first finding is preserved.", { exact: true }),
  ).toHaveCount(1);
  await timeline.getByText("Technical details", { exact: true }).click();
  await expect(timeline).toContainText(
    "The connection closed before the turn completed.",
  );
  const before = await timeline.innerText();
  await page.reload();
  await timeline.getByText("Technical details", { exact: true }).click();
  await expect(timeline).toHaveText(before, { useInnerText: true });
  expect(starts).toHaveLength(1);
  expect(errors).toEqual([]);
});
