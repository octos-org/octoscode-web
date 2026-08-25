import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.OCTOSCODE_MOCK_PORT ?? "50080", 10);
const http = createServer((_request, response) => {
  response.writeHead(404).end("Octoscode AppUI fixture only");
});
const sockets = new WebSocketServer({
  server: http,
  path: "/api/ui-protocol/ws",
});

const capabilities = {
  version: { protocol: "octos.ui.v1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: [
    "session/open",
    "session/hydrate",
    "turn/start",
    "turn/interrupt",
    "approval/respond",
    "user_question/respond",
    "permission/profile/list",
    "permission/profile/set",
    "diff/preview/get",
  ],
  supported_notifications: ["projection/envelope", "protocol/replay_lossy"],
  supported_features: [
    "state.session_hydrate.v1",
    "projection.envelope.v2",
    "approval.typed.v1",
    "user_question.v1",
  ],
};

sockets.on("connection", (socket) => {
  let permission = { mode: "workspace_write", network: "deny" };
  socket.on("message", (bytes) => {
    const request = JSON.parse(bytes.toString());
    const sessionId = request.params?.session_id ?? "coding:local:main";
    if (request.method === "session/open") {
      reply(socket, request.id, {
        opened: {
          session_id: sessionId,
          active_profile_id: "coding",
          workspace_root: "/workspace/octoscode-web",
          cursor: { stream: sessionId, seq: 10 },
          capabilities,
        },
      });
      return;
    }
    if (request.method === "session/hydrate") {
      reply(socket, request.id, {
        session_id: sessionId,
        cursor: { stream: sessionId, seq: 10 },
        messages: [
          {
            seq: 1,
            role: "user",
            content: "Show the Markdown transcript surface",
            turn_id: "fixture-turn",
            persisted_at: "2026-08-26T00:00:00Z",
            media: [],
          },
          {
            seq: 2,
            role: "assistant",
            content: [
              "## Durable coding transcript",
              "",
              "The renderer supports **GFM**, safe [external links](https://github.com/octos-org/octoscode-web), and `inline code`.",
              "",
              "- [x] Hydrate the session",
              "- [x] Preserve code formatting",
              "- [ ] Review the diff",
              "",
              "| Surface | State |",
              "| --- | --- |",
              "| Cursor replay | Ready |",
              "| Syntax highlighting | Ready |",
              "",
              "```ts",
              "export function answer(value: number): number {",
              "  return value * 2;",
              "}",
              "```",
              "",
              "> Raw HTML stays inert: <script>never runs</script>",
            ].join("\n"),
            turn_id: "fixture-turn",
            thread_id: "fixture-thread",
            message_id: "fixture-message",
            persisted_at: "2026-08-26T00:00:01Z",
            media: [],
          },
        ],
        turns: [
          {
            turn_id: "fixture-turn",
            state: "completed",
            thread_id: "fixture-thread",
          },
        ],
        pending_approvals: [],
        pending_questions: [],
      });
      return;
    }
    if (request.method === "turn/start") {
      reply(socket, request.id, { accepted: true });
      streamTurn(socket, sessionId, request.params);
      return;
    }
    if (request.method === "turn/interrupt") {
      reply(socket, request.id, { accepted: true });
      return;
    }
    if (request.method === "permission/profile/list") {
      reply(socket, request.id, {
        session_id: sessionId,
        current: permission,
        profiles: [
          { mode: "read_only", network: "deny" },
          { mode: "workspace_write", network: "deny" },
          { mode: "workspace_write", network: "allow" },
          { mode: "danger_full_access", network: "allow" },
        ],
      });
      return;
    }
    if (request.method === "permission/profile/set") {
      permission = { ...permission, ...request.params?.update };
      reply(socket, request.id, {
        session_id: sessionId,
        current: permission,
        applied: true,
      });
      return;
    }
    if (request.method === "diff/preview/get") {
      reply(
        socket,
        request.id,
        diffPreview(sessionId, request.params.preview_id),
      );
      return;
    }
    reply(socket, request.id, { accepted: true });
  });
});

function streamTurn(socket, sessionId, params) {
  const turnId = params.turn_id;
  const threadId = `thread-${turnId}`;
  const text = params.input?.[0]?.text ?? "Fixture prompt";
  notify(socket, sessionId, threadId, turnId, 1, 11, "user_message", {
    text,
    files: [],
  });
  notify(socket, sessionId, threadId, turnId, 2, 12, "assistant_delta", {
    text: "Working on **Markdown**…",
    assistant_segment_id: "segment-1",
  });
  setTimeout(() => {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "progress/updated",
        params: {
          session_id: sessionId,
          turn_id: turnId,
          timestamp: new Date().toISOString(),
          metadata: {
            kind: "file_mutation",
            file_mutation: {
              path: "apps/web/src/app/App.tsx",
              operation: "write",
              preview_id: "00000000-0000-4000-8000-000000000042",
            },
          },
        },
      }),
    );
    notify(socket, sessionId, threadId, turnId, 3, 13, "assistant_persisted", {
      text: "Completed with `pnpm check` and **all tests passing**.",
      assistant_segment_id: "segment-1",
      meta: {
        message_id: `message-${turnId}`,
        persisted_at: new Date().toISOString(),
      },
    });
    notify(socket, sessionId, threadId, turnId, 4, 14, "turn_terminal", {
      outcome: "completed",
      token_usage: { input_tokens: 12, output_tokens: 9 },
    });
  }, 350);
}

function diffPreview(sessionId, previewId) {
  return {
    status: "ready",
    source: "pending_store",
    preview: {
      session_id: sessionId,
      preview_id: previewId,
      title: "Mock coding change",
      files: [
        {
          path: "apps/web/src/app/App.tsx",
          status: "modified",
          hunks: [
            {
              header: "@@ -41,3 +41,4 @@ export function App()",
              lines: [
                {
                  kind: "context",
                  content: "  const session = useOctosSession();",
                  old_line: 41,
                  new_line: 41,
                },
                {
                  kind: "removed",
                  content: "  const ready = false;",
                  old_line: 42,
                },
                {
                  kind: "added",
                  content: "  const ready = session.connected;",
                  new_line: 42,
                },
                {
                  kind: "added",
                  content: "  const review = session.diffReview;",
                  new_line: 43,
                },
              ],
            },
          ],
        },
        {
          path: "packages/client/src/coding.ts",
          status: "added",
          hunks: [],
        },
      ],
    },
  };
}

function reply(socket, id, result) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(socket, sessionId, threadId, turnId, seq, cursor, type, data) {
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "projection/envelope",
      params: {
        session_id: sessionId,
        thread_id: threadId,
        seq,
        cursor: { stream: sessionId, seq: cursor },
        turn_id: turnId,
        payload: { type, data },
      },
    }),
  );
}

http.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Octoscode AppUI fixture listening on 127.0.0.1:${port}\n`,
  );
});

const shutdown = () => {
  sockets.close();
  http.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
