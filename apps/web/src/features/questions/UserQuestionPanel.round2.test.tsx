/**
 * UserQuestionPanel round 2 (judge #4) — RED-first.
 *
 * Design §4.3: "Approvals show what is being asked: the tool, its target
 * (command or path), the requested scope, and each decision's consequence
 * (Approve once / Approve for this session / Deny)". The QUESTION card's
 * counterpart: the answer the operator is about to send must show what
 * Continue does (sends exactly this answer and resumes the peer) — never a
 * bare protocol "submit". These cases pin the consequence line.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UserQuestionPanel } from "./UserQuestionPanel.tsx";
import type { UserQuestionRequested } from "@octos-org/octoscode-client/protocol";

vi.mock("../preferences/ui-text.tsx", () => ({
  useUiText: () => (text: string) => text,
}));

const REQUEST: UserQuestionRequested = {
  sessionId: "s1",
  questionId: "q1",
  turnId: "t1",
  title: "Choose checks",
  body: "Select the validation depth.",
  questions: [
    {
      header: "Checks",
      question: "Which checks?",
      options: [
        { label: "Fast", description: "Unit tests" },
        { label: "Full", description: "All checks" },
      ],
      multiSelect: false,
      allowFreeText: true,
    },
  ],
};

describe("UserQuestionPanel answer consequence (judge #4)", () => {
  it("states what Continue sends — the answer resumes the peer, no bare submit", () => {
    const html = renderToStaticMarkup(
      <UserQuestionPanel
        request={REQUEST}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );
    expect(html).toContain("Sends this answer and resumes the peer");
    expect(html).not.toContain("synthetic");
  });

  it("binds the visible choices to the request's OWN question id", () => {
    const html = renderToStaticMarkup(
      <UserQuestionPanel
        request={REQUEST}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );
    // The radio group is namespaced by the REAL pending question id, so a
    // request answered elsewhere can never collide with this card's draft.
    expect(html).toContain('name="q1:0"');
  });
});
