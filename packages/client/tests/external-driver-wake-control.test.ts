import { describe, expect, it } from "vitest";
import { ExternalDriverProtocolError } from "../src/external-driver.ts";
import { parseExternalDriverWakeClaimResult } from "../src/external-driver-wake-control.ts";

/**
 * Focused regressions for the WAKE claim decoder. Imports the ACTUAL leaf
 * parser (the module already exists) — never a future/missing export. Wire
 * fields mirror ui_protocol.rs `WakeOccurrenceView` (~8208) and
 * `SessionWakeClaimResult` (~8287); JSON `null` means ABSENT for both
 * `Option` fields (transport ~19445).
 */

function occurrence(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sequence: 1,
    reason_kind: "child_complete",
    dedupe_key: "dedupe-1",
    payload_digest: "sha256:beef",
    created_at_ms: 1_700_000_000_000,
    ...overrides,
  };
}

function reply(occurrences: unknown): Record<string, unknown> {
  return {
    occurrences,
    claim_token: "claim-synthetic-fixture",
    next_cursor: "cursor-2",
    lease_expires_at_ms: 1_700_000_060_000,
  };
}

describe("wake claim occurrence decidable-content rule", () => {
  // One guard: payload XOR continuation_ref (JSON null = absent, matching the
  // Core's Option wire semantics). Before touching, re-check ui_protocol.rs
  // `WakeOccurrenceView` — an occurrence Core cannot classify as either inline
  // or referenced must be a client-side refuse, never a guess.
  it("accepts exactly one of payload / continuation_ref (absent or null)", () => {
    const inline = parseExternalDriverWakeClaimResult(
      reply([occurrence({ payload: { goal_id: "g1" } })]),
    );
    expect(inline.occurrences[0]?.payload).toEqual({ goal_id: "g1" });
    expect(inline.occurrences[0]?.continuationRef).toBeUndefined();
    const inlineNull = parseExternalDriverWakeClaimResult(
      reply([
        occurrence({ payload: { goal_id: "g1" }, continuation_ref: null }),
      ]),
    );
    expect(inlineNull.occurrences[0]?.payload).toEqual({ goal_id: "g1" });
    const referenced = parseExternalDriverWakeClaimResult(
      reply([occurrence({ continuation_ref: "ref-1" })]),
    );
    expect(referenced.occurrences[0]?.continuationRef).toBe("ref-1");
    expect(referenced.occurrences[0]?.payload).toBeUndefined();
    const referencedNull = parseExternalDriverWakeClaimResult(
      reply([occurrence({ payload: null, continuation_ref: "ref-1" })]),
    );
    expect(referencedNull.occurrences[0]?.continuationRef).toBe("ref-1");
  });
});

describe("wake claim occurrence refuses non-decidable content", () => {
  it("refuses ambiguous, empty, or unserializable content with a bounded typed failure", () => {
    const cyclic: Record<string, unknown> = { goal_id: "g1" };
    cyclic.self = cyclic;
    const badOccurrences = [
      occurrence({ payload: { goal_id: "g1" }, continuation_ref: "ref-1" }),
      occurrence({}),
      occurrence({ payload: null }),
      occurrence({ continuation_ref: "" }),
      occurrence({ payload: cyclic }),
    ];
    for (const bad of badOccurrences) {
      let error: unknown;
      try {
        parseExternalDriverWakeClaimResult(reply([bad]));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ExternalDriverProtocolError);
      // Bounded: never a raw DataCloneError / cyclic-structure leak.
      expect((error as Error).message).not.toContain("DataClone");
      expect((error as Error).message).not.toContain("circular");
    }
  });
});

describe("wake claim payload is cloned, deep-frozen and detached", () => {
  it("freezes a CLONE and leaves the caller's raw payload unfrozen", () => {
    const raw = { goal_id: "g1", nested: { step: 1 } };
    const view = parseExternalDriverWakeClaimResult(
      reply([occurrence({ payload: raw })]),
    );
    const decoded = view.occurrences[0]?.payload as {
      goal_id: string;
      nested: { step: number };
    };
    // Same content, different identity — a clone, not the caller's object.
    expect(decoded).toEqual(raw);
    expect(decoded).not.toBe(raw);
    expect(decoded.nested).not.toBe(raw.nested);
    // The decoded value is recursively frozen...
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.nested)).toBe(true);
    // ...but the caller's raw payload graph is left untouched.
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(raw.nested)).toBe(false);
  });

  it('preserves an own JSON "__proto__" key without prototype pollution', () => {
    // JSON.parse creates a real OWN "__proto__" data property.
    const raw = JSON.parse(
      '{"__proto__":{"polluted":true},"goal_id":"g1","nested":{"step":1}}',
    ) as Record<string, unknown>;
    const view = parseExternalDriverWakeClaimResult(
      reply([occurrence({ payload: raw })]),
    );
    const decoded = view.occurrences[0]?.payload as Record<string, unknown>;
    // The own key survives as an own data property, content intact.
    expect(Object.prototype.hasOwnProperty.call(decoded, "__proto__")).toBe(
      true,
    );
    expect(decoded.goal_id).toBe("g1");
    expect((decoded["__proto__"] as { polluted: boolean }).polluted).toBe(true);
    // No prototype pollution of the clone or of Object.prototype.
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect((decoded as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    // Detached, recursively frozen output...
    expect(decoded).not.toBe(raw);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(
      Object.isFrozen(decoded["__proto__"] as Record<string, unknown>),
    ).toBe(true);
    expect(Object.isFrozen(decoded.nested as Record<string, unknown>)).toBe(
      true,
    );
    // ...with the caller's raw graph left untouched and unpolluted.
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
    expect((raw["__proto__"] as { polluted: boolean }).polluted).toBe(true);
  });
});
