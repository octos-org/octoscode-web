import { describe, expect, it } from "vitest";
import {
  DRIVER_DISCOVERY_LIMITS,
  walkDriverInventoryChain,
} from "./driver-discovery.ts";
import { type ExternalDriverReadCommands } from "@octos-org/octoscode-client/external-driver";

const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const BASE = "dev:local:tui";

function row(operationId: string, slug: string) {
  return {
    operationId,
    kind: "peer_dispatch" as const,
    acceptance: {
      model: "glm-5.3",
      modelLane: "external-master",
      workspaceRoot: "/ws",
      scopedGoal: null as { goalId: string; taskId?: string } | null,
      adoptedTurnId: TURN,
      adoptedSessionId: `${BASE}#peer-${slug}`,
      slug,
      acceptedAtMs: 1,
      payloadDigest: "d".repeat(64),
    },
    lifecycle: "started",
    createdAtMs: 1,
  };
}

function page(
  rows: ReturnType<typeof row>[],
  over: Record<string, unknown> = {},
) {
  return {
    mode: "external",
    binding: {
      driverId: "d1",
      epoch: 1,
      revision: 2,
      leaseExpiresAtMs: 0,
      acceptedWork: [],
    },
    recovery: "none",
    operations: {
      kind: "page" as const,
      page: Object.freeze({
        items: Object.freeze(rows),
        snapshot: "snap-1",
        observedRevision: "7",
        complete: rows.length === 0,
        nextCursor: null,
        ...over,
      }),
    },
  };
}

function commands(
  pages: unknown[],
  log: string[] = [],
): ExternalDriverReadCommands {
  let i = 0;
  const driverGet = async (options: { operations?: unknown } = {}) => {
    log.push(JSON.stringify(options.operations));
    const next = pages[i];
    i += 1;
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error("no more pages");
    return structuredClone(
      next,
    ) as import("@octos-org/octoscode-client/external-driver").SessionDriverGetWithOperationsView;
  };
  return { driverGet, nextExpectedRevision: () => 0 };
}

describe("walkDriverInventoryChain", () => {
  it("rejects cursor loops and page/row/time budgets without truncation", async () => {
    const loopState = await walkDriverInventoryChain(
      commands([
        page([], { complete: false, nextCursor: "c-1" }),
        page([], { complete: false, nextCursor: "c-2" }),
        page([], { complete: false, nextCursor: "c-1" }),
      ]),
    );
    expect(loopState).toEqual({ kind: "error", reason: "unknown" });

    const endless: unknown[] = [];
    for (let i = 0; i < DRIVER_DISCOVERY_LIMITS.maxPages + 2; i += 1) {
      endless.push(page([], { complete: false, nextCursor: `c-${i}` }));
    }
    const budget = await walkDriverInventoryChain(commands(endless));
    expect(budget).toEqual({ kind: "error", reason: "unknown" });

    let t = 0;
    const slow = () => {
      t += 10_000;
      return t;
    };
    const timed = await walkDriverInventoryChain(commands(endless), slow);
    expect(timed).toEqual({ kind: "error", reason: "unknown" });
  });
});
