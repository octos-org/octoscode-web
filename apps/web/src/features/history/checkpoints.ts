import type {
  HydratedMessage,
  SessionHydrateResult,
} from "@octos-org/octoscode-client/protocol";

export interface ConversationCheckpoint {
  key: string;
  checkpoint: number;
  preview: string;
  prefill: string;
  mediaCount: number;
  userMessageCount: number;
}

function userTurns(thread: SessionHydrateResult): HydratedMessage[][] {
  // Core resume_policy::drop_last_n_user_turns groups by distinct user-rooted
  // thread_id, not the number of user messages. Unthreaded messages survive.
  const groups = new Map<string, HydratedMessage[]>();
  for (const message of [...(thread.messages ?? [])].sort(
    (a, b) => a.seq - b.seq,
  )) {
    if (
      message.role.toLowerCase() !== "user" ||
      message.thread_id === undefined
    )
      continue;
    const group = groups.get(message.thread_id);
    if (group) group.push(message);
    else groups.set(message.thread_id, [message]);
  }
  return [...groups.values()];
}
function messageKey(message: HydratedMessage): string {
  return JSON.stringify([
    message.thread_id ?? "",
    message.message_id ?? message.client_message_id ?? "",
    message.seq,
    message.turn_id ?? "",
  ]);
}
export function conversationCheckpoints(
  thread: SessionHydrateResult,
): ConversationCheckpoint[] {
  return userTurns(thread)
    .map((messages, index) => ({
      key: messageKey(messages[0]!),
      checkpoint: index + 1,
      preview: messages[0]!.content.replace(/\s+/g, " ").slice(0, 180),
      prefill: messages[0]!.content,
      mediaCount: messages.reduce(
        (sum, message) => sum + message.media.length,
        0,
      ),
      userMessageCount: messages.length,
    }))
    .reverse();
}

/** Recompute from fresh canonical history; never apply a stale numerical index. */
export function resolveCheckpoint(
  thread: SessionHydrateResult,
  selected: ConversationCheckpoint,
): { numTurns: number; prefill: string } | null {
  const users = userTurns(thread).map((messages) => messages[0]!);
  const index = users.findIndex(
    (message) => messageKey(message) === selected.key,
  );
  if (index < 0 || users[index]?.content !== selected.prefill) return null;
  return { numTurns: users.length - index, prefill: selected.prefill };
}
