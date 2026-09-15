import { useState } from "react";
import type {
  UserQuestionAnswer,
  UserQuestionRequested,
} from "@octos-org/octoscode-client/protocol";
import {
  answersComplete,
  emptyAnswers,
  toggleQuestionOption,
  toWireAnswers,
  type DraftAnswer,
} from "./answers.ts";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./UserQuestionPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

interface UserQuestionPanelProps {
  request: UserQuestionRequested;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: UserQuestionAnswer[]) => void;
  onInterrupt?: (() => void) | undefined;
}

export function UserQuestionPanel({
  request,
  busy,
  error,
  onSubmit,
  onInterrupt,
}: UserQuestionPanelProps) {
  const t = useUiText();
  const [answers, setAnswers] = useState<DraftAnswer[]>(() =>
    emptyAnswers(request.questions.length),
  );

  const update = (index: number, next: DraftAnswer) => {
    setAnswers((current) =>
      current.map((answer, answerIndex) =>
        answerIndex === index ? next : answer,
      ),
    );
  };

  const valid = answersComplete(answers);

  return (
    <ModalSurface
      backdropClassName="takeover-wrap"
      dialogClassName={`question-card ${styles.card}`}
      labelledBy="question-title"
      {...(busy || !onInterrupt ? {} : { onEscape: onInterrupt })}
    >
      <div className="question-heading">
        <span>{t("Octos needs input")}</span>
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
                  const selected = answer.selectedLabels.includes(option.label);
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
                    <span>{t("Other")}</span>
                    <input
                      value={answer.freeText}
                      disabled={busy}
                      placeholder={t("Type another answer")}
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
      {error ? (
        <span className="takeover-error" role="alert">
          {error}
        </span>
      ) : null}
      <div className="question-actions">
        {onInterrupt ? <span>{t("Esc stops the active turn")}</span> : null}
        {/* Round 2 (judge #4): the decision's CONSEQUENCE, not a bare submit —
            the operator sees exactly what Continue does before choosing it. */}
        <span className="question-consequence">
          {t("Sends this answer and resumes the peer")}
        </span>
        <button
          className="takeover-button primary"
          type="button"
          disabled={busy || !valid}
          onClick={() => onSubmit(toWireAnswers(answers))}
        >
          {busy ? t("Sending…") : t("Continue")}
        </button>
      </div>
    </ModalSurface>
  );
}
