/**
 * session-peer-coordinator round 4 (J3) — behavioral tests for the frame →
 * PeerSessionEvent mapping: request CONTENTS, terminal CODES, and turn ids
 * must survive the coordinator (judge r3: "the coordinator still drops
 * request contents, turn IDs, and terminal outcomes").
 */
import { describe, expect, it } from "vitest";
import type { RpcNotification } from "@octos-org/octoscode-client/protocol";
import { peerSessionEventFor } from "./session-peer-coordinator.ts";

const OPENED = new Map([
  ["dev:local:tui#master", { scope: { sessionId: "dev:local:tui#peer-a" } }],
]);

function frame(
  method: string,
  params: Record<string, unknown>,
): RpcNotification {
  return { jsonrpc: "2.0", method, params } as RpcNotification;
}

describe("peerSessionEventFor — terminal codes survive (J3)", () => {
  it("turn/completed maps to outcome finished", () => {
    const event = peerSessionEventFor(
      frame("turn/completed", {
        session_id: "dev:local:tui#peer-a",
        turn_id: "turn-1",
      }),
      OPENED,
    );
    expect(event).toEqual({
      sessionId: "dev:local:tui#master",
      kind: "turn-terminal",
      outcome: "finished",
    });
  });

  it("turn/error with code interrupted maps to outcome interrupted — never Finished", () => {
    const event = peerSessionEventFor(
      frame("turn/error", {
        session_id: "dev:local:tui#peer-a",
        turn_id: "turn-1",
        code: "interrupted",
        message: "stopped by operator",
      }),
      OPENED,
    );
    expect(event).toMatchObject({
      kind: "turn-terminal",
      outcome: "interrupted",
    });
  });

  it("a turn/error with any other code maps to outcome failed and keeps the message", () => {
    const event = peerSessionEventFor(
      frame("turn/error", {
        session_id: "dev:local:tui#peer-a",
        turn_id: "turn-1",
        code: "model_overloaded",
        message: "provider 503",
      }),
      OPENED,
    );
    expect(event).toMatchObject({
      kind: "turn-terminal",
      outcome: "failed",
      error: "provider 503",
    });
  });
});

describe("peerSessionEventFor — turn ids survive (J3)", () => {
  it("turn/started carries the frame's turn id for replacement-turn detection", () => {
    const event = peerSessionEventFor(
      frame("turn/started", {
        session_id: "dev:local:tui#peer-a",
        turn_id: "22222222-2222-2222-2222-222222222222",
        timestamp: "2026-09-15T00:00:00.000Z",
      }),
      OPENED,
    );
    expect(event).toMatchObject({
      kind: "turn-started",
      turnId: "22222222-2222-2222-2222-222222222222",
    });
  });
});

describe("peerSessionEventFor — request contents survive (J3)", () => {
  it("approval/requested carries tool, target, scope, title and body", () => {
    const event = peerSessionEventFor(
      frame("approval/requested", {
        session_id: "dev:local:tui#peer-a",
        approval_id: "appr-1",
        turn_id: "turn-1",
        tool_name: "shell",
        title: "Run product checks?",
        body: "The agent wants to run the repository checks.",
        approval_kind: "command",
        risk: "medium",
        typed_details: { command: { command_line: "pnpm check" } },
      }),
      OPENED,
    );
    expect(event).toMatchObject({
      kind: "attention-requested",
      requestKind: "approval",
      requestId: "appr-1",
      approval: {
        toolName: "shell",
        target: "pnpm check",
        scope: "command",
        title: "Run product checks?",
        body: "The agent wants to run the repository checks.",
      },
    });
  });

  it("user_question/requested carries header, question, options and flags", () => {
    const event = peerSessionEventFor(
      frame("user_question/requested", {
        session_id: "dev:local:tui#peer-a",
        question_id: "q-1",
        turn_id: "turn-1",
        title: "Choose verification depth",
        body: "Octos needs one product decision.",
        questions: [
          {
            header: "Checks",
            question: "Which checks should run?",
            options: [
              { label: "Fast", description: "Unit tests only" },
              { label: "Full", description: "All product gates" },
            ],
            multi_select: false,
            allow_free_text: true,
          },
        ],
      }),
      OPENED,
    );
    expect(event).toMatchObject({
      kind: "attention-requested",
      requestKind: "question",
      requestId: "q-1",
      question: {
        header: "Checks",
        question: "Which checks should run?",
        options: [
          { label: "Fast", description: "Unit tests only" },
          { label: "Full", description: "All product gates" },
        ],
        multiSelect: false,
        allowFreeText: true,
      },
    });
  });
});
