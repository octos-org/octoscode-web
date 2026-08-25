import { useEffect, useRef, useState } from "react";
import type {
  UserQuestionAnswer,
  UserQuestionRequested,
} from "@octos-org/octoscode-client";
import {
  answersComplete,
  emptyAnswers,
  toggleQuestionOption,
  toWireAnswers,
  type DraftAnswer,
} from "./answers.ts";

interface UserQuestionPanelProps {
  request: UserQuestionRequested;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: UserQuestionAnswer[]) => void;
  onInterrupt: () => void;
}

export function UserQuestionPanel({
  request,
  busy,
  error,
  onSubmit,
  onInterrupt,
}: UserQuestionPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<DraftAnswer[]>(() =>
    emptyAnswers(request.questions.length),
  );
  useEffect(() => rootRef.current?.focus(), [request.questionId]);

  const update = (index: number, next: DraftAnswer) => {
    setAnswers((current) =>
      current.map((answer, answerIndex) =>
        answerIndex === index ? next : answer,
      ),
    );
  };

  const valid = answersComplete(answers);

  return (
    <div className="takeover-wrap">
      <div
        ref={rootRef}
        className="question-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onInterrupt();
          }
        }}
      >
        <div className="question-heading">
          <span>Octos needs input</span>
          <strong id="question-title">{request.title}</strong>
          <p>{request.body}</p>
        </div>
        <div className="question-list">
          {request.questions.map((question, index) => {
            const answer = answers[index]!;
            return (
              <fieldset key={`${request.questionId}:${question.header}`}>
                <legend>
                  <span>{question.header}</span>
                  {question.question}
                </legend>
                <div className="question-options">
                  {question.options.map((option) => {
                    const selected = answer.selectedLabels.includes(
                      option.label,
                    );
                    return (
                      <label key={option.label} className="question-option">
                        <input
                          type={question.multiSelect ? "checkbox" : "radio"}
                          name={`${request.questionId}:${index}`}
                          checked={selected}
                          disabled={busy}
                          onChange={() =>
                            update(
                              index,
                              toggleQuestionOption(
                                question,
                                answer,
                                option.label,
                              ),
                            )
                          }
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    );
                  })}
                  {question.allowFreeText ? (
                    <label className="question-other">
                      <span>Other</span>
                      <input
                        value={answer.freeText}
                        disabled={busy}
                        placeholder="Type another answer"
                        onChange={(event) =>
                          update(index, {
                            ...answer,
                            freeText: event.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
        </div>
        {error ? <span className="takeover-error">{error}</span> : null}
        <div className="question-actions">
          <span>Esc stops the active turn</span>
          <button
            className="takeover-button primary"
            type="button"
            disabled={busy || !valid}
            onClick={() => onSubmit(toWireAnswers(answers))}
          >
            {busy ? "Sending…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
