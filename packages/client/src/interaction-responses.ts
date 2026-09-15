import { isRecord } from "./rpc.ts";
import type {
  ApprovalRespondResult,
  UserQuestionRespondResult,
} from "./types.ts";

export function parseApprovalRespondResult(
  value: unknown,
): ApprovalRespondResult | null {
  if (
    !isRecord(value) ||
    typeof value.approval_id !== "string" ||
    typeof value.accepted !== "boolean" ||
    typeof value.status !== "string" ||
    typeof value.runtime_resumed !== "boolean"
  ) {
    return null;
  }
  return {
    approval_id: value.approval_id,
    accepted: value.accepted,
    status: value.status,
    runtime_resumed: value.runtime_resumed,
  };
}

export function parseUserQuestionRespondResult(
  value: unknown,
): UserQuestionRespondResult | null {
  if (
    !isRecord(value) ||
    typeof value.question_id !== "string" ||
    typeof value.accepted !== "boolean" ||
    typeof value.runtime_resumed !== "boolean"
  ) {
    return null;
  }
  return {
    question_id: value.question_id,
    accepted: value.accepted,
    runtime_resumed: value.runtime_resumed,
  };
}
