import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  ExternalDriverProtocolError,
} from "../src/external-driver.ts";
import type { DriverRenewParams } from "../src/external-driver.ts";
import {
  ACQUIRE_REPLY,
  BINDING_WIRE,
  DISPATCH_ARGS,
  DISPATCH_REPLY,
  DRIVER_SESSION,
  FENCE,
  PROOF,
  capture,
  driverHarness,
  expectDecodeRejected,
} from "./fixtures/external-driver-wire.ts";

/**
 * The external-control surface (acquire, renew, release, dispatch) through
 * the REAL `createExternalDriverCommands` factory. Wire fields mirror Rust
 * `ui_protocol.rs`; proof is always an explicit synthetic caller argument,
 * never a real token. The release cases pin the FROZEN
 * `SessionDriverReleaseResult` shape (next=internal => binding ABSENT;
 * next=external => parked binding PRESENT with lease 0).
 */

const ACQUIRE_ARGS = {
  driverId: "driver-b",
  expectedRevision: 0,
  leaseSeconds: 300,
};

const RENEW_ARGS: DriverRenewParams = { ...FENCE, leaseSeconds: 300 };

const RELEASE_EXTERNAL_ARGS = {
  ...FENCE,
  expectedRevision: 16,
  next: "external",
} as const;

/** Parked external release: durable mode stays external, NO live lease. */
const RELEASE_EXTERNAL_REPLY = {
  mode: "external",
  binding: { ...BINDING_WIRE, lease_expires_at_ms: 0 },
  recovery: "none",
};

describe("driverAcquire is explicit and get-revision-based", () => {
  it("sends the captured scope, fence id, expected_revision and lease", async () => {
    const { calls, commands } = driverHarness(() =>
      // Plain JSON wire reply — the factory decodes it into the public result.
      structuredClone(ACQUIRE_REPLY),
    );
    const result = await commands.driverAcquire(ACQUIRE_ARGS);
    expect(calls).toEqual([
      {
        method: EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
        params: {
          session_id: DRIVER_SESSION,
          topic: "peer-abc",
          driver_id: "driver-b",
          expected_revision: 0,
          lease_seconds: 300,
        },
      },
    ]);
    // The raw WIRE reply carries a plain `control_token`; the PUBLIC decoded
    // result must expose it only through the opaque closure-backed capability.
    expect(result.capability.reveal()).toBe(PROOF);
    expect(result.capability.driverId).toBe("driver-b");
    expect(result.capability.epoch).toBe(8);
    expect(result.pendingWork).toEqual([]);
  });
});

describe("driverRelease enforces the FROZEN mode-specific shape", () => {
  it("accepts an external release: parked binding present with lease 0", async () => {
    const { calls, commands } = driverHarness(() =>
      structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    const result = await commands.driverRelease(RELEASE_EXTERNAL_ARGS);
    expect(calls[0]?.method).toBe(
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
    expect(calls[0]?.params).toMatchObject({
      session_id: DRIVER_SESSION,
      topic: "peer-abc",
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      expected_revision: 16,
      next: "external",
    });
    expect(result.mode).toBe("external");
    expect(result.binding?.leaseExpiresAtMs).toBe(0);
    // The release receipt never echoes the controller proof.
    expect(JSON.stringify(result)).not.toContain(PROOF);
  });

  it("rejects a FOREIGN next: requested internal but reply says external", async () => {
    const { calls, commands } = driverHarness(() =>
      structuredClone(RELEASE_EXTERNAL_REPLY),
    );
    await expectDecodeRejected(
      commands.driverRelease({ ...RELEASE_EXTERNAL_ARGS, next: "internal" }),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_RELEASE,
    );
  });
});

describe("peerDispatch carries an immutable receipt", () => {
  it("dispatch sends the fence, operation id, exact model and target", async () => {
    const { calls, commands } = driverHarness(() =>
      structuredClone(DISPATCH_REPLY),
    );
    const result = await commands.peerDispatch(DISPATCH_ARGS);
    expect(calls[0]?.method).toBe(EXTERNAL_DRIVER_METHODS.PEER_DISPATCH);
    expect(calls[0]?.params).toMatchObject({
      session_id: DRIVER_SESSION,
      topic: "peer-abc",
      driver_id: "driver-b",
      epoch: 8,
      control_token: PROOF,
      operation_id: "op-dispatch-1",
      model: "deepseek-chat",
      dispatch: { kind: "new_brief", brief: "do the thing" },
    });
    expect(result.state).toBe("accepted");
    expect(result.adoptedSessionId).toBe(DRIVER_SESSION);
    expect(result.slug).toBe("abc");
    // Native identity: the adopted session must be EXACTLY base + `#peer-<slug>`.
    expect(result.adoptedSessionId).toBe(`dev:local:tui#peer-${result.slug}`);
    expect(result.duplicate).toBe(false);
  });

  it("dispatch rejects an adopted session that contradicts its slug", async () => {
    const { calls, commands } = driverHarness(() =>
      structuredClone({
        ...DISPATCH_REPLY,
        adopted_session_id: "dev:local:tui#peer-other",
      }),
    );
    await expectDecodeRejected(
      commands.peerDispatch(DISPATCH_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
    );
  });
});

describe("no implicit acquisition, fallback or proof leakage", () => {
  it("driverGet stays read-only: it never acquires and carries no proof", async () => {
    const { calls, commands } = driverHarness();
    await commands.driverGet();
    expect(calls).toEqual([
      {
        method: EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_GET,
        params: { session_id: DRIVER_SESSION, topic: "peer-abc" },
      },
    ]);
  });

  it("refuses a control call with NO proof argument, offline (zero wire traffic)", async () => {
    const { calls, commands } = driverHarness(() => ({
      lease_expires_at_ms: 1_700_000_300_000,
    }));
    const { controlToken: _omit, ...noProof } = RENEW_ARGS;
    const error = await capture(
      commands.driverRenew(noProof as DriverRenewParams),
    );
    expect(error).toBeInstanceOf(ExternalDriverProtocolError);
    // Refused BEFORE any wire send: there is no ambient/global token store to
    // fall back to. Behaviour (offline refusal + zero RPC) is the proof — a
    // bare `globalThis.localStorage === undefined` proves nothing on its own.
    expect(calls).toEqual([]);
  });

  it("the acquire capability exposes no enumerable proof and errors never echo it", async () => {
    const { commands } = driverHarness(() => structuredClone(ACQUIRE_REPLY));
    const result = await commands.driverAcquire(ACQUIRE_ARGS);
    expect(JSON.stringify(result)).not.toContain(PROOF);
    expect(Object.keys(result.capability)).not.toContain("controlToken");
    expect(Object.values(result.capability)).not.toContain(PROOF);

    const { calls, commands: broken } = driverHarness(() =>
      structuredClone({ ...ACQUIRE_REPLY, control_token: 12345 }),
    );
    await expectDecodeRejected(
      broken.driverAcquire(ACQUIRE_ARGS),
      calls,
      EXTERNAL_DRIVER_METHODS.SESSION_DRIVER_ACQUIRE,
    );
  });
});
