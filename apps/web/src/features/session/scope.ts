import { isRecord, type RpcNotification } from "@octos-org/octoscode-client";

export function matchesSessionScope(
  expected: string,
  received: string,
  topic?: string,
): boolean {
  if (received === expected) {
    const expectedTopic = expected.split("#", 2)[1];
    return (
      expectedTopic === undefined ||
      topic === undefined ||
      topic === expectedTopic
    );
  }
  return Boolean(topic && `${received}#${topic}` === expected);
}

export function notificationMatchesSessionScope(
  notification: RpcNotification,
  expected: string,
): boolean {
  if (!isRecord(notification.params)) return true;
  const received = notification.params.session_id;
  if (received === undefined) return true;
  if (typeof received !== "string") return false;
  const topic =
    typeof notification.params.topic === "string"
      ? notification.params.topic
      : undefined;
  return matchesSessionScope(expected, received, topic);
}
