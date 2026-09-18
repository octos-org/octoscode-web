import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
} from "@octos-org/octoscode-client/protocol";
import type { SessionRecord } from "../session/session-record-manager.ts";
import type { ReasoningEffort } from "../reasoning/model.ts";

/** Native /agents spawn is an idle-only ordinary turn, never mid-turn steer. */
export function admitAgentSpawn(
  record: SessionRecord<OctosUiClient> | null,
  isCurrent: () => boolean,
  text: string,
  reasoningEffort?: ReasoningEffort,
): boolean {
  if (!record || record.closed || !isCurrent() || !text.trim()) return false;
  const snapshot = record.runtime.getSnapshot();
  const queue = record.controller.queueSnapshot();
  if (
    snapshot.phase !== "ready" ||
    snapshot.recovery.phase !== "healthy" ||
    !supportsMethod(
      snapshot.session?.capabilities,
      CORE_UI_METHODS.TURN_START,
    ) ||
    !supportsMethod(
      snapshot.session?.capabilities,
      CORE_UI_METHODS.AGENT_LIST,
    ) ||
    queue.active ||
    queue.pending.length ||
    record.controller.dispatchingTurnIdNow() ||
    record.controller.interruptingTurnIdNow()
  )
    return false;
  // The controller rechecks its record's write/history lease. Neither the
  // composer's current text nor attachment handles are borrowed by this form.
  return record.controller.enqueueTurn({
    turnId: crypto.randomUUID(),
    text: text.trim(),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });
}
