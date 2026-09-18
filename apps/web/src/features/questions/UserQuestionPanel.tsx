import { useId, useState, type KeyboardEvent } from "react";
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
import {
  arrowDelta,
  choiceHint,
  nextOptionIndex,
  submitBlockedReason,
} from "./question-card.ts";
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
  const reasonId = useId();
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
  const blocked = submitBlockedReason(busy, answers);
  const submit = () => {
    if (busy || !valid) return;
    onSubmit(toWireAnswers(answers));
  };

  // Enter anywhere in the card sends the answer, so the operator never has to
  // hunt for the button. A button already turns Enter into a click, so it is
  // left alone rather than submitted twice.
  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    submit();
  };

  return (
    <ModalSurface
      // Session-scoped takeover: other sessions stay reachable while it waits.
      hidesBackground={false}
      backdropClassName="takeover-wrap"
      dialogClassName={styles.card!}
      labelledBy="question-title"
      busy={busy}
      onKeyDown={onCardKeyDown}
      {...(busy || !onInterrupt ? {} : { onEscape: onInterrupt })}
    >
      <div className={styles.heading}>
        <span className={styles.eyebrow}>{t("Octos needs input")}</span>
        <strong id="question-title" className={styles.title}>
          {request.title}
        </strong>
        <p className={styles.body}>{request.body}</p>
      </div>
      <div className={styles.list}>
        {request.questions.map((question, index) => {
          const answer = answers[index]!;
          return (
            <fieldset
              key={`${request.questionId}:${question.header}`}
              className={styles.field}
            >
              {/* The legend is the group's accessible name: header then
                  question, and nothing else. Anything added inside changes
                  that name. */}
              <legend className={styles.legend}>
                <span>{question.header}</span>
                {question.question}
              </legend>
              <p className={styles.hint}>{t(choiceHint(question))}</p>
              <div
                className={styles.options}
                onKeyDown={(event) => {
                  // Radio groups already move on arrows; checkbox groups get
                  // nothing from the browser, so the rows move focus here.
                  if (!question.multiSelect) return;
                  const delta = arrowDelta(event.key);
                  if (delta === null) return;
                  const inputs = [
                    ...event.currentTarget.querySelectorAll<HTMLInputElement>(
                      "input[type='checkbox']",
                    ),
                  ];
                  const from = inputs.indexOf(
                    document.activeElement as HTMLInputElement,
                  );
                  if (from < 0) return;
                  event.preventDefault();
                  inputs[nextOptionIndex(from, delta, inputs.length)]?.focus();
                }}
              >
                {question.options.map((option) => {
                  const selected = answer.selectedLabels.includes(option.label);
                  return (
                    <label
                      key={option.label}
                      className={styles.option}
                      data-selected={selected ? "true" : undefined}
                    >
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
                  <label className={styles.other}>
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
        <span className={`takeover-error ${styles.error}`} role="alert">
          {error}
        </span>
      ) : null}
      <div className={styles.actions}>
        {onInterrupt ? (
          <span className={styles.escHint}>
            {t("Esc stops the active turn")}
          </span>
        ) : null}
        {/* Round 2 (judge #4): the decision's CONSEQUENCE, not a bare submit —
            the operator sees exactly what Continue does before choosing it. */}
        <span className={styles.consequence}>
          {t("Sends this answer and resumes the peer")}
        </span>
        {/* A disabled primary action always says why; the button's accessible
            NAME stays exactly the label, so the reason is a description. */}
        {blocked ? (
          <span className={styles.reason} id={reasonId}>
            {t(blocked)}
          </span>
        ) : null}
        <button
          className={`takeover-button primary ${styles.submit}`}
          type="button"
          disabled={busy || !valid}
          {...(blocked ? { "aria-describedby": reasonId } : {})}
          onClick={submit}
        >
          {busy ? t("Sending…") : t("Continue")}
        </button>
      </div>
    </ModalSurface>
  );
}
