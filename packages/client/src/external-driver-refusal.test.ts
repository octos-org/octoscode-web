import { describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_REFUSAL_KINDS,
  EXTERNAL_DRIVER_V1_FEATURE,
  ExternalDriverCapabilityError,
  ExternalDriverProtocolError,
  ExternalDriverRefusalError,
  requestExternalDriverControl,
  requireExternalDriverControlCapability,
} from "./external-driver.ts";
import type { ExternalDriverControlContext } from "./external-driver.ts";
import { createExternalDriverPeerCommands } from "./external-driver-peer-control.ts";
import { OctosUiClient, OctosUiProtocolError } from "./client.ts";
import type { UiProtocolCapabilities } from "./types.ts";

/**
 * 2203 unit coverage for the three 2047-disclosed client gaps, exercised
 * directly against the REAL exported symbols:
 *  - gap 1: `requestExternalDriverControl` typed-refusal narrowing;
 *  - gap 3: `requireExternalDriverControlCapability` /
 *    `requestExternalDriverControl` capability gate with zero wire traffic;
 *  - gap 2: the real `OctosUiClient` transport seam for close-mid-flight
 *    staleness (pending rejection on socket close, late-response quarantine).
 * Gap 2 has no `external-driver.ts`-local seam — it is a transport property of
 * the real client — so it is asserted through `OctosUiClient` with a fake
 * socket, the same convention as `tests/client.test.ts`. No sleeps, no
 * timeout-as-success, no test-only product export.
 */

const GET = EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET;
const MASTER = "dev:local:tui#peer-abc";
const PROFILE = "dev";
const TOPIC = "peer-abc";
const CANARY = "CANARY-2203-raw-server-detail";

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

type DriverRequest = (method: string, params: unknown) => Promise<unknown>;

/** Real factory-private control context (the exact shape the leaf modules
 * consume), built with an injected fake transport. */
function controlContext(
  overrides: {
    methods?: readonly string[];
    featureAdvertised?: boolean;
    respond?: DriverRequest;
  } = {},
) {
  const respond: DriverRequest =
    overrides.respond ?? (() => Promise.resolve(undefined));
  const request = vi.fn(respond);
  const context: ExternalDriverControlContext = {
    rpc: { request: (method, params) => request(method, params) },
    sessionId: MASTER,
    profileId: PROFILE,
    topic: TOPIC,
    supportedMethods: new Set<string>(
      overrides.methods ?? Object.values(EXTERNAL_DRIVER_METHODS),
    ),
    featureAdvertised: overrides.featureAdvertised ?? true,
  };
  return { context, request };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("gap 1 — requestExternalDriverControl typed-refusal narrowing", () => {
  it.each([...EXTERNAL_DRIVER_REFUSAL_KINDS])(
    "narrows allowlisted kind %s to ExternalDriverRefusalError",
    async (kind) => {
      const { context, request } = controlContext({
        respond: async () => {
          throw new OctosUiProtocolError(32001, `server detail ${CANARY}`, {
            kind,
          });
        },
      });
      const error = await capture(
        requestExternalDriverControl(context, GET, { session_id: MASTER }),
      );
      expect(error).toBeInstanceOf(ExternalDriverRefusalError);
      expect((error as ExternalDriverRefusalError).refusalKind).toBe(kind);
      expect((error as Error).name).toBe("ExternalDriverRefusalError");
      expect((error as Error).message).toBe(
        `${GET} failed: server refused: ${kind}`,
      );
      expect((error as Error).message).not.toContain(CANARY);
      expect((error as { data?: unknown }).data).toBeUndefined();
      expect((error as { cause?: unknown }).cause).toBeUndefined();
      // Params are forwarded untouched; exactly one frame leaves.
      expect(request).toHaveBeenCalledExactlyOnceWith(GET, {
        session_id: MASTER,
      });
    },
  );

  it("keeps a NON-allowlisted kind on a real protocol error as the scrubbed failure", async () => {
    const { context, request } = controlContext({
      respond: async () => {
        throw new OctosUiProtocolError(32002, `future ${CANARY}`, {
          kind: "some_future_kind",
        });
      },
    });
    const error = await capture(
      requestExternalDriverControl(context, GET, { session_id: MASTER }),
    );
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as Error).message).toBe(`${GET} failed: rpc rejected`);
    expect((error as Error).message).not.toContain("some_future_kind");
    expect((error as Error).message).not.toContain(CANARY);
    expect((error as { data?: unknown }).data).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "no data at all",
      serverError: new OctosUiProtocolError(32003, `plain ${CANARY}`),
    },
    {
      label: "a data record without kind",
      serverError: new OctosUiProtocolError(32004, `empty ${CANARY}`, {}),
    },
    {
      label: "a null data payload",
      serverError: new OctosUiProtocolError(32005, `null ${CANARY}`, null),
    },
    {
      label: "a non-string kind",
      serverError: new OctosUiProtocolError(32006, `bad ${CANARY}`, {
        kind: 42,
      }),
    },
  ])(
    "keeps a refusal with $label as the scrubbed generic failure",
    async ({ serverError }) => {
      const { context, request } = controlContext({
        respond: async () => {
          throw serverError;
        },
      });
      const error = await capture(
        requestExternalDriverControl(context, GET, { session_id: MASTER }),
      );
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
      expect((error as Error).message).toBe(`${GET} failed: rpc rejected`);
      expect((error as Error).message).not.toContain(CANARY);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a duck-typed lookalike that fails the identity check", async () => {
    const lookalike = new Error(`fake ${CANARY}`);
    Object.assign(lookalike, {
      name: "OctosUiProtocolError",
      code: 32007,
      data: { kind: EXTERNAL_DRIVER_REFUSAL_KINDS[0] },
    });
    const { context } = controlContext({
      respond: async () => {
        throw lookalike;
      },
    });
    const error = await capture(
      requestExternalDriverControl(context, GET, { session_id: MASTER }),
    );
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    expect(error).not.toBeInstanceOf(ExternalDriverRefusalError);
    expect((error as Error).message).not.toContain(CANARY);
    expect((error as Error).message).not.toContain(
      EXTERNAL_DRIVER_REFUSAL_KINDS[0],
    );
  });
});

/**
 * gap 4 — the CONFIRMED wire `data.kind` set for a REJECTED peer/control or
 * peer/dispatch, read from Core source (octos-cli):
 *  - ui_protocol_transport.rs:19218-19236 `driver_store_error_to_rpc` maps
 *    DriverDomainError → `driver_scope_mismatch` (ScopeDenied/UnknownDriver),
 *    `driver_fence_stale` (StaleEpoch/LeaseExpired/BadProof),
 *    `driver_revision_conflict` (StaleRevision), `driver_busy_handover`
 *    (BusyHandover), `driver_operation_conflict` (ConflictingOperation),
 *    `interaction_recovery_required` (RecoveryRequired). This is the exact
 *    mapper `preparation_failure_to_rpc` → `PreparationFailure::Store` uses
 *    for peer/dispatch (ui_protocol_external_driver_backend.rs:974) and the
 *    interaction/control accept path.
 *  - peers/mod.rs:3451 `validate_external_staging_identity` emits
 *    `driver_model_unavailable` with `requested_lane`.
 *  - InvalidClaim/InvalidCursor map to `wake_claim_invalid`/`wake_cursor_reset`
 *    — those are WAKE-method kinds, NOT reachable on control/dispatch, so they
 *    are deliberately NOT in this set.
 * `driver_operations_cursor_reset`/`driver_operations_view_too_large` are the
 * discovery-only kinds already allowlisted.
 */
const CONFIRMED_CONTROL_REFUSAL_KINDS = [
  "driver_scope_mismatch",
  "driver_fence_stale",
  "driver_revision_conflict",
  "driver_busy_handover",
  "driver_operation_conflict",
  "interaction_recovery_required",
  "driver_model_unavailable",
] as const;

describe("gap 4 — confirmed control/dispatch refusal kinds narrow", () => {
  it.each(CONFIRMED_CONTROL_REFUSAL_KINDS)(
    "narrows confirmed kind %s to ExternalDriverRefusalError",
    async (kind) => {
      const { context } = controlContext({
        respond: async () => {
          throw new OctosUiProtocolError(32001, `server detail ${CANARY}`, {
            kind,
          });
        },
      });
      const error = await capture(
        requestExternalDriverControl(
          context,
          EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
          { session_id: MASTER },
        ),
      );
      expect(error).toBeInstanceOf(ExternalDriverRefusalError);
      expect((error as ExternalDriverRefusalError).refusalKind).toBe(kind);
      expect((error as Error).message).not.toContain(CANARY);
    },
  );
});

describe("gap 5 — peer/control positive capability + leaf method pin", () => {
  it("advertised peer/control + feature does NOT throw (positive case)", () => {
    const { context, request } = controlContext({
      methods: [EXTERNAL_DRIVER_METHODS.PEER_CONTROL],
      featureAdvertised: true,
    });
    expect(() =>
      requireExternalDriverControlCapability(
        context,
        EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
      ),
    ).not.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("leaf peerControl sends EXACTLY EXTERNAL_DRIVER_METHODS.PEER_CONTROL", async () => {
    const { context, request } = controlContext({
      respond: async () => undefined,
    });
    const commands = createExternalDriverPeerCommands(context);
    const error = await capture(
      commands.peerControl({
        driverId: "drv-1",
        epoch: 1,
        controlToken: "tok-1",
        operationId: "ctl-op-1",
        targetOperationId: "dispatch-op-1",
        expectedTurnId: "00000000-0000-0000-0000-000000000000",
        command: { kind: "interrupt" },
      }),
    );
    expect(request).toHaveBeenCalledExactlyOnceWith(
      EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
      expect.anything(),
    );
    // The pinned literal must equal the constant exported from
    // external-driver.ts (the private leaf const is asserted through the wire).
    expect(EXTERNAL_DRIVER_METHODS.PEER_CONTROL).toBe("peer/control");
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
  });
});

describe("gap 3 — capability gate is offline and exact", () => {
  it("throws for an unadvertised method and sends ZERO frames", () => {
    const { context, request } = controlContext({
      methods: Object.values(EXTERNAL_DRIVER_METHODS).filter(
        (method) => method !== GET,
      ),
      featureAdvertised: true,
    });
    expect(() =>
      requireExternalDriverControlCapability(context, GET),
    ).toThrow(ExternalDriverCapabilityError);
    expect(() =>
      requireExternalDriverControlCapability(context, GET),
    ).toThrow(`${GET} failed: capability not advertised`);
    expect(request).not.toHaveBeenCalled();
  });

  it("throws for an advertised method when the feature is absent", () => {
    const { context, request } = controlContext({
      methods: [GET],
      featureAdvertised: false,
    });
    expect(() =>
      requireExternalDriverControlCapability(context, GET),
    ).toThrow(ExternalDriverCapabilityError);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps both absence modes offline through requestExternalDriverControl", async () => {
    for (const config of [
      {
        methods: Object.values(EXTERNAL_DRIVER_METHODS).filter(
          (method) => method !== GET,
        ),
        featureAdvertised: true,
      },
      { methods: [GET], featureAdvertised: false },
    ]) {
      const { context, request } = controlContext(config);
      const error = await capture(
        requestExternalDriverControl(context, GET, { session_id: MASTER }),
      );
      expect(error).toBeInstanceOf(ExternalDriverCapabilityError);
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      expect((error as Error).message).toBe(
        `${GET} failed: capability not advertised (method + external_driver_v1)`,
      );
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("is not a broken harness: both advertised lets exactly one frame through", async () => {
    const { context, request } = controlContext({
      methods: [GET],
      featureAdvertised: true,
      respond: async () => ({ ok: true }),
    });
    expect(() =>
      requireExternalDriverControlCapability(context, GET),
    ).not.toThrow();
    const reply = await requestExternalDriverControl(context, GET, {
      session_id: MASTER,
    });
    expect(reply).toEqual({ ok: true });
    expect(request).toHaveBeenCalledExactlyOnceWith(GET, {
      session_id: MASTER,
    });
  });
});

describe("gap 2 — close mid-flight through the real client transport", () => {
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

  const DRIVER_CAPS = caps([GET], [EXTERNAL_DRIVER_V1_FEATURE]);

  const HEALTHY_DRIVER_RESULT = {
    mode: "external",
    binding: {
      driver_id: "driver-b",
      epoch: 8,
      revision: 15,
      lease_expires_at_ms: 1_770_000_000_000,
    },
    recovery: "none",
  };

  async function connectedClient() {
    const socket = createSocket();
    const client = new OctosUiClient({
      endpoint: "http://127.0.0.1:50080",
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const errors: Error[] = [];
    client.subscribeErrors((error) => errors.push(error));
    const connecting = client.connect();
    socket.readyState = 1;
    socket.onopen?.({} as Event);
    await connecting;
    return { socket, client, errors };
  }

  it("rejects an in-flight driver read on socket close and ignores the late reply", async () => {
    const { socket, client, errors } = await connectedClient();
    const commands = await client.externalDriverCommands(
      MASTER,
      PROFILE,
      DRIVER_CAPS,
      TOPIC,
    );
    const pending = commands.driverGet();
    const frame = JSON.parse(String(socket.send.mock.calls[0]?.[0])) as {
      id: string;
      method: string;
    };
    expect(frame.method).toBe(GET);
    expect(socket.send).toHaveBeenCalledTimes(1);

    const rejection = expect(pending).rejects.toBeInstanceOf(
      ExternalDriverProtocolError,
    );
    socket.onclose?.({} as CloseEvent);
    await rejection;
    expect(client.status).toBe("disconnected");

    // A response for the closed generation is quarantined, never surfaced
    // as a success and never reported as an unknown request.
    socket.onmessage?.({
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: frame.id,
        result: HEALTHY_DRIVER_RESULT,
      }),
    } as MessageEvent);
    expect(errors).toEqual([]);
  });

  it("rejects raw pending work with the connection-closed reason", async () => {
    const { socket, client } = await connectedClient();
    const pending = client.startTurn({
      session_id: "s1",
      turn_id: "t1",
      input: [],
    });
    expect(socket.send).toHaveBeenCalledTimes(1);
    const rejection = expect(pending).rejects.toThrow("connection closed");
    socket.onclose?.({} as CloseEvent);
    await rejection;
  });
});