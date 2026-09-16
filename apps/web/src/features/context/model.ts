import type {
  ContextSnapshot,
  TokenCostUpdate,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  APPUI_CONTEXT_METHODS,
  supportsMethod,
} from "@octos-org/octoscode-client/protocol";

/** Billing input counts are cumulative provider usage, not context occupancy. */
export function contextUsage(
  snapshot: ContextSnapshot | null | undefined,
  usage: TokenCostUpdate | null | undefined,
) {
  const estimate = snapshot?.state?.token_estimate;
  const tokens =
    typeof estimate === "number" &&
    Number.isSafeInteger(estimate) &&
    estimate >= 0
      ? estimate
      : undefined;
  const window = usage?.contextWindow;
  const sessionId = snapshot?.state?.session_id;
  const matching = sessionId !== undefined && usage?.sessionId === sessionId;
  return {
    tokens,
    window:
      matching && window && Number.isFinite(window) && window > 0
        ? window
        : undefined,
    percent:
      tokens !== undefined &&
      matching &&
      window &&
      Number.isFinite(window) &&
      window > 0
        ? Math.min(100, Math.round((tokens / window) * 100))
        : null,
  };
}

/**
 * Context compaction is offered only when the connected server advertises its
 * AppUI method. No capability means no control (W/AGENTS fail-closed rule).
 */
export function compactAvailable(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return supportsMethod(capabilities, APPUI_CONTEXT_METHODS.COMPACT);
}
