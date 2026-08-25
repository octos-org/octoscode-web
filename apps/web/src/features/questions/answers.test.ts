import { describe, expect, it } from "vitest";
import type { UserQuestion } from "@octos-org/octoscode-client";
import {
  answersComplete,
  emptyAnswers,
  toggleQuestionOption,
  toWireAnswers,
} from "./answers.ts";

const question = (multiSelect: boolean): UserQuestion => ({
  header: "Checks",
  question: "Which checks?",
  options: [
    { label: "Fast", description: "Unit tests" },
    { label: "Full", description: "All tests" },
  ],
  multiSelect,
  allowFreeText: true,
});

describe("structured question answers", () => {
  it("replaces the label for single-select questions", () => {
    const initial = emptyAnswers(1)[0]!;
    const fast = toggleQuestionOption(question(false), initial, "Fast");
    expect(
      toggleQuestionOption(question(false), fast, "Full").selectedLabels,
    ).toEqual(["Full"]);
  });

  it("toggles labels independently for multi-select questions", () => {
    const initial = emptyAnswers(1)[0]!;
    const fast = toggleQuestionOption(question(true), initial, "Fast");
    const both = toggleQuestionOption(question(true), fast, "Full");
    expect(both.selectedLabels).toEqual(["Fast", "Full"]);
    expect(
      toggleQuestionOption(question(true), both, "Fast").selectedLabels,
    ).toEqual(["Full"]);
  });

  it("requires one answer per question and emits protocol field names", () => {
    expect(answersComplete(emptyAnswers(2))).toBe(false);
    const answers = [
      { selectedLabels: ["Fast"], freeText: "" },
      { selectedLabels: [], freeText: "  custom  " },
    ];
    expect(answersComplete(answers)).toBe(true);
    expect(toWireAnswers(answers)).toEqual([
      { selected_labels: ["Fast"] },
      { free_text: "custom" },
    ]);
  });
});
