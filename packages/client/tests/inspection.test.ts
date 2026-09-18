import { describe, expect, it, vi } from "vitest";
import {
  createInspectionCommands,
  parseInspectionThreadGraph,
  parseInspectionTurnState,
  parseInspectionApprovalScopes,
} from "../src/inspection.ts";
import {
  CORE_UI_FEATURES as F,
  CORE_UI_METHODS as M,
} from "../src/generated/core-contract.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";
const session = "coding:local:ordinary";
const turn = "00000000-0000-4000-8000-000000000011";
function caps(): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: [M.THREAD_GRAPH_GET, M.TURN_STATE_GET],
    supported_features: [F.THREAD_GRAPH_V1, F.TURN_STATE_GET_V1],
    supported_notifications: [],
  };
}
const graph = () => ({
  session_id: session,
  cursor: { stream: session, seq: 10 },
  threads: [
    {
      thread_id: "thread-1",
      root_seq: 0,
      root_client_message_id: "message-1",
      message_seqs: [0, 2],
      status: "unknown",
    },
  ],
  orphans: [1],
});
const state = () => ({ session_id: session, turn_id: turn, state: "unknown" });
const context = () => ({
  session_id: session,
  generation: 0,
  transcript_hash: "hash",
  token_estimate: 0,
  item_count: 0,
  recovery_state: "ready",
});

describe("native inspection contracts", () => {
  it("reads remembered approvals with a method-only grant and exact scoped rows", async () => {
    const value = {
      scopes: [
        {
          session_id: session,
          scope: "turn",
          scope_match: turn,
          decision: "approve",
          turn_id: turn,
          token: "never-retain",
        },
      ],
    };
    const request = vi.fn(async () => value);
    const capabilities = {
      ...caps(),
      supported_methods: [M.APPROVAL_SCOPES_LIST],
      supported_features: [],
    };
    const commands = createInspectionCommands(
      { request },
      { sessionId: session, profileId: "coding", authority: {} },
      capabilities,
    );
    const parsed = await commands.readApprovalScopes();
    expect(parsed.scopes[0]).toMatchObject({
      scope: "turn",
      turn_id: turn,
      decision: "approve",
    });
    expect(parsed.scopes[0]).not.toHaveProperty("token");
    expect(request).toHaveBeenCalledWith(M.APPROVAL_SCOPES_LIST, {
      session_id: session,
    });
    expect(parseInspectionApprovalScopes({ scopes: [] }, session)).toEqual({
      scopes: [],
    });
    const unavailable = createInspectionCommands(
      { request },
      { sessionId: session, profileId: "coding", authority: {} },
      caps(),
    );
    await expect(unavailable.readApprovalScopes()).rejects.toThrow(
      "advertised",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects any foreign approval row, missing owner or malformed optional turn instead of partial lists", () => {
    const row = {
      session_id: session,
      scope: "session",
      scope_match: "*",
      decision: "deny",
    };
    expect(
      parseInspectionApprovalScopes(
        { scopes: [row, { ...row, session_id: `${session}#foreign` }] },
        session,
      ),
    ).toBeNull();
    expect(
      parseInspectionApprovalScopes(
        {
          scopes: [
            { scope: "tool", scope_match: "shell", decision: "approve" },
          ],
        },
        session,
      ),
    ).toBeNull();
    expect(
      parseInspectionApprovalScopes(
        { scopes: [{ ...row, turn_id: "invalid" }] },
        session,
      ),
    ).toBeNull();
    expect(
      parseInspectionApprovalScopes(
        {
          scopes: [
            { ...row, decision: "future_registry_value", turn_id: null },
          ],
        },
        session,
      )?.scopes[0]?.decision,
    ).toBe("future_registry_value");
  });
  it("sends only the native scoped read parameters and strips extra scope/result fields", async () => {
    const request = vi.fn(async (method: string) =>
      method === M.THREAD_GRAPH_GET
        ? { ...graph(), token: "never-retain" }
        : state(),
    );
    const owner = {
      sessionId: session,
      profileId: "coding",
      authority: {},
      token: "never-retain",
    };
    const commands = createInspectionCommands({ request }, owner, caps());
    owner.sessionId = "coding:local:other";
    expect(await commands.readThreadGraph()).toEqual(graph());
    expect(await commands.readTurnState(turn)).toMatchObject({
      ...state(),
      committed_seqs: [],
    });
    expect(request.mock.calls).toEqual([
      [M.THREAD_GRAPH_GET, { session_id: session }],
      [M.TURN_STATE_GET, { session_id: session, turn_id: turn }],
    ]);
    expect(commands.scope).not.toHaveProperty("token");
  });
  it.each(["methods", "features"])(
    "fails closed without negotiated %s and cannot elevate a captured grant",
    async (missing) => {
      const capabilities = caps();
      if (missing === "methods") capabilities.supported_methods = [];
      else capabilities.supported_features = [];
      const request = vi.fn();
      const commands = createInspectionCommands(
        { request },
        { sessionId: session, profileId: "coding", authority: {} },
        capabilities,
      );
      Object.assign(capabilities, caps());
      await expect(commands.readThreadGraph()).rejects.toThrow("advertised");
      await expect(commands.readTurnState(turn)).rejects.toThrow("advertised");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid turn identifiers before RPC and wrong owner replies after RPC", async () => {
    const request = vi.fn(async () => ({
      ...state(),
      turn_id: "00000000-0000-4000-8000-000000000022",
    }));
    const commands = createInspectionCommands(
      { request },
      { sessionId: session, profileId: "coding", authority: {} },
      caps(),
    );
    await expect(commands.readTurnState("not-a-uuid")).rejects.toThrow("UUID");
    expect(request).not.toHaveBeenCalled();
    await expect(commands.readTurnState(turn)).rejects.toThrow("wrong-owner");
    expect(
      parseInspectionThreadGraph(
        { ...graph(), session_id: `${session}#foreign` },
        session,
      ),
    ).toBeNull();
    expect(
      parseInspectionTurnState(
        { ...state(), session_id: `${session}#foreign` },
        session,
        turn,
      ),
    ).toBeNull();
  });
  it("accepts empty/unknown and open thread statuses without inventing turn links or liveness", () => {
    expect(
      parseInspectionThreadGraph(
        { ...graph(), threads: [], orphans: [] },
        session,
      )?.threads,
    ).toEqual([]);
    expect(
      parseInspectionThreadGraph(graph(), session)?.threads[0],
    ).not.toHaveProperty("turn_id");
    const value = graph();
    value.threads[0]!.status = "future_registered_status";
    expect(parseInspectionThreadGraph(value, session)?.threads[0]?.status).toBe(
      "future_registered_status",
    );
    expect(
      parseInspectionTurnState(state(), session, turn)?.committed_seqs,
    ).toEqual([]);
    expect(
      parseInspectionTurnState(
        { ...state(), state: "fabricated" },
        session,
        turn,
      ),
    ).toBeNull();
  });
  it("rejects malformed, duplicated, or unsafe sequence data and returns detached arrays", () => {
    const value = graph();
    const parsed = parseInspectionThreadGraph(value, session)!;
    value.threads[0]!.message_seqs.push(9);
    expect(parsed.threads[0]!.message_seqs).toEqual([0, 2]);
    expect(
      parseInspectionThreadGraph(
        { ...value, threads: [value.threads[0], value.threads[0]] },
        session,
      ),
    ).toBeNull();
    for (const orphans of [
      [-1],
      [0.5],
      [Number.MAX_SAFE_INTEGER + 1],
      [1, 1],
      ["1"],
    ])
      expect(
        parseInspectionThreadGraph({ ...value, orphans }, session),
      ).toBeNull();
    expect(
      parseInspectionTurnState(
        { ...state(), committed_seqs: null },
        session,
        turn,
      ),
    ).toBeNull();
    expect(
      parseInspectionTurnState(
        { ...state(), started_at: "not-time" },
        session,
        turn,
      ),
    ).toBeNull();
  });
  it("projects only audited context counts/labels and rejects contradictory nested ownership", () => {
    const value = {
      ...state(),
      context_state: context(),
      context: {
        schema: "octos.context.lifecycle.v1",
        state: { ...context(), credential: "never-retain" },
        credentials: { token: "never-retain" },
      },
    };
    const parsed = parseInspectionTurnState(value, session, turn)!;
    expect(parsed.context_state?.generation).toBe(0);
    expect(parsed.context?.state.item_count).toBe(0);
    expect(JSON.stringify(parsed)).not.toContain("never-retain");
    value.context.state.session_id = `${session}#foreign`;
    expect(parseInspectionTurnState(value, session, turn)).toBeNull();
  });
});
