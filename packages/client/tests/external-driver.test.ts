import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverCapabilityError,
  ExternalDriverRefusalError,
  ExternalDriverProtocolError,
  adoptedIdentityIsNativeShared,
  createExternalDriverCommands,
  decodeExternalDriverCapabilities,
  masterWireBase,
  nextExpectedRevision,
  parseSessionDriverGetResult,
} from "../src/external-driver.ts";
import { OctosUiProtocolError } from "../src/client.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const METHOD = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;

function caps(methods: string[], features: string[]): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos/ui-protocol",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 1,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

const FULL_CAPS = caps([METHOD], [EXTERNAL_DRIVER_V1_FEATURE]);

const NEVER_BOUND_INTERNAL = {
  mode: "internal",
  binding: null,
  recovery: "none",
};

const RETAINED_INTERNAL = {
  mode: "internal",
  binding: {
    driver_id: "driver-a",
    epoch: 7,
    revision: 12,
    lease_expires_at_ms: 0,
    workspace_root: "/ws/root",
    accepted_work: ["op-1", "op-2"],
  },
  recovery: "interrupted",
};

const LIVE_EXTERNAL = {
  mode: "external",
  binding: {
    driver_id: "driver-b",
    epoch: 8,
    revision: 15,
    lease_expires_at_ms: 1_700_000_000_000,
    accepted_work: ["op-9"],
  },
  recovery: "none",
};

describe("decodeExternalDriverCapabilities", () => {
  it("requires BOTH the advertised method and external_driver_v1", () => {
    expect(decodeExternalDriverCapabilities(FULL_CAPS).available).toBe(true);
  });

  it("fails closed when the method is missing", () => {
    const decoded = decodeExternalDriverCapabilities(
      caps([], [EXTERNAL_DRIVER_V1_FEATURE]),
    );
    expect(decoded.available).toBe(false);
    expect(decoded.methodAdvertised).toBe(false);
    expect(decoded.featureAdvertised).toBe(true);
  });

  it("fails closed when the feature is missing", () => {
    const decoded = decodeExternalDriverCapabilities(caps([METHOD], []));
    expect(decoded.available).toBe(false);
    expect(decoded.methodAdvertised).toBe(true);
    expect(decoded.featureAdvertised).toBe(false);
  });
});

describe("parseSessionDriverGetResult", () => {
  it("accepts a never-bound internal scope with binding null", () => {
    expect(parseSessionDriverGetResult(NEVER_BOUND_INTERNAL)).toEqual({
      mode: "internal",
      binding: null,
      recovery: "none",
    });
  });

  it("accepts a retained INACTIVE binding after release/internal", () => {
    const parsed = parseSessionDriverGetResult(RETAINED_INTERNAL);
    expect(parsed?.binding).toEqual({
      driverId: "driver-a",
      epoch: 7,
      revision: 12,
      leaseExpiresAtMs: 0,
      workspaceRoot: "/ws/root",
      acceptedWork: ["op-1", "op-2"],
    });
    expect(parsed?.mode).toBe("internal");
    expect(parsed?.recovery).toBe("interrupted");
  });

  it("accepts a live external binding with a live lease", () => {
    const parsed = parseSessionDriverGetResult(LIVE_EXTERNAL);
    expect(parsed?.mode).toBe("external");
    expect(parsed?.binding?.leaseExpiresAtMs).toBe(1_700_000_000_000);
  });

  it("rejects internal mode with a live lease (CAS metadata is not authority)", () => {
    expect(
      parseSessionDriverGetResult({ ...LIVE_EXTERNAL, mode: "internal" }),
    ).toBeNull();
  });

  it("rejects external mode with no binding", () => {
    expect(
      parseSessionDriverGetResult({ ...LIVE_EXTERNAL, binding: null }),
    ).toBeNull();
  });

  it("rejects unknown mode and recovery values", () => {
    expect(
      parseSessionDriverGetResult({ ...NEVER_BOUND_INTERNAL, mode: "observe" }),
    ).toBeNull();
    expect(
      parseSessionDriverGetResult({
        ...NEVER_BOUND_INTERNAL,
        recovery: "completed",
      }),
    ).toBeNull();
  });

  it("rejects unsafe wire integers without rounding u64", () => {
    const badNumbers: unknown[] = [
      "7",
      7.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      2 ** 53,
      2 ** 64,
    ];
    for (const epoch of badNumbers) {
      expect(
        parseSessionDriverGetResult({
          ...LIVE_EXTERNAL,
          binding: { ...LIVE_EXTERNAL.binding, epoch },
        }),
      ).toBeNull();
    }
    expect(
      parseSessionDriverGetResult({
        ...LIVE_EXTERNAL,
        binding: { ...LIVE_EXTERNAL.binding, revision: "12" },
      }),
    ).toBeNull();
  });

  it("rejects malformed bindings and non-object results", () => {
    expect(parseSessionDriverGetResult(null)).toBeNull();
    expect(parseSessionDriverGetResult(42)).toBeNull();
    expect(
      parseSessionDriverGetResult({
        ...NEVER_BOUND_INTERNAL,
        binding: {
          driver_id: "",
          epoch: 1,
          revision: 1,
          lease_expires_at_ms: 0,
        },
      }),
    ).toBeNull();
    expect(
      parseSessionDriverGetResult({
        ...LIVE_EXTERNAL,
        binding: { ...LIVE_EXTERNAL.binding, accepted_work: ["", 3] },
      }),
    ).toBeNull();
  });

  it("keeps proof/hash/secret fields out of the parsed public view", () => {
    const parsed = parseSessionDriverGetResult({
      ...LIVE_EXTERNAL,
      control_token: "tok-CANARY-123",
      payload_digest: "deadbeef",
      extra_nested: { proof: "tok-CANARY-123" },
    });
    expect(parsed).not.toBeNull();
    const encoded = JSON.stringify(parsed);
    expect(encoded).not.toContain("tok-CANARY-123");
    expect(encoded).not.toContain("control_token");
    expect(encoded).not.toContain("payload_digest");
  });

  it("never interprets a server operations field as inventory", () => {
    const parsed = parseSessionDriverGetResult({
      ...NEVER_BOUND_INTERNAL,
      operations: { items: [], complete: true },
    });
    expect(parsed).toEqual({
      mode: "internal",
      binding: null,
      recovery: "none",
    });
    expect("operations" in (parsed ?? {})).toBe(false);
  });

  it("detaches acceptedWork from the server payload", () => {
    const payload = structuredClone(LIVE_EXTERNAL);
    const parsed = parseSessionDriverGetResult(payload);
    payload.binding.accepted_work.push("op-MUTATED");
    expect(parsed?.binding?.acceptedWork).toEqual(["op-9"]);
  });

  it("freezes canonical views against caller mutation", () => {
    const parsed = parseSessionDriverGetResult(RETAINED_INTERNAL)!;
    expect(() => {
      (parsed.binding as { driverId?: string }).driverId = "evil";
    }).toThrow();
    expect(() => {
      (parsed.binding!.acceptedWork as string[]).push("op-3");
    }).toThrow();
    expect(() => {
      (parsed as { mode?: string }).mode = "external";
    }).toThrow();
    expect(parsed.binding?.driverId).toBe("driver-a");
  });
});

describe("nextExpectedRevision", () => {
  it("derives revision 0 ONLY for a never-bound internal scope", () => {
    expect(
      nextExpectedRevision(parseSessionDriverGetResult(NEVER_BOUND_INTERNAL)!),
    ).toBe(0);
  });

  it("keeps the retained revision after release/internal", () => {
    expect(
      nextExpectedRevision(parseSessionDriverGetResult(RETAINED_INTERNAL)!),
    ).toBe(12);
  });

  it("uses the live external revision", () => {
    expect(
      nextExpectedRevision(parseSessionDriverGetResult(LIVE_EXTERNAL)!),
    ).toBe(15);
  });
});

function rpcStub(calls?: Array<{ method: string; params: unknown }>) {
  return {
    request: async (method: string, params: unknown) => {
      calls?.push({ method, params });
      return structuredClone(LIVE_EXTERNAL);
    },
  };
}

describe("createExternalDriverCommands", () => {
  function harness(
    capabilities: UiProtocolCapabilities,
    sessionId = "dev:local:tui#peer-abc",
  ) {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(LIVE_EXTERNAL);
        },
      },
      sessionId,
      capabilities,
      { profileId: "dev", topic: "peer-abc" },
    );
    return { calls, commands };
  }

  it("fails closed before any wire traffic when the method is missing", async () => {
    const { calls, commands } = harness(caps([], [EXTERNAL_DRIVER_V1_FEATURE]));
    await expect(commands.driverGet()).rejects.toBeInstanceOf(
      ExternalDriverCapabilityError,
    );
    expect(calls).toEqual([]);
  });

  it("fails closed before any wire traffic when the feature is missing", async () => {
    const { calls, commands } = harness(caps([METHOD], []));
    await expect(commands.driverGet()).rejects.toBeInstanceOf(
      ExternalDriverCapabilityError,
    );
    expect(calls).toEqual([]);
  });

  it("sends exactly the captured owning session/topic scope", async () => {
    const { calls, commands } = harness(FULL_CAPS);
    await commands.driverGet();
    expect(calls).toEqual([
      {
        method: METHOD,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
        },
      },
    ]);
  });

  it("omits topic entirely when not supplied", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(NEVER_BOUND_INTERNAL);
        },
      },
      "dev:local:tui",
      FULL_CAPS,
      { profileId: "dev" },
    );
    await expect(commands.driverGet()).resolves.toEqual({
      mode: "internal",
      binding: null,
      recovery: "none",
    });
    expect(calls).toEqual([
      { method: METHOD, params: { session_id: "dev:local:tui" } },
    ]);
  });

  it("rejects an invalid topic scope BEFORE RPC instead of omitting it", () => {
    for (const topic of ["", " ", "bad#topic", "tab\ttopic", "ctl\u0007x"]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      expect(() =>
        createExternalDriverCommands(
          {
            request: async (method, params) => {
              calls.push({ method, params });
              return structuredClone(LIVE_EXTERNAL);
            },
          },
          "dev:local:tui",
          FULL_CAPS,
          { profileId: "dev", topic },
        ),
      ).toThrow(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });

  it("rejects an invalid captured profile BEFORE RPC", () => {
    for (const profileId of ["", "dev:x", "dev#1", "de v"]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      expect(() =>
        createExternalDriverCommands(
          {
            request: async (method, params) => {
              calls.push({ method, params });
              return structuredClone(LIVE_EXTERNAL);
            },
          },
          "dev:local:tui",
          FULL_CAPS,
          { profileId },
        ),
      ).toThrow(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });

  it("rejects a contradictory session-suffix vs captured topic BEFORE RPC", () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    expect(() =>
      createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        "dev:local:tui#peer-xyz",
        FULL_CAPS,
        { profileId: "dev", topic: "peer-abc" },
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(calls).toEqual([]);
  });

  it("rejects a blank/control-char session suffix BEFORE RPC", () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    expect(() =>
      createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        "dev:local:tui#bad topic",
        FULL_CAPS,
        { profileId: "dev" },
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(calls).toEqual([]);
  });

  it("rejects an empty session id BEFORE RPC", () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    expect(() =>
      createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        "",
        FULL_CAPS,
        { profileId: "dev" },
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(calls).toEqual([]);
  });

  it("cannot be steered through spread/extra scope fields", async () => {
    const { calls } = harness(FULL_CAPS, "dev:local:tui");
    const poisoned: Record<string, unknown> = {
      session_id: "evil",
      profile_id: "evil",
    };
    await createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(NEVER_BOUND_INTERNAL);
        },
      },
      "dev:local:tui",
      FULL_CAPS,
      { profileId: "dev", topic: "peer-abc", ...poisoned },
    ).driverGet();
    expect(calls).toEqual([
      {
        method: METHOD,
        params: { session_id: "dev:local:tui", topic: "peer-abc" },
      },
    ]);
  });

  it("sends ONE typed RPC for a valid operations request; missing inventory is an explicit unsupported failure", async () => {
    const { calls, commands } = harness(FULL_CAPS);
    const rejection = commands.driverGet({ operations: {} });
    await expect(rejection).rejects.toBeInstanceOf(ExternalDriverProtocolError);
    const message = String(
      await rejection.catch((error: Error) => error.message),
    );
    expect(message).toContain("unsupported");
    expect(calls).toEqual([
      {
        method: METHOD,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          operations: {},
        },
      },
    ]);
  });

  it("throws constant diagnostics without echoing an untrusted payload", async () => {
    const commands = createExternalDriverCommands(
      { request: async () => ({ mode: "CANARY-bogus" }) },
      "dev:local:tui",
      FULL_CAPS,
      { profileId: "dev" },
    );
    const rejection = commands.driverGet();
    await expect(rejection).rejects.toBeInstanceOf(ExternalDriverProtocolError);
    const message = String(
      await rejection.catch((error: Error) => error.message),
    );
    expect(message).not.toContain("CANARY");
    expect(message.length).toBeLessThan(200);
  });

  it("maps a rejected RPC with constant bounded diagnostics (canary non-echo)", async () => {
    const commands = createExternalDriverCommands(
      {
        request: async () => {
          throw new Error("ECONNRESET CANARY-secret-9f in detail");
        },
      },
      "dev:local:tui",
      FULL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
    const rejection = commands.driverGet();
    await expect(rejection).rejects.toBeInstanceOf(ExternalDriverProtocolError);
    const message = String(
      await rejection.catch((error: Error) => error.message),
    );
    expect(message).not.toContain("CANARY");
    expect(message).not.toContain("ECONNRESET");
    expect(message.length).toBeLessThan(200);
  });

  it("supports an ordinary MASTER topic scope byte-exactly (non-peer topics are legal)", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(LIVE_EXTERNAL);
        },
      },
      "dev:local:tui#glm-oup-master-20260908",
      FULL_CAPS,
      { profileId: "dev", topic: "glm-oup-master-20260908" },
    );
    await commands.driverGet();
    expect(calls).toEqual([
      {
        method: METHOD,
        params: {
          session_id: "dev:local:tui#glm-oup-master-20260908",
          topic: "glm-oup-master-20260908",
        },
      },
    ]);
  });

  it("accepts a bare opaque Web session ID byte-exactly (web-N under confirmed profile auth)", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(LIVE_EXTERNAL);
        },
      },
      "web-4",
      FULL_CAPS,
      { profileId: "dev", topic: "ops" },
    );
    await commands.driverGet();
    expect(calls).toEqual([
      { method: METHOD, params: { session_id: "web-4", topic: "ops" } },
    ]);
  });

  it("accepts ordinary channel/chat scope incl. colon chat ids before RPC", async () => {
    for (const sessionId of [
      "local:demo/api:session",
      "matrix:!room:localhost",
      "dev:matrix:!room:localhost",
      "_main:local:tui#master",
      "web-4",
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        sessionId,
        FULL_CAPS,
        {
          profileId: sessionId.startsWith("_main") ? "_main" : "dev",
          ...(sessionId.includes("#") ? { topic: "master" } : {}),
        },
      );
      await commands.driverGet();
      expect(calls).toEqual([
        {
          method: METHOD,
          params: sessionId.includes("#")
            ? { session_id: sessionId, topic: "master" }
            : { session_id: sessionId },
        },
      ]);
    }
  });

  it("rejects whitespace/control bytes in ANY base shape BEFORE RPC", () => {
    const badBases = [
      "api:bad\n",
      "dev:local:bad\n",
      "web-4\n",
      "dev:local: bad",
      "dev:local:tui#ok-topic\u0007",
      "line:chat id",
    ];
    for (const sessionId of badBases) {
      const calls: Array<{ method: string; params: unknown }> = [];
      expect(() =>
        createExternalDriverCommands(
          {
            request: async (method, params) => {
              calls.push({ method, params });
              return structuredClone(LIVE_EXTERNAL);
            },
          },
          sessionId,
          FULL_CAPS,
          { profileId: "dev" },
        ),
      ).toThrow(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });

  it("enforces the captured-profile fence on the reserved `test` channel", () => {
    // `other:test:chat`: `test` IS reserved → qualified → foreign profile
    // `other` must contradict captured `dev` and fail BEFORE RPC.
    const calls: Array<{ method: string; params: unknown }> = [];
    expect(() =>
      createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        "other:test:chat",
        FULL_CAPS,
        { profileId: "dev" },
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(calls).toEqual([]);
    // Owned: `dev:test:chat` is the same qualified shape and passes.
    const owned: Array<{ method: string; params: unknown }> = [];
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          owned.push({ method, params });
          return structuredClone(LIVE_EXTERNAL);
        },
      },
      "dev:test:chat",
      FULL_CAPS,
      { profileId: "dev" },
    );
    void commands.driverGet();
    expect(owned).toEqual([
      { method: METHOD, params: { session_id: "dev:test:chat" } },
    ]);
  });

  it("tables EVERY Core reserved channel name from source facts", async () => {
    // Verbatim Core types.rs is_channel_name list (20 names, incl. test).
    const CORE_RESERVED = [
      "acp",
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
    ] as const;
    for (const channel of CORE_RESERVED) {
      // reserved as SECOND segment → qualified, must match captured profile
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        `dev:${channel}:chat`,
        FULL_CAPS,
        { profileId: "dev" },
      );
      await commands.driverGet();
      expect(calls).toEqual([
        { method: METHOD, params: { session_id: `dev:${channel}:chat` } },
      ]);
      // Reserved as FIRST segment → UNQUALIFIED ordinary channel:chat and
      // passes; `other:${channel}:chat` is QUALIFIED-FOREIGN (reserved
      // second segment, profile `other` ≠ `dev`) and MUST throw.
      expect(() =>
        createExternalDriverCommands(
          rpcStub(),
          `${channel}:chat-id`,
          FULL_CAPS,
          {
            profileId: "dev",
          },
        ),
      ).not.toThrow();
      expect(() =>
        createExternalDriverCommands(
          rpcStub(),
          `other:${channel}:chat`,
          FULL_CAPS,
          { profileId: "dev" },
        ),
      ).toThrow(ExternalDriverProtocolError);
    }
  });

  it("rejects a foreign-profile session BEFORE RPC (captured profile fence)", () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    expect(() =>
      createExternalDriverCommands(
        {
          request: async (method, params) => {
            calls.push({ method, params });
            return structuredClone(LIVE_EXTERNAL);
          },
        },
        "other:local:tui#peer-abc",
        FULL_CAPS,
        { profileId: "dev", topic: "peer-abc" },
      ),
    ).toThrow(ExternalDriverProtocolError);
    expect(calls).toEqual([]);
  });

  it("exposes exactly the two read-only operations plus the seven gated control methods", () => {
    const { commands } = harness(FULL_CAPS);
    // Migrated from the pre-feature ABSENCE assertion: the factory now
    // intentionally carries the explicit control API. The seven control
    // methods are gated on `external_driver_v1` at CALL time (proved by the
    // dedicated control suites), but their keys are present on the surface.
    // This pins the EXACT nine keys, and that every one is callable.
    const expected = [
      "driverAcquire",
      "driverGet",
      "driverRelease",
      "driverRenew",
      "nextExpectedRevision",
      "peerControl",
      "peerDispatch",
      "wakeAck",
      "wakeClaim",
    ] as const;
    expect(Object.keys(commands).sort()).toEqual([...expected]);
    const surface = commands as unknown as Record<string, unknown>;
    for (const key of expected) {
      expect(typeof surface[key]).toBe("function");
    }
  });
});

describe("driverGet typed operations integration", () => {
  const BASE_VIEW = structuredClone(LIVE_EXTERNAL);

  function recordingRpc(
    result: unknown,
    calls: Array<{ method: string; params: unknown }>,
    error?: Error,
  ) {
    return {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (error) throw error;
        return structuredClone(result);
      },
    };
  }

  function commandsWith(
    result: unknown,
    calls: Array<{ method: string; params: unknown }>,
    error?: Error,
  ) {
    return createExternalDriverCommands(
      recordingRpc(result, calls, error),
      "dev:local:tui#peer-abc",
      FULL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
  }

  const GOOD_ROW = {
    operation_id: "op-1",
    kind: "peer_dispatch",
    acceptance: {
      model: "glm-5.3",
      model_lane: "external-master",
      workspace_root: "/ws/root",
      adopted_turn_id: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
      adopted_session_id: "dev:local:tui#peer-glm-worker-1",
      slug: "glm-worker-1",
      accepted_at_ms: 1,
      payload_digest: "a".repeat(64),
    },
    lifecycle: "started",
    created_at_ms: 1,
  };
  const GOOD_PAGE = {
    items: [GOOD_ROW],
    snapshot: "snap-1",
    observed_revision: "5",
    complete: false,
    next_cursor: "opaque-cursor-1",
  };
  const PAGE_RESULT = {
    ...structuredClone(LIVE_EXTERNAL),
    operations: structuredClone(GOOD_PAGE),
  };

  it("omission preserves exact legacy params and result shape", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(structuredClone(BASE_VIEW), calls);
    const view = await commands.driverGet();
    expect(calls).toEqual([
      {
        method: METHOD,
        params: { session_id: "dev:local:tui#peer-abc", topic: "peer-abc" },
      },
    ]);
    expect(view.mode).toBe("external");
    expect("operations" in view).toBe(false);
  });

  it("valid first page passes validated operations in the SAME single RPC as binding", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(PAGE_RESULT, calls);
    const view = await commands.driverGet({
      operations: { limit: 25 },
    });
    expect(calls).toEqual([
      {
        method: METHOD,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          operations: { limit: 25 },
        },
      },
    ]);
    expect(view.mode).toBe("external");
    expect(view.operations?.kind).toBe("page");
    if (view.operations?.kind === "page") {
      expect(view.operations.page.items.length).toBe(1);
      expect(view.operations.page.nextCursor).toBe("opaque-cursor-1");
      expect(view.operations.page.observedRevision).toBe("5");
    }
  });

  it("next page passes the exact opaque cursor and fixed limit", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(
      {
        ...structuredClone(LIVE_EXTERNAL),
        operations: {
          ...structuredClone(GOOD_PAGE),
          items: [],
          complete: true,
          next_cursor: null,
        },
      },
      calls,
    );
    await commands.driverGet({
      operations: { cursor: "opaque-cursor-1", limit: 100 },
    });
    expect(calls[0]!.params).toEqual({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
      operations: { cursor: "opaque-cursor-1", limit: 100 },
    });
  });

  it("malformed operations options (null/array/unknown/range) refuse offline with zero RPCs", async () => {
    for (const bad of [
      null,
      [1],
      { unknownField: 1 },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: "" },
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = commandsWith(PAGE_RESULT, calls);
      await expect(
        commands.driverGet({ operations: bad } as never),
      ).rejects.toBeInstanceOf(ExternalDriverProtocolError);
      expect(calls).toEqual([]);
    }
  });

  it("requested-but-missing operations is a typed explicit unsupported failure", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(structuredClone(BASE_VIEW), calls);
    const rejection = commands.driverGet({ operations: {} });
    await expect(rejection).rejects.toBeInstanceOf(ExternalDriverProtocolError);
    const message = String(
      await rejection.catch((error: Error) => error.message),
    );
    expect(message).toContain("unsupported");
    expect(calls).toEqual([
      {
        method: METHOD,
        params: {
          session_id: "dev:local:tui#peer-abc",
          topic: "peer-abc",
          operations: {},
        },
      },
    ]);
  });

  it("malformed/null/foreign-scope page refuses explicitly, never empty inventory", async () => {
    const foreignRow = {
      ...structuredClone(GOOD_ROW),
      acceptance: {
        ...structuredClone(GOOD_ROW.acceptance),
        adopted_session_id: "other:local:tui#peer-glm-worker-1",
      },
    };
    for (const badResult of [
      { ...structuredClone(LIVE_EXTERNAL), operations: null },
      { ...structuredClone(LIVE_EXTERNAL), operations: { items: [] } },
      {
        ...structuredClone(LIVE_EXTERNAL),
        operations: {
          items: [foreignRow],
          snapshot: "s",
          observed_revision: "5",
          complete: true,
          next_cursor: null,
        },
      },
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = commandsWith(badResult, calls);
      await expect(
        commands.driverGet({ operations: {} }),
      ).rejects.toBeInstanceOf(ExternalDriverProtocolError);
      expect(calls.length).toBe(1);
    }
  });

  it("unrequested operations stays ignored by the legacy base decoder", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(PAGE_RESULT, calls);
    const view = await commands.driverGet();
    expect(calls[0]!.params).toEqual({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
    });
    expect(view.mode).toBe("external");
    expect("operations" in view).toBe(false);
  });

  it("mutating the caller options object mid-request cannot retarget params or fences", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rpc = {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        await gate;
        return structuredClone(PAGE_RESULT);
      },
    };
    const commands = createExternalDriverCommands(
      rpc,
      "dev:local:tui#peer-abc",
      FULL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
    const opts = { operations: { limit: 25 } } as {
      operations: { limit: number };
    };
    const pending = commands.driverGet(opts);
    opts.operations.limit = 100;
    release();
    const view = await pending;
    expect(calls[0]!.params).toEqual({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
      operations: { limit: 25 },
    });
    expect(view.operations?.kind).toBe("page");
  });

  it("server errors stay constant/scrubbed (canary never echoed)", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = commandsWith(
      null,
      calls,
      new Error("ECONNRESET CANARY-token-9f detail"),
    );
    const rejection = commands.driverGet({ operations: {} });
    await expect(rejection).rejects.toBeInstanceOf(ExternalDriverProtocolError);
    const message = String(
      await rejection.catch((error: Error) => error.message),
    );
    expect(message).not.toContain("CANARY");
    expect(message).not.toContain("ECONNRESET");
    expect(message.length).toBeLessThan(200);
  });

  it("capability gates still apply with zero requests when either gate is missing", async () => {
    for (const missing of [
      caps([], [EXTERNAL_DRIVER_V1_FEATURE]),
      caps([METHOD], []),
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = createExternalDriverCommands(
        recordingRpc(PAGE_RESULT, calls),
        "dev:local:tui#peer-abc",
        missing,
        { profileId: "dev", topic: "peer-abc" },
      );
      await expect(
        commands.driverGet({ operations: {} }),
      ).rejects.toBeInstanceOf(ExternalDriverCapabilityError);
      expect(calls).toEqual([]);
    }
  });
});

describe("driverGet typed RPC refusal boundary", () => {
  const CAPS = caps([METHOD], [EXTERNAL_DRIVER_V1_FEATURE]);

  function commandsWith(reject: () => never) {
    return createExternalDriverCommands(
      { request: async () => reject() },
      "dev:local:tui#peer-abc",
      CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
  }

  it("preserves an allowlisted kind from an ACTUAL OctosUiProtocolError", async () => {
    const commands = commandsWith(() => {
      throw new OctosUiProtocolError(32001, "server detail CANARY-secret-7", {
        kind: "driver_operations_cursor_reset",
      });
    });
    const error = await commands
      .driverGet({ operations: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as ExternalDriverRefusalError).refusalKind).toBe(
      "driver_operations_cursor_reset",
    );
    // Scrubbed: message is the constant kind, never server payload.
    expect((error as Error).message).not.toContain("CANARY");
    expect((error as Error).message).not.toContain("server detail");
  });

  it("rejects a duck-typed fake .data.kind lookalike (stays generic, scrubbed)", async () => {
    const commands = commandsWith(() => {
      const fake = new Error("fake CANARY-2");
      Object.assign(fake, {
        name: "OctosUiProtocolError",
        code: 32001,
        data: { kind: "driver_operations_cursor_reset" },
      });
      throw fake;
    });
    const error = await commands
      .driverGet({ operations: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as Error).message).not.toContain("CANARY");
    expect((error as Error).message).not.toContain("cursor_reset");
  });

  it("a NON-allowlisted kind on a REAL protocol error stays generic", async () => {
    const commands = commandsWith(() => {
      throw new OctosUiProtocolError(32002, "x", {
        kind: "some_future_kind",
      });
    });
    const error = await commands
      .driverGet({ operations: {} })
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as Error).message).not.toContain("some_future_kind");
  });

  it("plain transport errors stay the scrubbed generic failure", async () => {
    const commands = commandsWith(() => {
      throw new Error("ECONNRESET CANARY-3 body");
    });
    const error = await commands
      .driverGet({ operations: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    expect((error as Error).message).not.toContain("CANARY");
    expect((error as Error).message).not.toContain("ECONNRESET");
  });
});

describe("driverGet command-return gaps (root review)", () => {
  const GOOD_ROW = {
    operation_id: "op-1",
    kind: "peer_dispatch",
    acceptance: {
      model: "glm-5.3",
      model_lane: "external-master",
      workspace_root: "/ws/root",
      adopted_turn_id: "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01",
      adopted_session_id: "dev:local:tui#peer-glm-worker-1",
      slug: "glm-worker-1",
      accepted_at_ms: 1,
      payload_digest: "a".repeat(64),
    },
    lifecycle: "started",
    created_at_ms: 1,
  };
  const GOOD_PAGE = {
    items: [GOOD_ROW],
    snapshot: "snap-1",
    observed_revision: "5",
    complete: true,
    next_cursor: null,
  };
  const PAGE_RESULT = {
    ...structuredClone(LIVE_EXTERNAL),
    operations: structuredClone(GOOD_PAGE),
  };

  function make(
    calls: Array<{ method: string; params: unknown }>,
    result: unknown = PAGE_RESULT,
  ) {
    return createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(result);
        },
      },
      "dev:local:tui#peer-abc",
      FULL_CAPS,
      { profileId: "dev", topic: "peer-abc" },
    );
  }

  it("(1) null/array/unknown-only top-level options reject BOUNDED, ZERO traffic", async () => {
    for (const bad of [
      null,
      [],
      ["operations"],
      { unknownKey: 1 },
      { profileId: "evil" },
      7,
      "text",
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = make(calls);
      await expect(commands.driverGet(bad as never)).rejects.toBeInstanceOf(
        ExternalDriverProtocolError,
      );
      expect(calls).toEqual([]);
    }
  });

  it("(1b) null/array/unknown inside operations ALSO reject with zero traffic", async () => {
    for (const bad of [
      { operations: null },
      { operations: [] },
      { operations: "x" },
      { operations: 3 },
      { operations: { bad: 1 } },
    ]) {
      const calls: Array<{ method: string; params: unknown }> = [];
      const commands = make(calls);
      await expect(commands.driverGet(bad as never)).rejects.toBeInstanceOf(
        ExternalDriverProtocolError,
      );
      expect(calls).toEqual([]);
    }
  });

  it("(2) mutating the scope object BEFORE the call cannot retarget the decode fence", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const scope = { profileId: "dev", topic: "peer-abc" };
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          return structuredClone(PAGE_RESULT);
        },
      },
      "dev:local:tui#peer-abc",
      FULL_CAPS,
      scope,
    );
    // Retarget AFTER factory construction, BEFORE driverGet.
    (scope as { profileId: string }).profileId = "other";
    const view = await commands.driverGet({ operations: {} });
    expect(view.operations?.kind).toBe("page");
    expect(calls[0]!.params).toEqual({
      session_id: "dev:local:tui#peer-abc",
      topic: "peer-abc",
      operations: {},
    });
  });

  it("(2b) scope mutation DURING a deferred RPC cannot retarget the fence either", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scope = { profileId: "dev", topic: "peer-abc" };
    const commands = createExternalDriverCommands(
      {
        request: async (method, params) => {
          calls.push({ method, params });
          await gate;
          return structuredClone(PAGE_RESULT);
        },
      },
      "dev:local:tui#peer-abc",
      FULL_CAPS,
      scope,
    );
    const pending = commands.driverGet({ operations: {} });
    (scope as { profileId: string }).profileId = "other";
    release();
    const view = await pending;
    expect(view.operations?.kind).toBe("page");
  });

  it("(3) the returned view and page outcome are FROZEN against caller mutation", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const commands = make(calls);
    const view = await commands.driverGet({ operations: {} });
    if (view.operations?.kind !== "page") {
      throw new Error("expected page outcome");
    }
    expect(() => {
      (view as { operations?: unknown }).operations = { kind: "omitted" };
    }).toThrow();
    expect(() => {
      (view.operations!.page as { snapshot?: string }).snapshot = "evil";
    }).toThrow();
    expect(view.operations.page.snapshot).toBe("snap-1");
  });
});

describe("control-character boundary guards (native wire shape)", () => {
  // 0x1f (last C0) / 0x7f (DEL) MUST be rejected; 0x21 and 0x7e MUST pass,
  // proving the explicit predicate keeps the exact old character-class
  // boundaries (0x00-0x1f and 0x7f) and nothing wider.
  const TURN = "123e4567-e89b-42d3-a456-426614174000";

  it("rejects C0/DEL control bytes in a captured master base", () => {
    expect(masterWireBase("dev", "dev")).toBe("dev");
    expect(masterWireBase("dev!", "dev")).toBe("dev!");
    expect(masterWireBase("dev\u001e", "dev")).toBeNull();
    expect(masterWireBase("dev\u001f", "dev")).toBeNull();
    expect(masterWireBase("dev\u007f", "dev")).toBeNull();
    expect(masterWireBase("dev\u0000", "dev")).toBeNull();
    // Whitespace stays rejected by the separate, unchanged `\s` guard.
    expect(masterWireBase("dev\u0020", "dev")).toBeNull();
  });

  it("rejects C0/DEL control bytes in an ordinary topic", () => {
    expect(masterWireBase("dev#ops", "dev")).toBe("dev");
    expect(masterWireBase("dev#ops\u001f", "dev")).toBeNull();
    expect(masterWireBase("dev#ops\u007f", "dev")).toBeNull();
  });

  it("rejects C0/DEL control bytes in an adopted native-shared identity", () => {
    expect(adoptedIdentityIsNativeShared(TURN, "dev#peer-abc", "abc")).toBe(
      true,
    );
    expect(adoptedIdentityIsNativeShared(TURN, "dev!#peer-abc", "abc")).toBe(
      true,
    );
    expect(
      adoptedIdentityIsNativeShared(TURN, "dev\u001f#peer-abc", "abc"),
    ).toBe(false);
    expect(
      adoptedIdentityIsNativeShared(TURN, "dev\u007f#peer-abc", "abc"),
    ).toBe(false);
    expect(
      adoptedIdentityIsNativeShared(TURN, "dev\u0020#peer-abc", "abc"),
    ).toBe(false);
  });
});
