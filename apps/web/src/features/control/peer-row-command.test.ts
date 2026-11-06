/**
 * peer-row-command builds the approval and question answers that the PeerDock,
 * Fleet and phone rows send. The round-1 judge (WEB-UX-ROUND2-4400) found row
 * Approve/Deny bound to a SYNTHETIC approval id, and questions unanswerable
 * from a row.
 *
 * The e2e specs press these buttons and count frames, but none reads the
 * approval id, the question id or a session-wide scope:
 * - e2e/peer-controller.spec.ts checks the frame kind;
 * - e2e/mobile-remote.spec.ts checks that the phone sends no scope.
 *
 * So these cases keep what the Core acts on: which request is answered, with
 * which answers, and how widely an approval reaches.
 */
import { describe, expect, it } from "vitest";
import { buildRowControlCommand } from "./peer-row-command.ts";
import type { PeerRowAttention } from "./peer-row-command.ts";

const UUID = "11111111-1111-1111-1111-111111111111";

function attention(
  overrides: Partial<PeerRowAttention> = {},
): PeerRowAttention {
  return {
    requestId: "approval-1",
    requestKind: "approval",
    operationId: "dispatch-op-1",
    turnId: UUID,
    ...overrides,
  };
}

describe("buildRowControlCommand — answers the row's real pending request", () => {
  it("Approve binds the ROW's pending approval id", () => {
    const command = buildRowControlCommand("approve", "", attention());
    expect(command).toEqual({
      kind: "approval_respond",
      approvalId: "approval-1",
      decision: "approve",
    });
  });

  it("session-scoped Approve carries approval_scope 'session'", () => {
    const command = buildRowControlCommand("approve_session", "", attention());
    expect(command).toEqual({
      kind: "approval_respond",
      approvalId: "approval-1",
      decision: "approve",
      approvalScope: "session",
    });
  });

  it("Answer binds the ROW's question id and the operator's answers", () => {
    const command = buildRowControlCommand(
      "answer",
      "",
      attention({ requestId: "question-1", requestKind: "question" }),
      [{ freeText: "use the mock server" }],
    );
    expect(command).toEqual({
      kind: "question_respond",
      questionId: "question-1",
      answers: [{ freeText: "use the mock server" }],
    });
  });
});
