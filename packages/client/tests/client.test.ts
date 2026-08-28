import { describe, expect, it, vi } from "vitest";
import { DEFAULT_UI_FEATURES, OctosUiClient } from "../src/client.ts";
import type { PermissionProfileSetParams } from "../src/types.ts";
import fixture from "./fixtures/ui-protocol-v1.json";

describe("OctosUiClient", () => {
  it("negotiates the core's authoritative session hydrate feature", () => {
    expect(DEFAULT_UI_FEATURES).toContain("state.session_hydrate.v1");
    expect(DEFAULT_UI_FEATURES).not.toContain("session.hydrate.v1");
  });

  it("negotiates the auxiliary REST-to-WebSocket bridge", () => {
    expect(DEFAULT_UI_FEATURES).toContain("auxiliary.rest_to_ws.v1");
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

  it("correlates successful JSON-RPC responses", async () => {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });

    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;

    const request = client.startTurn({
      session_id: "coding:local:main",
      turn_id: "turn-1",
      input: [{ kind: "text", text: "check" }],
    });
    const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
    };
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        result: { ok: true },
      }),
    } as MessageEvent);

    await expect(request).resolves.toEqual({ ok: true });
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
    ];
    const frames = socket.send.mock.calls.map(([frame]) =>
      JSON.parse(String(frame)),
    ) as Array<{ id: string }>;
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
      const rejection = expect(pending).rejects.toThrow("turn/start timed out");
      await vi.advanceTimersByTimeAsync(50);
      await rejection;

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
    expect(frames[0]?.params).not.toHaveProperty("session_id");
    expect(frames[1]?.params).not.toHaveProperty("api_key");
    expect(frames[3]?.params).not.toHaveProperty("api_key");
    expect(frames[4]?.params).not.toHaveProperty("api_key");

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
