import { describe, expect, it } from "vitest";
import type { ContextSnapshot } from "@octos-org/octoscode-client/protocol";
import {
  pickContext,
  rememberContext,
  REMEMBERED_SESSIONS,
  type SessionContextFacts,
} from "./live-context.ts";

const at = (sessionId: string, generation: number, tokens: number) =>
  ({
    state: {
      session_id: sessionId,
      generation,
      token_estimate: tokens,
      item_count: 1,
      recovery_state: "exact",
    },
  }) as ContextSnapshot;

describe("pickContext", () => {
  it("prefers what the server said last for this session", () => {
    const opened = at("s1", 3, 1_000);
    const reported = {
      ...at("s1", 3, 9_400),
      reported: { thresholdTokens: 140_000 },
    };
    expect(pickContext(opened, null, "s1")).toBe(opened);
    expect(pickContext(opened, reported, "s1")).toBe(reported);
    expect(pickContext(null, reported, "s1")).toBe(reported);
    // A newer read after a compaction outranks an older report.
    const compactedRead = at("s1", 4, 400);
    expect(pickContext(compactedRead, reported, "s1")).toBe(compactedRead);
  });

  it("never shows another session's context", () => {
    expect(pickContext(at("s2", 9, 5), at("s2", 9, 5), "s1")).toBeNull();
    expect(pickContext(at("s1", 1, 5), null, null)).toBeNull();
    expect(
      pickContext(at("s1", 1, 5), at("s2", 9, 7), "s1")?.state.token_estimate,
    ).toBe(5);
  });
});

const report = (sessionId: string, generation: number, tokens: number) => ({
  jsonrpc: "2.0" as const,
  method: "context/state_reported",
  params: {
    session_id: sessionId,
    context_state: at(sessionId, generation, tokens).state,
    threshold_tokens: 89_600,
    iteration: 0,
  },
});
const cost = (sessionId: string, contextWindow?: number) => ({
  jsonrpc: "2.0" as const,
  method: "progress/updated",
  params: {
    session_id: sessionId,
    turn_id: "t1",
    metadata: {
      kind: "token_cost_update",
      token_cost: {
        input_tokens: 10,
        output_tokens: 2,
        context_window: contextWindow,
      },
    },
  },
});

describe("rememberContext", () => {
  it("keeps each session's latest report and window across a switch", () => {
    let known: ReadonlyMap<string, SessionContextFacts> = new Map();
    known = rememberContext(known, report("a", 1, 8_663));
    known = rememberContext(known, cost("a", 128_000));
    // B opens and replies; A's facts stay as they were.
    known = rememberContext(known, report("b", 1, 2_100));
    known = rememberContext(known, cost("b", 64_000));
    expect(known.get("a")?.window).toBe(128_000);
    expect(known.get("b")?.window).toBe(64_000);
    // Back in A, the reopen reads the transcript at the same generation: the
    // later report still wins, and B's numbers never show.
    const reopened = at("a", 1, 1);
    const a = pickContext(reopened, known.get("a")!.context, "a");
    expect(a?.state.token_estimate).toBe(8_663);
    expect(a?.reported).toEqual({ thresholdTokens: 89_600 });
    // A compaction elsewhere moves the generation on; the newer read wins.
    expect(
      pickContext(at("a", 2, 400), known.get("a")!.context, "a")?.state
        .token_estimate,
    ).toBe(400);
  });

  it("ignores events that say nothing new", () => {
    const known = rememberContext(new Map(), report("a", 1, 8_663));
    expect(
      rememberContext(known, {
        jsonrpc: "2.0",
        method: "turn/started",
        params: { session_id: "a" },
      }),
    ).toBe(known);
    // A usage report without a window keeps the window already known.
    const withWindow = rememberContext(known, cost("a", 128_000));
    expect(rememberContext(withWindow, cost("a"))).toBe(withWindow);
    // A stale report (older generation) changes nothing.
    const newer = rememberContext(known, report("a", 3, 9_000));
    expect(rememberContext(newer, report("a", 2, 50))).toBe(newer);
  });

  it("forgets the least recently reported session first", () => {
    let known: ReadonlyMap<string, SessionContextFacts> = new Map();
    for (let index = 0; index <= REMEMBERED_SESSIONS; index += 1)
      known = rememberContext(known, report(`s${index}`, 1, index + 1));
    expect(known.size).toBe(REMEMBERED_SESSIONS);
    expect(known.has("s0")).toBe(false);
    expect(
      known.get(`s${REMEMBERED_SESSIONS}`)?.context?.state.token_estimate,
    ).toBe(REMEMBERED_SESSIONS + 1);
  });
});
