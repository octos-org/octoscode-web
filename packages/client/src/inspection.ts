import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import { isProtocolUuid } from "./protocol-id.ts";
import {
  parseInspectionThreadGraph,
  parseInspectionTurnState,
  parseInspectionApprovalScopes,
} from "./inspection-results.ts";
import type { UiProtocolCapabilities } from "./types.ts";
export * from "./inspection-results.ts";

export interface InspectionScope {
  sessionId: string;
  profileId: string;
  /** Opaque, token-free owner identity; never serialized into a request. */
  authority: object;
}
export function createInspectionCommands(
  rpc: { request(method: string, params: unknown): Promise<unknown> },
  owner: InspectionScope,
  capabilities: UiProtocolCapabilities,
) {
  if (!owner.sessionId.trim() || !owner.profileId.trim() || !owner.authority)
    throw new Error(
      "A confirmed Session and Profile are required for inspection.",
    );
  const scope = Object.freeze({
    sessionId: owner.sessionId,
    profileId: owner.profileId,
    authority: owner.authority,
  });
  // Capture the negotiated grant. Mutating a capabilities object later cannot
  // elevate this command object; a new authority must resolve new commands.
  const available = Object.freeze({
    threads:
      supportsMethod(capabilities, CORE_UI_METHODS.THREAD_GRAPH_GET) &&
      supportsFeature(capabilities, CORE_UI_FEATURES.THREAD_GRAPH_V1),
    turn:
      supportsMethod(capabilities, CORE_UI_METHODS.TURN_STATE_GET) &&
      supportsFeature(capabilities, CORE_UI_FEATURES.TURN_STATE_GET_V1),
    approvalScopes: supportsMethod(
      capabilities,
      CORE_UI_METHODS.APPROVAL_SCOPES_LIST,
    ),
  });
  return Object.freeze({
    scope,
    available,
    async readApprovalScopes() {
      if (!available.approvalScopes)
        throw new Error(
          "Remembered approval inspection is not advertised by this server.",
        );
      const result = parseInspectionApprovalScopes(
        await rpc.request(CORE_UI_METHODS.APPROVAL_SCOPES_LIST, {
          session_id: scope.sessionId,
        }),
        scope.sessionId,
      );
      if (!result)
        throw new Error("Invalid or wrong-Session approval scopes result.");
      return result;
    },
    async readThreadGraph() {
      if (!available.threads)
        throw new Error(
          "Thread graph inspection is not advertised by this server.",
        );
      // TUI always requests the current head. Core's `at` is not a historical
      // grouping guarantee; do not expose invented point-in-time semantics.
      const result = parseInspectionThreadGraph(
        await rpc.request(CORE_UI_METHODS.THREAD_GRAPH_GET, {
          session_id: scope.sessionId,
        }),
        scope.sessionId,
      );
      if (!result)
        throw new Error("Invalid or wrong-Session thread graph result.");
      return result;
    },
    async readTurnState(turnId: string) {
      if (!available.turn)
        throw new Error(
          "Turn state inspection is not advertised by this server.",
        );
      if (!isProtocolUuid(turnId))
        throw new Error("A valid turn UUID is required.");
      const canonicalTurnId = turnId.toLowerCase();
      const result = parseInspectionTurnState(
        await rpc.request(CORE_UI_METHODS.TURN_STATE_GET, {
          session_id: scope.sessionId,
          turn_id: canonicalTurnId,
        }),
        scope.sessionId,
        canonicalTurnId,
      );
      if (!result) throw new Error("Invalid or wrong-owner turn state result.");
      return result;
    },
  });
}
export type InspectionCommands = ReturnType<typeof createInspectionCommands>;
