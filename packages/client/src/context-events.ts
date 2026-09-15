import { isRecord, type RpcNotification } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import {
  count,
  label,
  parseContextState,
  parseCompaction,
  parseNormalization,
  type ContextSnapshot,
} from "./context-state.ts";

export function applyContextNotification(
  prior: ContextSnapshot | null,
  event: RpcNotification,
  sessionId: string,
): ContextSnapshot | null {
  const previous = prior?.state.session_id === sessionId ? prior : null;
  if (
    !event.method.startsWith("context/") ||
    !isRecord(event.params) ||
    event.params.session_id !== sessionId
  )
    return previous;
  const state = parseContextState(event.params.context_state, sessionId);
  if (!state || (previous && state.generation < previous.state.generation))
    return previous;
  if (event.method === CORE_UI_METHODS.CONTEXT_COMPACTION_STARTED) {
    if (!count(event.params.threshold_tokens) || !label(event.params.trigger))
      return previous;
    // Failed compaction keeps its generation. A new retry must still show
    // progress; replay deduplication belongs to the owning cursor projector.
    return {
      ...previous,
      state,
      compacting: {
        generation: state.generation,
        thresholdTokens: event.params.threshold_tokens,
        trigger: event.params.trigger,
      },
    };
  }
  if (event.method === CORE_UI_METHODS.CONTEXT_COMPACTION_COMPLETED) {
    const lastCompaction = parseCompaction(event.params.compaction);
    if (!lastCompaction) return previous;
    const next = { ...previous, state, lastCompaction };
    delete next.compacting;
    return next;
  }
  if (event.method === CORE_UI_METHODS.CONTEXT_NORMALIZATION_REPORTED) {
    const lastNormalization = parseNormalization(event.params.normalization);
    return lastNormalization
      ? { ...previous, state, lastNormalization }
      : previous;
  }
  return previous;
}
