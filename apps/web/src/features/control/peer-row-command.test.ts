/**
 * peer-row-command round 2 (judge #4, WEB-UX-ROUND2-4400) — RED-first.
 *
 * The round-1 judge found row Approve/Deny bound to the SYNTHETIC approval id
 * (`synthetic-approval`), questions unanswerable from a row, and no
 * session-scoped approve. These cases pin the product contract:
 *  - a row command is built FROM THE ROW's real pending ids (fail-closed when
 *    absent) — never a placeholder;
 *  - Answer carries the operator's actual answers on the row's question id;
 *  - Approve optionally scopes to THIS session (approval_scope "session");
 *  - Steer carries the operator's trimmed text; Stop is a bare interrupt.
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

describe("buildRowControlCommand — real pending ids, fail-closed (judge #4)", () => {
  it("Approve binds the ROW's pending approval id", () => {
    const command = buildRowControlCommand("approve", "", attention());
    expect(command).toEqual({
      kind: "approval_respond",
      approvalId: "approval-1",
      decision: "approve",
    });
  });

  it("Deny binds the ROW's pending approval id", () => {
    const command = buildRowControlCommand("deny", "", attention());
    expect(command).toEqual({
      kind: "approval_respond",
      approvalId: "approval-1",
      decision: "deny",
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

  it("Steer trims and carries the operator's typed text", () => {
    const command = buildRowControlCommand("steer", "  octopus  ", attention());
    expect(command).toEqual({
      kind: "steer",
      input: [{ kind: "text", text: "octopus" }],
    });
  });

  it("Stop is a bare interrupt command", () => {
    expect(buildRowControlCommand("stop", "", attention())).toEqual({
      kind: "interrupt",
    });
  });

  it("fails closed (null) when the row carries no pending request id", () => {
    expect(
      buildRowControlCommand("approve", "", attention({ requestId: null })),
    ).toBeNull();
  });

  it("fails closed (null) when the attention kind does not match the action", () => {
    expect(
      buildRowControlCommand(
        "approve",
        "",
        attention({ requestKind: "question", requestId: "question-1" }),
      ),
    ).toBeNull();
    expect(
      buildRowControlCommand(
        "answer",
        "",
        attention({ requestKind: "approval", requestId: "approval-1" }),
      ),
    ).toBeNull();
  });

  it("fails closed (null) for a steer/stop row without an accepted operation", () => {
    expect(
      buildRowControlCommand("steer", "hi", attention({ operationId: null })),
    ).toBeNull();
    expect(
      buildRowControlCommand("stop", "", attention({ operationId: null })),
    ).toBeNull();
  });

  it("fails closed (null) when the targeted turn is blank", () => {
    expect(
      buildRowControlCommand("stop", "", attention({ turnId: "" })),
    ).toBeNull();
  });
});
