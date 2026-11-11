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
  parseSessionDriverGetResult,
} from "../src/external-driver.ts";
import { OctosUiProtocolError } from "../src/client.ts";
import { makeCaps } from "./fixtures/caps.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const METHOD = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;

function caps(methods: string[], features: string[]): UiProtocolCapabilities {
  return makeCaps({ family: "driver", methods, features });
}

const FULL_CAPS = caps([METHOD], [EXTERNAL_DRIVER_V1_FEATURE]);

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
    const noMethod = decodeExternalDriverCapabilities(
      caps([], [EXTERNAL_DRIVER_V1_FEATURE]),
    );
    expect(noMethod.available).toBe(false);
    expect(noMethod.methodAdvertised).toBe(false);
    expect(noMethod.featureAdvertised).toBe(true);
    const noFeature = decodeExternalDriverCapabilities(caps([METHOD], []));
    expect(noFeature.available).toBe(false);
    expect(noFeature.methodAdvertised).toBe(true);
    expect(noFeature.featureAdvertised).toBe(false);
  });
});

describe("parseSessionDriverGetResult", () => {
  it("maps a retained binding to the full canonical camelCase view", () => {
    expect(parseSessionDriverGetResult(RETAINED_INTERNAL)).toEqual({
      mode: "internal",
      binding: {
        driverId: "driver-a",
        epoch: 7,
        revision: 12,
        leaseExpiresAtMs: 0,
        workspaceRoot: "/ws/root",
        acceptedWork: ["op-1", "op-2"],
      },
      recovery: "interrupted",
    });
  });

  // Design: Core's CAS metadata (a live lease) is not authority over the
  // session's declared driver mode — an internal-mode session with a live
  // lease is a contradictory server payload and must fail closed, not guess.
  it("rejects internal mode with a live lease (CAS metadata is not authority)", () => {
    expect(
      parseSessionDriverGetResult({ ...LIVE_EXTERNAL, mode: "internal" }),
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

  it("detaches acceptedWork from the server payload", () => {
    const payload = structuredClone(LIVE_EXTERNAL);
    const parsed = parseSessionDriverGetResult(payload);
    payload.binding.accepted_work.push("op-MUTATED");
    expect(parsed?.binding?.acceptedWork).toEqual(["op-9"]);
  });
});

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

  it.each([
    ["the method", caps([], [EXTERNAL_DRIVER_V1_FEATURE])],
    ["the feature", caps([METHOD], [])],
  ])(
    "fails closed before any wire traffic when %s is missing",
    async (_label, capabilities) => {
      const { calls, commands } = harness(capabilities);
      await expect(commands.driverGet()).rejects.toBeInstanceOf(
        ExternalDriverCapabilityError,
      );
      expect(calls).toEqual([]);
    },
  );

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

  // Legal non-peer scope shapes share one accept path: the captured scope is
  // sent byte-exactly. Before changing any row, check the Core-side fence that
  // distinguishes ordinary channels from reserved ones (see the `test`
  // channel fence below).
});

describe("driverGet typed operations integration", () => {
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
});

describe("control-character boundary guards (native wire shape)", () => {
  // 0x1f (last C0) / 0x7f (DEL) MUST be rejected; 0x21 and 0x7e MUST pass,
  // proving the explicit predicate keeps the exact old character-class
  // boundaries (0x00-0x1f and 0x7f) and nothing wider.
  const TURN = "123e4567-e89b-42d3-a456-426614174000";

  // The C0/DEL boundary is one guard applied at every identity surface
  // (captured base, topic, adopted identity). Keep the positive rows: they pin
  // that printable bytes — including `!` — are NOT swept into the reject.
  it("rejects C0/DEL control bytes at every identity surface", () => {
    expect(masterWireBase("dev", "dev")).toBe("dev");
    expect(masterWireBase("dev!", "dev")).toBe("dev!");
    for (const base of ["dev", "dev#ops"]) {
      expect(masterWireBase(`${base}\u001e`, "dev")).toBeNull();
      expect(masterWireBase(`${base}\u001f`, "dev")).toBeNull();
      expect(masterWireBase(`${base}\u007f`, "dev")).toBeNull();
      expect(masterWireBase(`${base}\u0000`, "dev")).toBeNull();
    }
    // Whitespace stays rejected by the separate, unchanged `\s` guard.
    expect(masterWireBase("dev\u0020", "dev")).toBeNull();
    expect(adoptedIdentityIsNativeShared(TURN, "dev#peer-abc", "abc")).toBe(
      true,
    );
    expect(adoptedIdentityIsNativeShared(TURN, "dev!#peer-abc", "abc")).toBe(
      true,
    );
    for (const base of ["dev\u001f", "dev\u007f", "dev\u0020"]) {
      expect(
        adoptedIdentityIsNativeShared(TURN, `${base}#peer-abc`, "abc"),
      ).toBe(false);
    }
  });
});
