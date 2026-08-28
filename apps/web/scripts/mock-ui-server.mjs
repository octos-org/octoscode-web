import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.OCTOSCODE_MOCK_PORT ?? "50080", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("OCTOSCODE_MOCK_PORT must be a valid TCP port");
}
let sockets;
const openedSessionBySocket = new WeakMap();
const openedWorkspaceBySocket = new WeakMap();
const openedProfileBySocket = new WeakMap();
const authenticatedProfileBySocket = new WeakMap();
const rejectedSessionIds = new Set();
const delayedHydrateSockets = new WeakSet();
const mockAuthMode = process.env.OCTOSCODE_MOCK_AUTH_MODE ?? "optional";
if (!new Set(["optional", "required"]).has(mockAuthMode)) {
  throw new Error("OCTOSCODE_MOCK_AUTH_MODE must be optional or required");
}
const mockAuthTokens = new Set(
  (process.env.OCTOSCODE_MOCK_AUTH_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean),
);
const mockProfileAuthToken = (
  process.env.OCTOSCODE_MOCK_PROFILE_AUTH_TOKEN ?? ""
).trim();
const mockProfileAuthId = (
  process.env.OCTOSCODE_MOCK_PROFILE_AUTH_ID ?? ""
).trim();
if (Boolean(mockProfileAuthToken) !== Boolean(mockProfileAuthId)) {
  throw new Error(
    "OCTOSCODE_MOCK_PROFILE_AUTH_TOKEN and OCTOSCODE_MOCK_PROFILE_AUTH_ID must be configured together",
  );
}
if (mockProfileAuthToken) mockAuthTokens.add(mockProfileAuthToken);
if (mockAuthMode === "required" && mockAuthTokens.size === 0) {
  throw new Error(
    "OCTOSCODE_MOCK_AUTH_TOKENS must contain a fixture token when auth is required",
  );
}
const defaultProfileId = "coding";
const sessionChannels = new Set([
  "api",
  "cli",
  "dingtalk",
  "discord",
  "email",
  "feishu",
  "line",
  "local",
  "matrix",
  "qq-bot",
  "slack",
  "system",
  "telegram",
  "test",
  "twilio",
  "wechat",
  "wecom",
  "wecom-bot",
  "whatsapp",
]);
const initialProfileModels = [
  {
    family_id: "zai",
    model_id: "glm-5.3-flash",
    route: {
      route_id: "official",
      label: "Z.AI Coding Plan",
      base_url: "https://api.z.ai/api/coding/paas/v4",
      api_key_env: "ZAI_API_KEY",
      api_type: "openai",
    },
    has_api_key: true,
    selected: true,
    available: true,
  },
  {
    family_id: "deepseek",
    model_id: "deepseek-v4-pro",
    route: {
      route_id: "official",
      label: "DeepSeek",
      base_url: "https://api.deepseek.com/v1",
      api_key_env: "DEEPSEEK_API_KEY",
      api_type: "openai",
    },
    has_api_key: false,
    selected: false,
    available: true,
  },
];
const defaultRuntimeModel = {
  model: "deepseek-v4",
  provider: "deepseek",
  title: "DeepSeek V4",
};
const configuredModelsByProfile = new Map([
  [defaultProfileId, cloneConfiguredModels(initialProfileModels)],
]);
const effectiveRuntimeModelByProfile = new Map([
  [defaultProfileId, defaultRuntimeModel],
]);

function cloneConfiguredModels(models) {
  return models.map((model) => ({
    ...model,
    route: { ...model.route },
  }));
}

function configuredModelsForProfile(profileId) {
  let configured = configuredModelsByProfile.get(profileId);
  if (!configured) {
    configured = cloneConfiguredModels(initialProfileModels);
    configuredModelsByProfile.set(profileId, configured);
  }
  return configured;
}

function sessionModel(model) {
  return {
    model: model.model_id,
    provider: model.family_id,
    title: modelTitle(model.model_id),
    family: model.family_id,
    route: model.route.route_id,
    selected: model.selected,
    available: model.available,
  };
}

function profileModelConfiguration(profileId) {
  const configured = configuredModelsForProfile(profileId);
  const selected = configured.find((model) => model.selected) ?? null;
  return {
    profile_id: profileId,
    primary: selected ? configuredModelProjection(selected, true) : null,
    fallbacks: configured
      .filter((model) => model !== selected)
      .map((model) => configuredModelProjection(model, false)),
  };
}

function configuredModelProjection(model, selected) {
  return {
    family_id: model.family_id,
    model_id: model.model_id,
    route: { ...model.route },
    has_api_key: model.has_api_key,
    selected,
    available: model.available,
  };
}

function modelTitle(modelId) {
  if (modelId === "glm-5.3-flash") return "GLM 5.3 Flash";
  if (modelId === "deepseek-v4-pro") return "DeepSeek V4 Pro";
  return modelId;
}

const http = createServer((request, response) => {
  if (request.url === "/health") {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/disconnect") {
    for (const client of sockets.clients) {
      client.close(1012, "fixture restart");
    }
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/replay-lossy") {
    for (const client of sockets.clients) {
      const sessionId =
        openedSessionBySocket.get(client) ?? "coding:local:main";
      delayedHydrateSockets.add(client);
      notifyRpc(client, "protocol/replay_lossy", {
        session_id: sessionId,
        dropped_count: 1,
        last_durable_cursor: {
          stream: sessionId,
          seq: 10,
        },
      });
    }
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && request.url === "/__test__/reject-opened") {
    for (const client of sockets.clients) {
      const sessionId = openedSessionBySocket.get(client);
      if (sessionId) rejectedSessionIds.add(sessionId);
    }
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end("Octoscode AppUI fixture only");
});
sockets = new WebSocketServer({
  server: http,
  path: "/api/ui-protocol/ws",
  verifyClient: ({ req }) =>
    mockAuthMode === "optional" ||
    mockAuthTokens.has(authTokenFromUpgradeRequest(req)),
});
const defaultWorkspace = "/workspace/octoscode-web";
const defaultSessions = [
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
const sessionsByWorkspace = new Map([[defaultWorkspace, defaultSessions]]);

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
    "profile/llm/delete",
    "profile/llm/fetch_models",
    "profile/llm/list",
    "profile/llm/select",
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

sockets.on("connection", (socket, request) => {
  const connectionProfileId = authenticatedProfileForToken(
    authTokenFromUpgradeRequest(request),
  );
  if (connectionProfileId) {
    authenticatedProfileBySocket.set(socket, connectionProfileId);
  }
  let permission = { mode: "workspace_write", network: "deny" };
  let taskState = "running";
  let pendingInteraction = null;
  let projectionCursor = 10;
  let createdProfileId = null;
  socket.on("message", (bytes) => {
    let request;
    try {
      request = JSON.parse(bytes.toString());
    } catch {
      socket.close(1003, "invalid JSON-RPC frame");
      return;
    }
    if (
      !request ||
      typeof request !== "object" ||
      request.jsonrpc !== "2.0" ||
      typeof request.id !== "string" ||
      typeof request.method !== "string"
    ) {
      socket.close(1003, "invalid JSON-RPC request");
      return;
    }
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
          zai: {
            env: "ZAI_API_KEY",
            models: [
              {
                id: "glm-5.3-flash",
                endpoints: [
                  {
                    id: "official",
                    label: "Z.AI Coding Plan",
                    base_url: "https://api.z.ai/api/coding/paas/v4",
                    api_key_env: "ZAI_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
              {
                id: "glm-5.3",
                endpoints: [
                  {
                    id: "official",
                    label: "Z.AI Coding Plan",
                    base_url: "https://api.z.ai/api/coding/paas/v4",
                    api_key_env: "ZAI_API_KEY",
                    api_type: "openai",
                  },
                ],
              },
            ],
          },
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
          ollama: {
            env: "",
            models: [{ id: "qwen3", endpoints: [] }],
          },
        },
      });
      return;
    }
    if (request.method === "profile/llm/list") {
      const profileId = profileIdFor(socket, request.params);
      if (!request.params?.session_id) {
        reply(socket, request.id, profileModelConfiguration(profileId));
        return;
      }
      reply(socket, request.id, {
        session_id: sessionId,
        models: configuredModelsForProfile(profileId).map(sessionModel),
      });
      return;
    }
    if (request.method === "profile/llm/select") {
      const modelId = request.params?.model_id;
      const familyId = request.params?.family_id;
      const routeId = request.params?.route_id ?? "official";
      const configured = configuredModelsForProfile(
        profileIdFor(socket, request.params),
      );
      const selected = configured.find(
        (model) =>
          model.model_id === modelId &&
          model.family_id === familyId &&
          model.route.route_id === routeId,
      );
      if (!selected) {
        replyError(socket, request.id, -32602, "Model is not configured");
        return;
      }
      const profileId = profileIdFor(socket, request.params);
      for (const model of configured) model.selected = model === selected;
      const runtimeModel =
        effectiveRuntimeModelByProfile.get(profileId) ?? defaultRuntimeModel;
      reply(socket, request.id, {
        session_id: sessionId,
        selected: {
          ...sessionModel(selected),
          selected: true,
        },
        applied: true,
        restart_required: true,
        runtime_policy_stamp: runtimePolicyStamp(
          profileId,
          runtimeModel,
          permission,
        ),
      });
      return;
    }
    if (request.method === "profile/local/create") {
      // Core owns the final id and may normalize or suffix a colliding request.
      // Keeping this fixture non-equal prevents the Web onboarding flow from
      // treating requested_id as authoritative.
      createdProfileId =
        request.params.requested_id === "coding"
          ? "coding-2"
          : request.params.requested_id;
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
      const invalidKeylessProbe =
        request.params.selection?.family_id === "ollama" &&
        request.params.api_key !== "octoscode-web-keyless-probe";
      const applied = !rejected && !invalidKeylessProbe;
      reply(socket, request.id, {
        profile_id: request.params.profile_id,
        applied,
        message: applied
          ? "Provider test succeeded"
          : rejected
            ? "Provider rejected the supplied credential"
            : "Keyless compatibility probe missing",
        ...(!applied
          ? {
              error: rejected
                ? "Provider rejected the supplied credential"
                : "Keyless compatibility probe missing",
            }
          : {}),
      });
      return;
    }
    if (request.method === "profile/llm/fetch_models") {
      const familyId = request.params.selection?.family_id;
      const route = request.params.selection?.route;
      const profileId = profileIdFor(socket, request.params);
      const savedCredential = configuredModelsForProfile(profileId).some(
        (model) =>
          model.family_id === familyId &&
          model.route.route_id === route?.route_id &&
          model.has_api_key,
      );
      if (
        !request.params.api_key &&
        !savedCredential &&
        familyId !== "ollama"
      ) {
        reply(socket, request.id, {
          profile_id: profileId,
          family_id: familyId,
          models: [],
          reason: "no_api_key",
        });
        return;
      }
      const discovered =
        familyId === "zai"
          ? ["glm-5.3-flash", "glm-5.3", "glm-5.2"]
          : familyId === "deepseek"
            ? ["deepseek-chat", "deepseek-reasoner"]
            : familyId === "ollama"
              ? ["qwen3", "gpt-oss:20b"]
              : [];
      reply(socket, request.id, {
        profile_id: profileId,
        family_id: familyId,
        models: discovered,
        ...(discovered.length ? {} : { reason: "provider_unavailable" }),
      });
      return;
    }
    if (request.method === "profile/llm/upsert") {
      const profileId = profileIdFor(socket, request.params);
      const selection = request.params.selection;
      const route = selection?.route;
      const configured = configuredModelsForProfile(profileId);
      const existing = configured.find(
        (model) =>
          model.family_id === selection?.family_id &&
          model.model_id === selection?.model_id &&
          model.route.route_id === route?.route_id,
      );
      const next = existing ?? {
        family_id: selection?.family_id,
        model_id: selection?.model_id,
        route: {},
        has_api_key: false,
        selected: false,
        available: true,
      };
      next.route = {
        route_id: route?.route_id,
        label: route?.label,
        base_url: route?.base_url,
        api_key_env: route?.api_key_env,
        api_type: route?.api_type,
      };
      if (request.params.api_key) next.has_api_key = true;
      if (!existing) configured.push(next);
      if (
        request.params.set_primary ||
        !configured.some((model) => model.selected)
      ) {
        for (const model of configured) model.selected = model === next;
      }
      reply(socket, request.id, {
        profile_id: profileId,
        applied: true,
      });
      return;
    }
    if (request.method === "profile/llm/delete") {
      const profileId = profileIdFor(socket, request.params);
      const configured = configuredModelsForProfile(profileId);
      const index = configured.findIndex(
        (model) =>
          model.family_id === request.params.family_id &&
          model.model_id === request.params.model_id &&
          model.route.route_id === request.params.route_id,
      );
      if (index < 0) {
        replyError(socket, request.id, -32602, "Model is not configured");
        return;
      }
      const [deleted] = configured.splice(index, 1);
      if (deleted?.selected && configured[0]) configured[0].selected = true;
      reply(socket, request.id, {
        ...profileModelConfiguration(profileId),
        applied: true,
      });
      return;
    }
    if (request.method === "session/open") {
      const scope = sessionScopeFor(
        sessionId,
        request.params,
        connectionProfileId,
      );
      if (!scope.ok) {
        rejectSessionScope(socket, request.id, scope);
        return;
      }
      if (rejectedSessionIds.has(sessionId)) {
        replyError(
          socket,
          request.id,
          -32_040,
          "The saved Session is no longer available",
        );
        return;
      }
      const profileId = scope.profileId;
      const workspaceRoot =
        request.params?.cwd ??
        openedWorkspaceBySocket.get(socket) ??
        defaultWorkspace;
      openedSessionBySocket.set(socket, sessionId);
      openedWorkspaceBySocket.set(socket, workspaceRoot);
      openedProfileBySocket.set(socket, profileId);
      const workspaceSessions = sessionsByWorkspace.get(workspaceRoot) ?? [];
      if (!workspaceSessions.some((session) => session.id === sessionId)) {
        sessionsByWorkspace.set(workspaceRoot, [
          {
            id: sessionId,
            message_count: 0,
            title: "New coding session",
            updated_at: new Date().toISOString(),
          },
          ...workspaceSessions,
        ]);
      }
      reply(socket, request.id, {
        opened: {
          session_id: sessionId,
          active_profile_id: profileId,
          workspace_root: workspaceRoot,
          cursor: { stream: sessionId, seq: 10 },
          capabilities,
        },
      });
      return;
    }
    if (request.method === "session/hydrate") {
      const openedSessionId = openedSessionBySocket.get(socket);
      const openedProfileId = openedProfileBySocket.get(socket);
      const routedProfileId = profileIdFromSessionId(sessionId) ?? "_main";
      if (
        openedSessionId !== sessionId ||
        (openedProfileId && routedProfileId !== openedProfileId)
      ) {
        replyError(
          socket,
          request.id,
          -32_004,
          `unknown session: ${sessionId}`,
        );
        return;
      }
      const result = {
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
      };
      if (delayedHydrateSockets.delete(socket)) {
        setTimeout(() => reply(socket, request.id, result), 150);
      } else {
        reply(socket, request.id, result);
      }
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
      const profileId = profileIdFor(socket, request.params);
      const runtimeModel =
        effectiveRuntimeModelByProfile.get(profileId) ?? defaultRuntimeModel;
      reply(socket, request.id, {
        session_id: sessionId,
        runtime_mode: "solo",
        profile_id: profileId,
        workspace_root: openedWorkspaceBySocket.get(socket) ?? defaultWorkspace,
        model: { ...runtimeModel, selected: true },
        sandbox: permission.mode,
        network: permission.network === "allow" ? "allowed" : "blocked",
        approval_policy: "on-request",
        mcp_servers: [],
        runtime_policy_stamp: runtimePolicyStamp(
          profileId,
          runtimeModel,
          permission,
        ),
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
      const workspaceRoot =
        request.params?.cwd ??
        openedWorkspaceBySocket.get(socket) ??
        defaultWorkspace;
      reply(socket, request.id, {
        sessions: sessionsByWorkspace.get(workspaceRoot) ?? [],
      });
      return;
    }
    if (request.method === "session/delete") {
      for (const [workspaceRoot, sessions] of sessionsByWorkspace) {
        sessionsByWorkspace.set(
          workspaceRoot,
          sessions.filter(
            (session) => session.id !== request.params.session_id,
          ),
        );
      }
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

function authTokenFromRequestUrl(requestUrl) {
  const query = requestUrl?.split("?", 2)[1]?.split("#", 1)[0];
  if (!query) return "";
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (key !== "token" && key !== "_token") continue;
    const encoded = separator < 0 ? "" : pair.slice(separator + 1);
    try {
      // Match Core's RFC 3986 query-token behavior: percent-decode without
      // treating a literal plus as a space.
      return decodeURIComponent(encoded);
    } catch {
      return "";
    }
  }
  return "";
}

function authTokenFromUpgradeRequest(request) {
  const authorization = request.headers.authorization;
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const bearer =
    typeof header === "string" ? header.slice("Bearer ".length) : "";
  return header?.startsWith("Bearer ") && bearer
    ? bearer
    : authTokenFromRequestUrl(request.url);
}

function authenticatedProfileForToken(token) {
  return mockProfileAuthToken && token === mockProfileAuthToken
    ? mockProfileAuthId
    : undefined;
}

function sessionScopeFor(sessionId, params, connectionProfileId) {
  if (typeof sessionId !== "string" || !sessionId) {
    return {
      ok: false,
      message: "session_id must be a non-empty string",
      data: undefined,
      authViolation: false,
    };
  }
  const requested = params?.profile_id;
  if (
    requested !== undefined &&
    (typeof requested !== "string" || !requested)
  ) {
    return {
      ok: false,
      message: "profile_id cannot be empty",
      data: undefined,
      authViolation: false,
    };
  }
  const sessionProfileId = profileIdFromSessionId(sessionId);
  if (connectionProfileId) {
    if (requested !== undefined && requested !== connectionProfileId) {
      return scopeMismatch(
        "profile_id is outside the authenticated profile",
        connectionProfileId,
        requested,
        true,
      );
    }
    if (sessionProfileId && sessionProfileId !== connectionProfileId) {
      return scopeMismatch(
        "session_id is outside the authenticated profile",
        connectionProfileId,
        sessionProfileId,
        true,
      );
    }
    return { ok: true, profileId: connectionProfileId };
  }
  if (requested && sessionProfileId && requested !== sessionProfileId) {
    return scopeMismatch(
      "profile_id does not match session_id profile",
      sessionProfileId,
      requested,
      false,
    );
  }
  return {
    ok: true,
    profileId: requested ?? sessionProfileId ?? defaultProfileId,
  };
}

function profileIdFromSessionId(sessionId) {
  const [base] = sessionId.split("#", 1);
  const segments = base.split(":");
  if (
    segments.length >= 3 &&
    !sessionChannels.has(segments[0]) &&
    sessionChannels.has(segments[1])
  ) {
    return segments[0];
  }
  return undefined;
}

function scopeMismatch(
  message,
  expectedProfileId,
  actualProfileId,
  authViolation,
) {
  return {
    ok: false,
    message,
    data: {
      expected_profile_id: expectedProfileId,
      actual_profile_id: actualProfileId,
      ...(authViolation ? { auth_scope_violation: true } : {}),
    },
    authViolation,
  };
}

function rejectSessionScope(socket, id, scope) {
  if (scope.authViolation) {
    socket.close(1008, "auth_expired");
    return;
  }
  replyError(socket, id, -32602, scope.message, scope.data);
}

function profileIdFor(socket, params) {
  const requested =
    typeof params?.profile_id === "string" ? params.profile_id.trim() : "";
  return (
    requested ||
    openedProfileBySocket.get(socket) ||
    authenticatedProfileBySocket.get(socket) ||
    defaultProfileId
  );
}

function runtimePolicyStamp(profileId, runtimeModel, permission) {
  return {
    model: runtimeModel.model,
    provider: runtimeModel.provider,
    profile_id: profileId,
    sandbox: permission.mode,
    network: permission.network === "allow" ? "allowed" : "blocked",
    approval_policy: "on-request",
  };
}

function reply(socket, id, result) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function replyError(socket, id, code, message, data) {
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    }),
  );
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

function notifyRpc(socket, method, params) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
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
