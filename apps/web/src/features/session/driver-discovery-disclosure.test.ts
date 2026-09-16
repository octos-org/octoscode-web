import { describe, expect, it } from "vitest";
import {
  walkDriverInventoryChain,
  type DriverInventoryState,
} from "./driver-discovery.ts";
import type {
  ExternalDriverReadCommands,
  SessionDriverGetWithOperationsView,
} from "@octos-org/octoscode-client/external-driver";
/** RED regression for the actual 1803 defect: the walker validates mode/
 * recovery/binding via disclosureOf, yet the `complete` DriverInventoryState
 * drops them (state 37-51; return 236-242). These tests pin the additive
 * read-only disclosure contract; the missing fields fail today. Synthetic. */
type DisclosureBinding = Readonly<{
  driverId: string;
  epoch: number;
  revision: number;
  leaseExpiresAtMs: number;
}>;
type CompleteWithDisclosure = {
  kind: "complete";
  disclosure: Readonly<{
    mode: string;
    recovery: string;
    binding: DisclosureBinding | null;
  }>;
};
/** Wire binding: the four public fields the contract keeps, plus fields it MUST
 * NOT copy. acceptedWork is present only because disclosureOf spreads it. */
type RawBinding = {
  driverId: string;
  epoch: number;
  revision: number;
  leaseExpiresAtMs: number;
  acceptedWork: readonly string[];
  [extra: string]: unknown;
};
const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const row = (operationId: string, slug: string) => ({
  operationId,
  kind: "peer_dispatch" as const,
  acceptance: { slug, adoptedTurnId: TURN, workspaceRoot: "/ws" },
  lifecycle: "started",
  createdAtMs: 1,
});
function binding(over: Partial<RawBinding> = {}): RawBinding {
  return {
    driverId: "d1",
    epoch: 1,
    revision: 2,
    leaseExpiresAtMs: 0,
    acceptedWork: [],
    ...over,
  };
}
function page(
  items: ReturnType<typeof row>[],
  view: { mode?: string; recovery?: string; binding?: RawBinding | null } = {},
  over: Record<string, unknown> = {},
) {
  return {
    mode: view.mode ?? "external",
    binding: view.binding === undefined ? binding() : view.binding,
    recovery: view.recovery ?? "none",
    operations: {
      kind: "page" as const,
      page: Object.freeze({
        items: Object.freeze(items),
        snapshot: "snap-1",
        observedRevision: "7",
        complete: items.length === 0,
        nextCursor: null,
        ...over,
      }),
    },
  };
}
const asView = (p: unknown): SessionDriverGetWithOperationsView =>
  p as unknown as SessionDriverGetWithOperationsView;
/** Cloning command (chain tests): each page is copied per call. */
function commands(pages: unknown[]): ExternalDriverReadCommands {
  let i = 0;
  const driverGet = async () => {
    const next = pages[i];
    i += 1;
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("no more pages");
    return structuredClone(
      next,
    ) as unknown as SessionDriverGetWithOperationsView;
  };
  return { driverGet, nextExpectedRevision: () => 0 };
}
/** Retaining command: returns the EXACT synthetic view, uncloned, so identity
 * and mutation-isolation of the returned disclosure are assertable. */
function retainingCommands(
  view: SessionDriverGetWithOperationsView,
): ExternalDriverReadCommands {
  let served = false;
  const driverGet = async () => {
    if (served) throw new Error("single page only");
    served = true;
    return view;
  };
  return { driverGet, nextExpectedRevision: () => 0 };
}
const walk = (...pages: unknown[]): Promise<DriverInventoryState> =>
  walkDriverInventoryChain(commands(pages));
const asComplete = (state: unknown): CompleteWithDisclosure =>
  state as unknown as CompleteWithDisclosure;

describe("driver disclosure regression (1803)", () => {
  it("retains EXACT mode/recovery/public binding on a complete external chain", async () => {
    const state = await walk(
      page(
        [row("op-1", "a")],
        {
          binding: binding({
            epoch: 3,
            revision: 9,
            leaseExpiresAtMs: 1_700_000_000_000,
          }),
        },
        { complete: true, nextCursor: null },
      ),
    );
    // Fixture sanity FIRST: prove the success branch was reached, so the
    // disclosure assertion cannot be masked by a malformed page.
    expect(state.kind).toBe("complete");
    expect(asComplete(state).disclosure).toEqual({
      mode: "external",
      recovery: "none",
      binding: {
        driverId: "d1",
        epoch: 3,
        revision: 9,
        leaseExpiresAtMs: 1_700_000_000_000,
      },
    });
  });

  it("distinguishes internal, nonzero-lease external and parked external truthfully", async () => {
    const internal = await walk(
      page(
        [],
        { mode: "internal", binding: null },
        { complete: true, nextCursor: null },
      ),
    );
    expect(internal.kind).toBe("complete"); // assert BEFORE any cast/access
    const i = asComplete(internal);
    // mode is AUTHORITATIVE; the null binding is the never-bound internal
    // shape (decoder: internal + non-null binding is rejected). lease is NOT
    // used to infer the mode.
    expect(i.disclosure.mode).toBe("internal");
    expect(i.disclosure.binding).toBeNull();

    // A NONZERO lease is a historical fixture value — not claimed live now,
    // only that a nonzero lease is retained verbatim.
    const nonzeroLease = await walk(
      page(
        [],
        { binding: binding({ leaseExpiresAtMs: 1_700_000_000_000 }) },
        { complete: true, nextCursor: null },
      ),
    );
    expect(nonzeroLease.kind).toBe("complete");
    const n = asComplete(nonzeroLease);
    expect(n.disclosure.mode).toBe("external");
    expect(n.disclosure.binding?.leaseExpiresAtMs).toBe(1_700_000_000_000);

    const parked = await walk(
      page(
        [],
        { binding: binding({ leaseExpiresAtMs: 0 }) },
        { complete: true, nextCursor: null },
      ),
    );
    expect(parked.kind).toBe("complete");
    const p = asComplete(parked);
    // Parked/expired EXTERNAL stays External, distinct from internal/null.
    expect(p.disclosure.mode).toBe("external");
    expect(p.disclosure.binding?.leaseExpiresAtMs).toBe(0);
  });

  it("retains interrupted and recovery_required recovery (none alone cannot prove it)", async () => {
    for (const recovery of ["interrupted", "recovery_required"] as const) {
      const state = await walk(
        page(
          [row("op-1", "a")],
          { recovery },
          { complete: true, nextCursor: null },
        ),
      );
      expect(state.kind).toBe("complete");
      expect(asComplete(state).disclosure).toEqual({
        mode: "external",
        recovery,
        binding: { driverId: "d1", epoch: 1, revision: 2, leaseExpiresAtMs: 0 },
      });
    }
  });

  it("copies only the whitelist, freezes it, and is not a raw alias (mutation-isolated)", async () => {
    const raw = binding({
      workspaceRoot: "/private/ws-SECRET",
      acceptedWork: ["SECRET-WORK"],
      controlToken: "SECRET-TOKEN",
      proof: "SECRET-PROOF",
      prompt: "SECRET-PROMPT",
      rpc: { secret: "SECRET-RPC" },
    });
    const view = asView(
      page(
        [row("op-1", "a")],
        { binding: raw },
        { complete: true, nextCursor: null },
      ),
    );
    const state = await walkDriverInventoryChain(retainingCommands(view));
    expect(state.kind).toBe("complete");
    const complete = asComplete(state);
    // Exact whitelist FIRST: the primary RED (disclosure absent today).
    expect(complete.disclosure).toEqual({
      mode: "external",
      recovery: "none",
      binding: { driverId: "d1", epoch: 1, revision: 2, leaseExpiresAtMs: 0 },
    });
    // Copy, not a raw alias of the retained view/binding.
    expect(complete.disclosure).not.toBe(view);
    expect(complete.disclosure.binding).not.toBe(view.binding);
    // No token/proof/raw map/workspace/accepted-work leaks into the encoding.
    const encoded = JSON.stringify(complete.disclosure ?? null);
    for (const forbidden of [
      "SECRET",
      "controlToken",
      "proof",
      "rpc",
      "workspaceRoot",
      "acceptedWork",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    // Deep-frozen returned disclosure.
    expect(Object.isFrozen(complete.disclosure)).toBe(true);
    expect(Object.isFrozen(complete.disclosure.binding)).toBe(true);
    // Mutating the SOURCE view AFTER the await must not change the output.
    // Synthetic fixture only; no real retained state is touched.
    const mutable = raw as {
      driverId: string;
      epoch: number;
      leaseExpiresAtMs: number;
    };
    mutable.driverId = "MUTATED";
    mutable.epoch = 42;
    mutable.leaseExpiresAtMs = 999;
    expect(complete.disclosure.binding).toEqual({
      driverId: "d1",
      epoch: 1,
      revision: 2,
      leaseExpiresAtMs: 0,
    });
  });

  it("keeps cross-page inconsistent mode/binding an error, never a partial complete", async () => {
    const state = await walk(
      page(
        [row("op-1", "a")],
        { mode: "external" },
        { complete: false, nextCursor: "c-1" },
      ),
      page(
        [],
        { mode: "internal", binding: null },
        { complete: true, nextCursor: null },
      ),
    );
    expect(state).toEqual({ kind: "error", reason: "unknown" });
    expect(state).not.toHaveProperty("disclosure");
  });

  it("keeps a binding-header change mid-chain an error, not a last-page win", async () => {
    const state = await walk(
      page(
        [row("op-1", "a")],
        { binding: binding({ driverId: "d1" }) },
        { complete: false, nextCursor: "c-1" },
      ),
      page(
        [],
        { binding: binding({ driverId: "d2", epoch: 2, revision: 9 }) },
        { complete: true, nextCursor: null },
      ),
    );
    expect(state).toEqual({ kind: "error", reason: "unknown" });
  });

  it("keeps a recovery-only mismatch mid-chain an error", async () => {
    const state = await walk(
      page(
        [row("op-1", "a")],
        { recovery: "none" },
        { complete: false, nextCursor: "c-1" },
      ),
      page(
        [],
        { recovery: "interrupted" },
        { complete: true, nextCursor: null },
      ),
    );
    expect(state).toEqual({ kind: "error", reason: "unknown" });
  });
});
