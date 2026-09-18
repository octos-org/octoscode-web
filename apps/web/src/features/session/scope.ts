import {
  CORE_UI_METHODS,
  isRecord,
  type RpcNotification,
} from "@octos-org/octoscode-client/protocol";

export function matchesSessionScope(
  expected: string,
  received: string,
  topic?: string,
): boolean {
  const separator = expected.indexOf("#");
  const expectedTopic =
    separator < 0 ? undefined : normalizedTopic(expected.slice(separator + 1));
  const receivedTopic = normalizedTopic(topic);
  if (received === expected) {
    // A topicless Session is a scope, never a wildcard for its topic children.
    return receivedTopic === undefined || receivedTopic === expectedTopic;
  }
  return (
    expectedTopic !== undefined &&
    received === expected.slice(0, separator) &&
    receivedTopic === expectedTopic
  );
}

export function notificationMatchesSessionScope(
  notification: RpcNotification,
  expected: string,
): boolean {
  const peerLifecycle =
    notification.method === CORE_UI_METHODS.PEER_STAGED ||
    notification.method === CORE_UI_METHODS.PEER_CLOSED;
  if (!isRecord(notification.params)) return !peerLifecycle;
  const received = notification.params.session_id;
  if (received === undefined) return !peerLifecycle;
  if (typeof received !== "string") return false;
  // Core's native peer lifecycle topic names the CHILD, not the sender.
  // These two events route only by their full originating SessionKey.
  if (peerLifecycle) return received === expected;
  if (
    notification.params.topic !== undefined &&
    notification.params.topic !== null &&
    typeof notification.params.topic !== "string"
  )
    return false;
  const topic =
    typeof notification.params.topic === "string"
      ? notification.params.topic
      : undefined;
  return matchesSessionScope(expected, received, topic);
}

function normalizedTopic(topic: string | undefined): string | undefined {
  // rc11 ledger_event_matches_topic_scope normalizes both event and subscriber
  // topics with trim + empty => None, as does session/open normalization.
  return topic?.trim() || undefined;
}
