import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.OCTOSCODE_MOCK_PORT ?? "50080", 10);
const http = createServer((request, response) => {
  if (request.url === "/health") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
    return;
  }
  response.writeHead(404).end("Octoscode AppUI fixture only");
});
const sockets = new WebSocketServer({
  server: http,
  path: "/api/ui-protocol/ws",
});
let mockSessions = [
  {
    id: "coding:local:main",
    message_count: 12,
    title: "Ship octoscode-web",
    updated_at: "2026-08-26T00:00:00Z",
    last_prompt: "Add the coding product surfaces",
  },
  {
    id: "coding:local:review",
    message_count: 4,
    title: "Review protocol drift",
    updated_at: "2026-08-25T18:00:00Z",
    last_prompt: "Compare the Core fixture",
  },
];

const capabilities = {
  version: {
    protocol: "octos-ui/v1alpha1",
    schema_version: 1,
    jsonrpc: "2.0",
  },
  capabilities_schema_version: 2,
  supported_methods: [
    "config/capabilities/list",
    "launch/resolve",
    "profile/local/create",
    "profile/llm/catalog",
    "profile/llm/test",
    "profile/llm/upsert",
    "session/open",
    "session/hydrate",
    "turn/start",
    "turn/interrupt",
    "approval/respond",
    "user_question/respond",
    "permission/profile/list",
    "permission/profile/set",
    "diff/preview/get",
    "task/list",
    "task/cancel",
    "task/output/read",
    "task/artifact/list",
    "task/artifact/read",
    "session/status/read",
    "session/list",
    "session/delete",
    "session/files.list",
  ],
  supported_notifications: [
    "projection/envelope",
    "protocol/replay_lossy",
    "progress/updated",
    "plan/updated",
  ],
  supported_features: [
    "state.session_hydrate.v1",
    "projection.envelope.v2",
    "approval.typed.v1",
    "user_question.v1",
    "harness.task_control.v1",
    "harness.task_artifacts.v1",
    "plan.todos.v1",
    "session.workspace_cwd.v1",
  ],
};

sockets.on("connection", (socket) => {
  let permission = { mode: "workspace_write", network: "deny" };
  let taskState = "running";
  let pendingInteraction = null;
  let projectionCursor = 10;
  let createdProfileId = null;
  socket.on("message", (bytes) => {
    const request = JSON.parse(bytes.toString());
    const sessionId = request.params?.session_id ?? "coding:local:main";
    if (request.method === "config/capabilities/list") {
      reply(socket, request.id, { capabilities });
      return;
    }
    if (request.method === "launch/resolve") {
      const cwd = request.params?.cwd ?? "";
      const profile = request.params?.profile_id || "_main";
      const result = cwd.endsWith("/no-profile")
        ? createdProfileId
          ? { decision: "activate", resolved_profile: createdProfileId }
          : { decision: "no_profile" }
        : cwd.endsWith("/cross")
          ? {
              decision: "cross_profile",
              resolved_profile: profile,
              existing_profiles: ["review"],
            }
          : cwd.endsWith("/new")
            ? { decision: "activate", resolved_profile: profile }
            : { decision: "resume", resolved_profile: profile };
      reply(socket, request.id, result);
      return;
    }
    if (request.method === "profile/llm/catalog") {
      reply(socket, request.id, {
        families: {
          deepseek: {
            env: "DEEPSEEK_API_KEY",
            models: [
              {
                id: "deepseek-chat",
                endpoints: [
                  {
                    id: "openrouter",
                    label: "OpenRouter",
                    base_url: "https://openrouter.ai/api/v1",
                    api_key_env: "OPENROUTER_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
            ],
          },
        },
      });
      return;
    }
    if (request.method === "profile/local/create") {
      createdProfileId = request.params.requested_id;
      reply(socket, request.id, {
        profile_id: createdProfileId,
        user_id: `user-${createdProfileId}`,
        name: request.params.name,
        username: request.params.username,
        email: request.params.email,
        created: true,
        runtime_mode: "solo",
      });
      return;
    }
    if (request.method === "profile/llm/test") {
      const rejected = request.params.api_key === "sk-rejected-secret";
      reply(socket, request.id, {
        profile_id: request.params.profile_id,
        applied: !rejected,
        message: rejected
          ? `Provider rejected ${request.params.api_key}`
          : "Provider test succeeded",
        ...(rejected
          ? { error: `Provider rejected ${request.params.api_key}` }
          : {}),
      });
      return;
    }
    if (request.method === "profile/llm/upsert") {
      reply(socket, request.id, {
        profile_id: request.params.profile_id,
        applied: true,
      });
      return;
    }
    if (request.method === "session/open") {
      if (!mockSessions.some((session) => session.id === sessionId)) {
        mockSessions = [
          {
            id: sessionId,
            message_count: 0,
            title: "New coding session",
            updated_at: new Date().toISOString(),
          },
          ...mockSessions,
        ];
      }
      reply(socket, request.id, {
        opened: {
          session_id: sessionId,
          active_profile_id: request.params?.profile_id || "coding",
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
      pendingInteraction = streamTurn(
        socket,
        sessionId,
        request.params,
        () => ++projectionCursor,
      );
      return;
    }
    if (request.method === "approval/respond") {
      reply(socket, request.id, {
        approval_id: request.params.approval_id,
        accepted: true,
        status: request.params.decision === "approve" ? "approved" : "denied",
        runtime_resumed: true,
      });
      if (pendingInteraction?.kind === "approval") {
        finishInteraction(socket, pendingInteraction);
        pendingInteraction = null;
      }
      return;
    }
    if (request.method === "user_question/respond") {
      reply(socket, request.id, {
        question_id: request.params.question_id,
        accepted: true,
        runtime_resumed: true,
      });
      if (pendingInteraction?.kind === "question") {
        finishInteraction(socket, pendingInteraction);
        pendingInteraction = null;
      }
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
    if (request.method === "session/status/read") {
      reply(socket, request.id, {
        session_id: sessionId,
        runtime_mode: "solo",
        profile_id: "coding",
        workspace_root: "/workspace/octoscode-web",
        model: { model: "deepseek-v4", provider: "deepseek", selected: true },
        sandbox: permission.mode,
        network: permission.network === "allow" ? "allowed" : "blocked",
        approval_policy: "on-request",
        mcp_servers: [],
        runtime_policy_stamp: {
          model: "deepseek-v4",
          profile_id: "coding",
          sandbox: permission.mode,
          network: permission.network === "allow" ? "allowed" : "blocked",
          approval_policy: "on-request",
        },
        usage: {
          input_tokens: 128000,
          output_tokens: 340,
          cached_input_tokens: 64000,
          estimated_cost_micros_usd: 120000,
        },
        health: { status: "ok" },
        cursor: {
          cursor: { stream: sessionId, seq: 10 },
          healthy: true,
          replay_supported: true,
        },
      });
      return;
    }
    if (request.method === "session/list") {
      reply(socket, request.id, { sessions: mockSessions });
      return;
    }
    if (request.method === "session/delete") {
      mockSessions = mockSessions.filter(
        (session) => session.id !== request.params.session_id,
      );
      reply(socket, request.id, {});
      return;
    }
    if (request.method === "session/files.list") {
      reply(socket, request.id, {
        files: [
          {
            filename: "check.txt",
            path: "pf/coding/reports/check.txt",
            size_bytes: 12400,
            modified_at: "2026-08-26T00:00:00Z",
          },
          {
            filename: "diff.patch",
            path: "pf/coding/reports/diff.patch",
            size_bytes: 8100,
            modified_at: "2026-08-25T23:58:00Z",
          },
        ],
      });
      return;
    }
    if (request.method === "task/list") {
      reply(socket, request.id, {
        session_id: request.params.session_id,
        tasks: [mockTask(taskState)],
      });
      return;
    }
    if (request.method === "task/cancel") {
      taskState = "cancelled";
      reply(socket, request.id, {
        task_id: request.params.task_id,
        status: taskState,
      });
      return;
    }
    if (request.method === "task/output/read") {
      const fullText = [
        "Inspecting changed files…\n",
        "Running pnpm check\n",
        "68 tests passed\n",
      ].join("");
      const offset = request.params.cursor?.offset ?? 0;
      const text = Buffer.from(fullText).subarray(offset).toString("utf8");
      const bytesRead = Buffer.byteLength(text);
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        source: "runtime_projection",
        cursor: request.params.cursor ?? { offset: 0 },
        next_cursor: { offset: offset + bytesRead },
        text,
        bytes_read: bytesRead,
        total_bytes: Buffer.byteLength(fullText),
        truncated: false,
        complete: true,
        live_tail_supported: true,
        is_snapshot_projection: false,
        task_status: taskState,
        runtime_state: taskState,
        lifecycle_state: taskState,
        output_files: ["reports/check.txt"],
        limitations: [],
      });
      return;
    }
    if (request.method === "task/artifact/list") {
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        artifacts: [
          {
            id: "check-report",
            title: "Check report",
            kind: "text",
            status: "ready",
            path: "reports/check.txt",
          },
        ],
      });
      return;
    }
    if (request.method === "task/artifact/read") {
      const pages = ["pnpm check\n68 tests passed\n", "build completed"];
      const page = request.params.cursor?.offset ? 1 : 0;
      const cursor = pages
        .slice(0, page)
        .reduce((offset, content) => offset + Buffer.byteLength(content), 0);
      const nextCursor = cursor + Buffer.byteLength(pages[page]);
      reply(socket, request.id, {
        session_id: sessionId,
        task_id: request.params.task_id,
        artifact: {
          id: request.params.artifact_id,
          title: "Check report",
          kind: "text",
          status: "ready",
          path: "reports/check.txt",
        },
        content: pages[page],
        cursor: { offset: cursor },
        next_cursor: { offset: nextCursor },
        has_more: page < pages.length - 1,
      });
      return;
    }
    reply(socket, request.id, { accepted: true });
  });
});

function streamTurn(socket, sessionId, params, nextCursor) {
  const turnId = params.turn_id;
  const threadId = `thread-${turnId}`;
  const text = params.input?.[0]?.text ?? "Fixture prompt";
  notify(socket, sessionId, threadId, turnId, 1, nextCursor(), "user_message", {
    text,
    files: [],
  });
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "plan/updated",
      params: {
        session_id: sessionId,
        turn_id: turnId,
        plan: {
          title: "Shipping the coding surface",
          updated_at_ms: Date.now(),
          items: [
            {
              id: "inspect",
              title: "Inspect the workspace",
              status: "completed",
            },
            {
              id: "change",
              title: "Implement the change",
              status: "in_progress",
            },
            { id: "verify", title: "Run product checks", status: "pending" },
          ],
        },
      },
    }),
  );
  if (text === "Request approval fixture") {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "approval/requested",
        params: {
          session_id: sessionId,
          approval_id: `approval-${turnId}`,
          turn_id: turnId,
          tool_name: "shell",
          title: "Run product checks?",
          body: "The agent wants to run the repository checks.",
          approval_kind: "command",
          risk: "medium",
          typed_details: {
            command: { command_line: "pnpm check" },
          },
        },
      }),
    );
    return { kind: "approval", sessionId, threadId, turnId, nextCursor };
  }
  if (text === "Request question fixture") {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "user_question/requested",
        params: {
          session_id: sessionId,
          question_id: `question-${turnId}`,
          turn_id: turnId,
          title: "Choose verification depth",
          body: "Octos needs one product decision.",
          questions: [
            {
              header: "Checks",
              question: "Which checks should run?",
              options: [
                { label: "Fast", description: "Unit tests only" },
                { label: "Full", description: "All product gates" },
              ],
              multi_select: false,
              allow_free_text: false,
            },
          ],
        },
      }),
    );
    return { kind: "question", sessionId, threadId, turnId, nextCursor };
  }
  notify(
    socket,
    sessionId,
    threadId,
    turnId,
    2,
    nextCursor(),
    "assistant_delta",
    {
      text: "Working on **Markdown**…",
      assistant_segment_id: "segment-1",
    },
  );
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "progress/updated",
      params: {
        session_id: sessionId,
        turn_id: turnId,
        timestamp: new Date().toISOString(),
        metadata: {
          kind: "token_cost_update",
          token_cost: {
            input_tokens: 128000,
            output_tokens: 340,
            session_cost: 0.12,
            currency: "USD",
            model: "deepseek-v4",
            context_window: 1000000,
          },
        },
      },
    }),
  );
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
    notify(
      socket,
      sessionId,
      threadId,
      turnId,
      3,
      nextCursor(),
      "assistant_persisted",
      {
        text: "Completed with `pnpm check` and **all tests passing**.",
        assistant_segment_id: "segment-1",
        meta: {
          message_id: `message-${turnId}`,
          persisted_at: new Date().toISOString(),
        },
      },
    );
    notify(
      socket,
      sessionId,
      threadId,
      turnId,
      4,
      nextCursor(),
      "turn_terminal",
      {
        outcome: "completed",
        token_usage: { input_tokens: 12, output_tokens: 9 },
      },
    );
  }, 350);
  return null;
}

function finishInteraction(socket, interaction) {
  notify(
    socket,
    interaction.sessionId,
    interaction.threadId,
    interaction.turnId,
    2,
    interaction.nextCursor(),
    "turn_terminal",
    {
      outcome: "completed",
      token_usage: { input_tokens: 4, output_tokens: 2 },
    },
  );
}

function mockTask(state) {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    tool_name: "spawn_agent",
    tool_call_id: "tool-fixture",
    state,
    status: state === "running" ? "checking workspace" : state,
    lifecycle_state: state,
    runtime_state: state,
    source: "model",
    role: "test_worker",
    summary: "Validate product checks",
    artifact_count: 1,
    started_at: "2026-08-26T00:00:00Z",
    updated_at: new Date().toISOString(),
    output_files: ["reports/check.txt"],
  };
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
