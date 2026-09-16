import { describe, expect, it } from "vitest";
import type { UserQuestion } from "@octos-org/octoscode-client/protocol";
import {
  arrowDelta,
  choiceHint,
  nextOptionIndex,
  submitBlockedReason,
} from "./question-card.ts";

const answered = { selectedLabels: ["Fast"], freeText: "" };
const blank = { selectedLabels: [], freeText: "" };

function question(overrides: Partial<UserQuestion> = {}): UserQuestion {
  return {
    header: "Checks",
    question: "Which checks should run?",
    options: [{ label: "Fast", description: "Unit tests only" }],
    multiSelect: false,
    allowFreeText: false,
    ...overrides,
  };
}

describe("submitBlockedReason", () => {
  it("has no reason when every question is answered", () => {
    expect(submitBlockedReason(false, [answered])).toBeNull();
    expect(
      submitBlockedReason(false, [
        answered,
        { selectedLabels: [], freeText: " typed " },
      ]),
    ).toBeNull();
  });

  it("names the single missing choice", () => {
    expect(submitBlockedReason(false, [blank])).toBe(
      "Choose an option to continue",
    );
  });

  it("asks for the rest when several questions are open", () => {
    expect(submitBlockedReason(false, [answered, blank])).toBe(
      "Answer every question to continue",
    );
  });

  it("explains a pending send before it explains a missing answer", () => {
    expect(submitBlockedReason(true, [blank])).toBe("Sending your answer…");
  });

  it("treats whitespace-only free text as unanswered", () => {
    expect(
      submitBlockedReason(false, [{ selectedLabels: [], freeText: "  " }]),
    ).toBe("Choose an option to continue");
  });
});

describe("choiceHint", () => {
  it("says how many choices the question takes, and whether text is allowed", () => {
    expect(choiceHint(question())).toBe("Choose one");
    expect(choiceHint(question({ allowFreeText: true }))).toBe(
      "Choose one, or write your own",
    );
    expect(choiceHint(question({ multiSelect: true }))).toBe(
      "Choose any that apply",
    );
    expect(
      choiceHint(question({ multiSelect: true, allowFreeText: true })),
    ).toBe("Choose any that apply, or write your own");
  });
});

describe("arrow-key movement", () => {
  it("wraps at both ends of a group, like a radio group does", () => {
    expect(nextOptionIndex(0, 1, 3)).toBe(1);
    expect(nextOptionIndex(2, 1, 3)).toBe(0);
    expect(nextOptionIndex(0, -1, 3)).toBe(2);
    expect(nextOptionIndex(0, 1, 0)).toBe(0);
  });

  it("maps only the four arrow keys", () => {
    expect(arrowDelta("ArrowDown")).toBe(1);
    expect(arrowDelta("ArrowRight")).toBe(1);
    expect(arrowDelta("ArrowUp")).toBe(-1);
    expect(arrowDelta("ArrowLeft")).toBe(-1);
    expect(arrowDelta("Enter")).toBeNull();
    expect(arrowDelta("Tab")).toBeNull();
  });
});
