import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UI_FEATURES,
  OctosUiClient,
  OctosUiRequestTimeoutError,
} from "../src/client.ts";
import type { PermissionProfileSetParams } from "../src/types.ts";
import fixture from "./fixtures/ui-protocol-v1.json";

describe("OctosUiClient", () => {
  it("negotiates lifecycle lookup and verifies the exact requested turn scope", async () => {
    expect(DEFAULT_UI_FEATURES).toContain("state.turn_state_get.v1");
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;
    for (const result of [
      { session_id: "s1", turn_id: "t1", state: "unknown" },
      { session_id: "s2", turn_id: "t1", state: "completed" },
      { session_id: "s1", turn_id: "t2", state: "completed" },
      { session_id: "s1", turn_id: "t1", state: "future" },
    ]) {
      const pending = client.getTurnState({ session_id: "s1", turn_id: "t1" });
      const frame = JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
        id: string;
        method: string;
        params: unknown;
      };
      expect(frame).toMatchObject({
        method: "turn/state/get",
        params: { session_id: "s1", turn_id: "t1" },
      });
      socket.onmessage?.({
        data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }),
      } as MessageEvent);
      if (result.state === "unknown")
        await expect(pending).resolves.toEqual({
          ...result,
          committed_seqs: [],
        });
      else await expect(pending).rejects.toThrow("returned an invalid result");
    }
    client.disconnect();
  });

  it("rejects connect when the socket closes before opening", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const connecting = client.connect();
    socket.onclose?.({} as CloseEvent);

    await expect(connecting).rejects.toThrow("connection closed");
    expect(client.status).toBe("error");
  });

  it("bounds a silent handshake and ignores its late callbacks after retry", async () => {
    vi.useFakeTimers();
    try {
      const oldSocket = createSocket();
      const socket = createSocket();
      const sockets = [oldSocket, socket];
      const client = new OctosUiClient({
        endpoint: "http://127.0.0.1:50080",
        connectTimeoutMs: 100,
        webSocketFactory: () => sockets.shift() as unknown as WebSocket,
      });
      const errors = vi.fn();
      client.subscribeErrors(errors);
      const first = expect(client.connect()).rejects.toThrow(
        "Connection timed out",
      );
      await vi.advanceTimersByTimeAsync(100);
      await first;
      expect(client.status).toBe("error");
      expect(oldSocket.close).toHaveBeenCalledOnce();
      const retry = client.connect();
      socket.readyState = 1;
      socket.onopen?.({} as Event);
      await retry;
      oldSocket.onopen?.({} as Event);
      oldSocket.onerror?.({} as Event);
      oldSocket.onclose?.({} as CloseEvent);
      await vi.advanceTimersByTimeAsync(200);
      expect(client.status).toBe("connected");
      expect(errors).toHaveBeenCalledOnce();
      expect(socket.close).not.toHaveBeenCalled();
      client.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["open", "close", "error", "message"] as const)(
    "ignores a replaced socket's late %s callback on the same client",
    async (event) => {
      const oldSocket = createSocket();
      const socket = createSocket();
      const sockets = [oldSocket, socket];
      const client = new OctosUiClient({
        endpoint: "http://127.0.0.1:50080",
        webSocketFactory: () => sockets.shift() as unknown as WebSocket,
      });
      const errors = vi.fn();
      const notifications = vi.fn();
      client.subscribeErrors(errors);
      client.subscribeNotifications(notifications);
      const first = client.connect();
      oldSocket.readyState = 1;
      oldSocket.onopen?.({} as Event);
      await first;
      client.disconnect();
      const second = client.connect();
      socket.readyState = 1;
      socket.onopen?.({} as Event);
      await second;
      const pending = client.startTurn({
        session_id: "s",
        turn_id: "t",
        input: [],
      });
      const outcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const settled = vi.fn();
      void outcome.then(settled);
      const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0]));
      if (event === "message") {
        oldSocket.onmessage?.({
          data: JSON.stringify({
            jsonrpc: "2.0",
            method: "old/notification",
            params: {},
          }),
        } as MessageEvent);
        oldSocket.onmessage?.({
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id,
            result: { stale: true },
          }),
        } as MessageEvent);
      } else if (event === "close") oldSocket.onclose?.({} as CloseEvent);
      else if (event === "error") oldSocket.onerror?.({} as Event);
      else oldSocket.onopen?.({} as Event);
      await Promise.resolve();
      await Promise.resolve();

      expect(client.status).toBe("connected");
      expect(errors).not.toHaveBeenCalled();
      expect(notifications).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
      socket.onmessage?.({
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          result: { current: true },
        }),
      } as MessageEvent);
      await expect(outcome).resolves.toEqual({ value: { current: true } });
      client.disconnect();
    },
  );

  it("rejects a cancelled connection without poisoning its replacement when the old socket closes", async () => {
    const oldSocket = createSocket();
    const socket = createSocket();
    const sockets = [oldSocket, socket];
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => sockets.shift() as unknown as WebSocket,
    });
    const first = client.connect();
    const rejected = expect(first).rejects.toThrow("connection closed");
    client.disconnect();
    const second = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await second;

    oldSocket.onclose?.({} as CloseEvent);

    await rejected;
    expect(client.status).toBe("connected");
    client.disconnect();
  });

  it("does not publish connected when a cancelled socket opens ahead of its replacement", async () => {
    const oldSocket = createSocket();
    const socket = createSocket();
    const sockets = [oldSocket, socket];
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => sockets.shift() as unknown as WebSocket,
    });
    const first = client.connect();
    const rejected = expect(first).rejects.toThrow("connection replaced");
    client.disconnect();
    const second = client.connect();

    oldSocket.onopen?.({} as Event);

    await rejected;
    expect(client.status).toBe("connecting");
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await second;
    expect(client.status).toBe("connected");
    client.disconnect();
  });

  it("emits canonical approval and user-question response methods", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const approval = client.respondApproval({
      session_id: "s1",
      approval_id: "a1",
      decision: "approve",
      approval_scope: "session",
    });
    const question = client.respondUserQuestion({
      session_id: "s1",
      question_id: "q1",
      answers: [{ selected_labels: ["Fast"] }],
    });

    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string; method: string; params: unknown }>;
    expect(frames).toMatchObject([
      {
        method: "approval/respond",
        params: {
          session_id: "s1",
          approval_id: "a1",
          decision: "approve",
          approval_scope: "session",
        },
      },
      {
        method: "user_question/respond",
        params: {
          session_id: "s1",
          question_id: "q1",
          answers: [{ selected_labels: ["Fast"] }],
        },
      },
    ]);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[0]?.id,
        result: {
          approval_id: "a1",
          accepted: true,
          status: "accepted",
          runtime_resumed: true,
        },
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[1]?.id,
        result: {
          question_id: "q1",
          accepted: true,
          runtime_resumed: true,
        },
      }),
    } as MessageEvent);
    await expect(Promise.all([approval, question])).resolves.toHaveLength(2);
  });

  it("rejects malformed typed results instead of leaking unchecked JSON", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const pending = [
      client.openSession({ session_id: "s1" }),
      client.respondApproval({
        session_id: "s1",
        approval_id: "a1",
        decision: "approve",
      }),
      client.respondUserQuestion({
        session_id: "s1",
        question_id: "q1",
        answers: [],
      }),
      client.getLlmCatalog(),
      client.listTasks({ session_id: "s1" }),
      client.readSessionStatus("s1"),
      client.hydrateSession({ session_id: "s1" }),
      client.listSessions(fixture.session_list.request),
      client.listSessionFiles(fixture.session_files_list.request),
      client.listConfigCapabilities(),
      client.resolveLaunch(fixture.launch_resolve.request),
    ];
    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string }>;
    // Lazy result decoding must not defer request dispatch to a later turn.
    expect(frames).toHaveLength(pending.length);
    for (const frame of frames) {
      socket.onmessage?.({
        data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
      } as MessageEvent);
    }

    const results = await Promise.allSettled(pending);
    expect(results.every(({ status }) => status === "rejected")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(Error);
        expect(String(result.reason)).toContain("returned an invalid result");
      }
    }
  });

  it("validates lazily loaded task and model results before resolving callers", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const tasks = client.listTasks({ session_id: "s1" });
    const catalog = client.getLlmCatalog();
    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string; method: string }>;
    expect(frames.map(({ method }) => method)).toEqual([
      "task/list",
      "profile/llm/catalog",
    ]);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[0]?.id,
        result: fixture.task_list.result,
      }),
    } as MessageEvent);
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frames[1]?.id,
        result: {
          families: { local: { env: "", models: [{ id: "local-model" }] } },
        },
      }),
    } as MessageEvent);

    await expect(tasks).resolves.toEqual(fixture.task_list.result);
    await expect(catalog).resolves.toEqual({
      families: [
        {
          id: "local",
          env: "",
          models: [{ id: "local-model", endpoints: [] }],
        },
      ],
    });
  });

  it("preserves JSON-RPC failures and rejects pending work on disconnect", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const failed = client.startTurn({
      session_id: "s1",
      turn_id: "t1",
      input: [],
    });
    const failureFrame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
    };
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: failureFrame.id,
        error: { code: -32000, message: "rejected", data: { safe: true } },
      }),
    } as MessageEvent);
    await expect(failed).rejects.toMatchObject({
      name: "OctosUiProtocolError",
      code: -32000,
      message: "rejected",
      data: { safe: true },
    });

    const interrupted = client.interruptTurn("s1", "t1");
    client.disconnect();
    await expect(interrupted).rejects.toThrow("disconnected");
  });

  it("rejects non-text frames and a second live connection", async () => {
    const socket = createSocket();
    const errors: Error[] = [];
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    client.subscribeErrors((error) => errors.push(error));
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    await expect(client.connect()).rejects.toThrow("already connected");
    socket.onmessage?.({ data: new ArrayBuffer(1) } as MessageEvent);
    expect(errors.at(-1)?.message).toContain("non-text frame");
  });

  it("quarantines late responses after a request timeout", async () => {
    vi.useFakeTimers();
    try {
      const socket = createSocket();
      const errors: Error[] = [];
      const client = new OctosUiClient({
        endpoint: "http://127.0.0.1:50080",
        requestTimeoutMs: 50,
        webSocketFactory: () => socket as unknown as WebSocket,
      });
      client.subscribeErrors((error) => errors.push(error));
      const connecting = client.connect();
      socket.readyState = 1;
      socket.onopen?.({} as Event);
      await connecting;

      const pending = client.startTurn({
        session_id: "s1",
        turn_id: "t1",
        input: [],
      });
      const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
        id: string;
      };
      const rejection = expect(pending).rejects.toThrow(
        OctosUiRequestTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(50);
      await rejection;
      await expect(pending).rejects.toMatchObject({
        message: "turn/start timed out",
        method: "turn/start",
      });

      socket.onmessage?.({
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          result: { ok: true },
        }),
      } as MessageEvent);
      expect(errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives LLM probe requests a longer timeout than the default", async () => {
    vi.useFakeTimers();
    try {
      const socket = createSocket();
      const client = new OctosUiClient({
        endpoint: "http://127.0.0.1:50080",
        requestTimeoutMs: 50,
        webSocketFactory: () => socket as unknown as WebSocket,
      });
      const connecting = client.connect();
      socket.readyState = 1;
      socket.onopen?.({} as Event);
      await connecting;

      const route = {
        route_id: "official",
        label: "Official",
        base_url: "https://api.z.ai/api/paas/v4",
        api_key_env: "ZAI_API_KEY",
        api_type: "openai",
      };
      const probe = client.testLlmProfile({
        profile_id: "coding",
        selection: { family_id: "zai", model_id: "glm-5.3-flash", route },
      });
      const models = client.fetchLlmModels({
        profile_id: "coding",
        selection: { family_id: "zai", route },
      });
      const settled = { probe: false, models: false };
      const probeRejection = expect(probe).rejects.toThrow(
        OctosUiRequestTimeoutError,
      );
      const modelsRejection = expect(models).rejects.toThrow(
        OctosUiRequestTimeoutError,
      );
      void probe.catch(() => {
        settled.probe = true;
      });
      void models.catch(() => {
        settled.models = true;
      });

      // A slow provider must not trip the ordinary request timeout.
      await vi.advanceTimersByTimeAsync(50);
      expect(settled).toEqual({ probe: false, models: false });

      await vi.advanceTimersByTimeAsync(120_000);
      await probeRejection;
      await modelsRejection;
      expect(settled).toEqual({ probe: true, models: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches session open immediately and delivers notifications while its response is decoded", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;
    const notifications = vi.fn();
    client.subscribeNotifications(notifications);
    const opened = client.openSession({ session_id: "s1" });
    expect(socket.send).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
      method: string;
    };
    expect(frame.method).toBe("session/open");
    const result = {
      opened: {
        session_id: "s1",
        capabilities: fixture.config_capabilities_list.result.capabilities,
      },
    };
    socket.onmessage?.({
      data: JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }),
    } as MessageEvent);
    const notification = {
      jsonrpc: "2.0",
      method: "progress/updated",
      params: { session_id: "s1", metadata: { kind: "status" } },
    };
    socket.onmessage?.({
      data: JSON.stringify(notification),
    } as MessageEvent);
    expect(notifications).toHaveBeenCalledWith(notification);
    await expect(opened).resolves.toEqual(result);
    client.disconnect();
  });

  it("validates session/hydrate before returning it", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const hydrate = client.hydrateSession({
      session_id: "coding:local:main",
      include: ["messages", "turns"],
    });
    const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
      method: string;
    };
    expect(frame.method).toBe("session/hydrate");
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        result: {
          session_id: "coding:local:main",
          cursor: { stream: "session", seq: 3 },
          messages: [],
        },
      }),
    } as MessageEvent);

    await expect(hydrate).resolves.toMatchObject({
      cursor: { stream: "session", seq: 3 },
    });
  });

  it("emits and validates authoritative product requests", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const pending = [
      client.listPermissionProfiles(fixture.permission_profile_list.request),
      client.setPermissionProfile(
        fixture.permission_profile_set.request as PermissionProfileSetParams,
      ),
      client.getDiffPreview(fixture.diff_preview_get.request),
      client.listSessions(fixture.session_list.request),
      client.listSessionFiles(fixture.session_files_list.request),
      client.deleteSession(fixture.session_delete.request),
      client.listConfigCapabilities(),
      client.resolveLaunch(fixture.launch_resolve.request),
    ];
    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string; method: string; params: unknown }>;
    expect(frames).toMatchObject([
      {
        method: "permission/profile/list",
        params: fixture.permission_profile_list.request,
      },
      {
        method: "permission/profile/set",
        params: fixture.permission_profile_set.request,
      },
      {
        method: "diff/preview/get",
        params: fixture.diff_preview_get.request,
      },
      {
        method: "session/list",
        params: fixture.session_list.request,
      },
      {
        method: "session/files.list",
        params: fixture.session_files_list.request,
      },
      {
        method: "session/delete",
        params: fixture.session_delete.request,
      },
      {
        method: "config/capabilities/list",
        params: {},
      },
      {
        method: "launch/resolve",
        params: fixture.launch_resolve.request,
      },
    ]);

    const results = [
      fixture.permission_profile_list.result,
      fixture.permission_profile_set.result,
      fixture.diff_preview_get.result,
      fixture.session_list.result,
      fixture.session_files_list.result,
      fixture.session_delete.result,
      fixture.config_capabilities_list.result,
      fixture.launch_resolve.results.resume,
    ];
    for (const [index, frame] of frames.entries()) {
      socket.onmessage?.({
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          result: results[index],
        }),
      } as MessageEvent);
    }
    await expect(Promise.all(pending)).resolves.toHaveLength(8);
  });

  it("emits the exact profile model-management wire contract", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const route = {
      route_id: "official",
      label: "Official",
      base_url: "https://api.z.ai/api/paas/v4",
      api_key_env: "ZAI_API_KEY",
      api_type: "openai",
    };
    const selection = {
      family_id: "zai",
      model_id: "glm-5.3-flash",
      route,
    };
    const pending = [
      client.readProfileLlmConfig({ profile_id: "coding" }),
      client.fetchLlmModels({
        profile_id: "coding",
        selection: { family_id: "zai", route },
      }),
      client.deleteProfileModel({
        profile_id: "coding",
        family_id: "zai",
        model_id: "glm-5.2",
        route_id: "official",
      }),
      client.testLlmProfile({ profile_id: "coding", selection }),
      client.upsertLlmProfile({
        profile_id: "coding",
        selection,
        set_primary: true,
      }),
    ];
    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string; method: string; params: Record<string, unknown> }>;

    expect(frames).toEqual([
      expect.objectContaining({
        method: "profile/llm/list",
        params: { profile_id: "coding" },
      }),
      expect.objectContaining({
        method: "profile/llm/fetch_models",
        params: {
          profile_id: "coding",
          selection: { family_id: "zai", route },
        },
      }),
      expect.objectContaining({
        method: "profile/llm/delete",
        params: {
          profile_id: "coding",
          family_id: "zai",
          model_id: "glm-5.2",
          route_id: "official",
        },
      }),
      expect.objectContaining({
        method: "profile/llm/test",
        params: { profile_id: "coding", selection },
      }),
      expect.objectContaining({
        method: "profile/llm/upsert",
        params: { profile_id: "coding", selection, set_primary: true },
      }),
    ]);

    const configured = {
      provider: "zai",
      model: "glm-5.3-flash",
      family_id: "zai",
      model_id: "glm-5.3-flash",
      route,
      route_id: "official",
      base_url: route.base_url,
      api_key_env: route.api_key_env,
      has_api_key: true,
      selected: true,
      available: true,
    };
    const results = [
      {
        profile_id: "coding",
        primary: configured,
        fallbacks: [],
      },
      {
        profile_id: "coding",
        family_id: "zai",
        models: ["glm-5.3-flash"],
      },
      {
        profile_id: "coding",
        primary: null,
        fallbacks: [],
        applied: true,
      },
      {
        profile_id: "coding",
        applied: true,
        message: "Provider connection verified",
      },
      { profile_id: "coding", applied: true },
    ];
    for (const [index, frame] of frames.entries()) {
      socket.onmessage?.({
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          result: results[index],
        }),
      } as MessageEvent);
    }
    await expect(Promise.all(pending)).resolves.toHaveLength(5);
  });
});

function createSocket() {
  return {
    readyState: 0,
    onopen: null as ((event: Event) => void) | null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onclose: null as ((event: CloseEvent) => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  };
}
