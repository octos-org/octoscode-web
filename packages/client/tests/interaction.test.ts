import { describe, expect, it } from "vitest";
import {
  approvalResolutionId,
  parseApprovalRequested,
  parseUserQuestionRequested,
  type RpcNotification,
} from "../src/index.ts";
const notification = (method: string, params: unknown): RpcNotification => ({
  jsonrpc: "2.0",
  method,
  params,
});

describe("blocking interaction protocol", () => {
  it("parses generic and typed approval requests without trusting typed details", () => {
    expect(
      parseApprovalRequested(
        notification("approval/requested", {
          session_id: "s1",
          approval_id: "a1",
          turn_id: "t1",
          tool_name: "shell",
          title: "Run command?",
          body: "The agent wants to run tests.",
          approval_kind: "command",
          risk: "medium",
          typed_details: { kind: "future_kind", future: true },
        }),
      ),
    ).toMatchObject({
      sessionId: "s1",
      approvalId: "a1",
      turnId: "t1",
      toolName: "shell",
      approvalKind: "command",
      risk: "medium",
      typedDetails: { kind: "future_kind", future: true },
    });
  });

  it("rejects malformed blocking requests", () => {
    expect(
      parseApprovalRequested(
        notification("approval/requested", { approval_id: "a1" }),
      ),
    ).toBeNull();
    expect(
      parseUserQuestionRequested(
        notification("user_question/requested", {
          session_id: "s1",
          question_id: "q1",
          turn_id: "t1",
          title: "Choose",
          body: "Choose one",
          questions: [{ header: "Mode", question: "Which?", options: [{}] }],
        }),
      ),
    ).toBeNull();
  });

  it("tracks approval terminal notifications by id", () => {
    expect(
      approvalResolutionId(
        notification("approval/cancelled", { approval_id: "a1" }),
      ),
    ).toBe("a1");
  });
});
