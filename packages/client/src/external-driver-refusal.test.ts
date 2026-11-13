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
import { OctosUiClient, OctosUiProtocolError } from "./client.ts";
import {
  capture,
  driverCaps as caps,
} from "../tests/fixtures/external-driver-wire.ts";
import { createSocket } from "../tests/fixtures/socket-client.ts";

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

describe("gap 1 — requestExternalDriverControl typed-refusal narrowing", () => {
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

describe("gap 3 — capability gate is offline and exact", () => {
  it("throws for an unadvertised method and sends ZERO frames", () => {
    const { context, request } = controlContext({
      methods: Object.values(EXTERNAL_DRIVER_METHODS).filter(
        (method) => method !== GET,
      ),
      featureAdvertised: true,
    });
    expect(() => requireExternalDriverControlCapability(context, GET)).toThrow(
      ExternalDriverCapabilityError,
    );
    expect(() => requireExternalDriverControlCapability(context, GET)).toThrow(
      `${GET} failed: capability not advertised`,
    );
    expect(request).not.toHaveBeenCalled();
  });
});

describe("gap 2 — close mid-flight through the real client transport", () => {
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
});
