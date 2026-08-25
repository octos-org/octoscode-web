import type {
  UserQuestion,
  UserQuestionAnswer,
} from "@octos-org/octoscode-client";

export interface DraftAnswer {
  selectedLabels: string[];
  freeText: string;
}

export function emptyAnswers(count: number): DraftAnswer[] {
  return Array.from({ length: count }, () => ({
    selectedLabels: [],
    freeText: "",
  }));
}

export function toggleQuestionOption(
  question: UserQuestion,
  answer: DraftAnswer,
  label: string,
): DraftAnswer {
  const selected = answer.selectedLabels.includes(label);
  return {
    ...answer,
    selectedLabels: question.multiSelect
      ? selected
        ? answer.selectedLabels.filter((candidate) => candidate !== label)
        : [...answer.selectedLabels, label]
      : [label],
  };
}

export function answersComplete(answers: readonly DraftAnswer[]): boolean {
  return answers.every(
    (answer) =>
      answer.selectedLabels.length > 0 || Boolean(answer.freeText.trim()),
  );
}

export function toWireAnswers(
  answers: readonly DraftAnswer[],
): UserQuestionAnswer[] {
  return answers.map((answer) => ({
    ...(answer.selectedLabels.length
      ? { selected_labels: answer.selectedLabels }
      : {}),
    ...(answer.freeText.trim() ? { free_text: answer.freeText.trim() } : {}),
  }));
}
