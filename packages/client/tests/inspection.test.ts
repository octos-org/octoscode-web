import { describe, expect, it, vi } from "vitest";
import {
  createInspectionCommands,
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
