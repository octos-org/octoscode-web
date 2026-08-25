import { isRecord, type RpcNotification } from "./rpc.ts";
import type {
  ApprovalRequested,
  UiProtocolCapabilities,
  UserQuestion,
  UserQuestionRequested,
} from "./types.ts";

export function supportsMethod(
  capabilities: UiProtocolCapabilities | undefined,
  method: string,
): boolean {
  if (!capabilities?.supported_methods.includes(method)) return false;
  return !(capabilities.unsupported ?? []).some(
    (entry) => entry.method === method,
  );
}

export function supportsFeature(
  capabilities: UiProtocolCapabilities | undefined,
  feature: string,
): boolean {
  return capabilities?.supported_features?.includes(feature) ?? false;
}

export function parseApprovalRequested(
  notification: RpcNotification,
): ApprovalRequested | null {
  if (notification.method !== "approval/requested") return null;
  const value = notification.params;
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    typeof value.approval_id !== "string" ||
    typeof value.turn_id !== "string" ||
    typeof value.tool_name !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string"
  ) {
    return null;
  }

  return {
    sessionId: value.session_id,
    approvalId: value.approval_id,
    turnId: value.turn_id,
    toolName: value.tool_name,
    title: value.title,
    body: value.body,
    ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
    ...(typeof value.approval_kind === "string"
      ? { approvalKind: value.approval_kind }
      : {}),
    ...(typeof value.risk === "string" ? { risk: value.risk } : {}),
    ...(value.typed_details === undefined
      ? {}
      : { typedDetails: value.typed_details }),
    ...(value.render_hints === undefined
      ? {}
      : { renderHints: value.render_hints }),
  };
}

export function approvalResolutionId(
  notification: RpcNotification,
): string | null {
  if (
    notification.method !== "approval/decided" &&
    notification.method !== "approval/auto_resolved" &&
    notification.method !== "approval/cancelled"
  ) {
    return null;
  }
  return isRecord(notification.params) &&
    typeof notification.params.approval_id === "string"
    ? notification.params.approval_id
    : null;
}

export function parseUserQuestionRequested(
  notification: RpcNotification,
): UserQuestionRequested | null {
  if (notification.method !== "user_question/requested") return null;
  const value = notification.params;
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    typeof value.question_id !== "string" ||
    typeof value.turn_id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !Array.isArray(value.questions)
  ) {
    return null;
  }

  const questions = value.questions.map(parseQuestion);
  if (questions.some((question) => question === null)) return null;
  return {
    sessionId: value.session_id,
    questionId: value.question_id,
    turnId: value.turn_id,
    title: value.title,
    body: value.body,
    questions: questions as UserQuestion[],
    ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
  };
}

function parseQuestion(value: unknown): UserQuestion | null {
  if (
    !isRecord(value) ||
    typeof value.header !== "string" ||
    typeof value.question !== "string" ||
    !Array.isArray(value.options)
  ) {
    return null;
  }

  const options = value.options.map((option) => {
    if (
      !isRecord(option) ||
      typeof option.label !== "string" ||
      typeof option.description !== "string"
    ) {
      return null;
    }
    return { label: option.label, description: option.description };
  });
  if (options.some((option) => option === null)) return null;

  return {
    header: value.header,
    question: value.question,
    options: options as Array<{ label: string; description: string }>,
    multiSelect: value.multi_select === true,
    allowFreeText: value.allow_free_text === true,
  };
}
