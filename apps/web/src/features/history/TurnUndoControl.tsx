import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  turnUndoController,
  useTurnUndo,
  type TurnUndoAction,
  type TurnUndoFailure,
  type TurnUndoSource,
} from "./turn-undo.ts";
import styles from "./TurnUndoControl.module.css";

export interface TurnUndoControlProps {
  /** The owning Session, as this tab names it (never shown). */
  scope: string;
  turnId: string;
  /** Only the latest turn can be undone; an earlier undone turn just says so. */
  latest: boolean;
  /** The turn recorded file changes or ran commands whose changes are not counted. */
  changed: boolean;
  /** Changes whenever the connection's authority does; a new one re-reads the list. */
  authorityKey: string;
  source: TurnUndoSource;
  /** Refresh what shows workspace files (the Changes tab) after a restore was sent. */
  onSettled: () => void;
}

/**
 * Undo / redo for one turn, inside its summary. The trigger stays where it is
 * and the confirmation opens below it, so the second click of a double click
 * lands on the trigger again, never on the confirm button.
 */
export function TurnUndoControl({
  scope,
  turnId,
  latest,
  changed,
  authorityKey,
  source,
  onSettled,
}: TurnUndoControlProps) {
  const t = useUiText();
  const controller = useMemo(
    () => turnUndoController(scope, turnId),
    [scope, turnId],
  );
  const view = useTurnUndo(controller);
  const [confirming, setConfirming] = useState<TurnUndoAction | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    controller.attach(source, onSettled);
  });
  useEffect(() => {
    if (latest) void controller.load();
  }, [controller, latest, authorityKey]);

  if (!latest)
    return controller.undone() ? (
      <p className={styles.note}>
        {t("This turn's file changes were undone.")}
      </p>
    ) : null;

  // A turn that changed nothing (and ran nothing that might have) has nothing to undo.
  const action: TurnUndoAction | null =
    view.status === "ready" && changed
      ? "undo"
      : view.status === "undone"
        ? "redo"
        : null;
  const confirm = async (chosen: TurnUndoAction) => {
    await controller.run(chosen);
    setConfirming(null);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const failure = view.failure ? failureText(view.failure) : null;
  if (
    !action &&
    !view.busy &&
    !failure &&
    !(view.status === "missing" && changed)
  )
    return null;

  return (
    <div className={styles.undo}>
      {view.status === "missing" ? (
        <p className={styles.note}>
          {t("This turn has no undo point on the server.")}
        </p>
      ) : null}
      {view.status === "undone" ? (
        <p className={styles.note}>
          {t("This turn's file changes were undone. The conversation is kept.")}
        </p>
      ) : null}
      {view.status === "undone" && view.redoGone ? (
        <p className={styles.note}>
          {t(
            "The state before the undo is no longer on the server, so it cannot be brought back.",
          )}
        </p>
      ) : null}
      {action && !(action === "redo" && view.redoGone) ? (
        <div className={styles.actions}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-expanded={confirming === action}
            disabled={Boolean(view.busy)}
            onClick={() => setConfirming(action)}
          >
            {t(action === "undo" ? "Undo this turn" : "Redo this turn")}
          </button>
          {view.busy ? (
            <span className={styles.progress} aria-live="polite">
              {t(
                view.busy === "undo"
                  ? "Undoing this turn…"
                  : "Bringing this turn back…",
              )}
            </span>
          ) : null}
        </div>
      ) : null}
      {confirming && confirming === action ? (
        <div
          className={styles.confirm}
          role="group"
          aria-label={t(
            confirming === "undo" ? "Confirm undo" : "Confirm redo",
          )}
        >
          <p>
            {t(
              confirming === "undo"
                ? "Put the workspace files back to how they were before this turn? The conversation stays. Changes made by commands are undone too, including ones not counted above."
                : "Bring back this turn's file changes? If a file was edited after the undo, Core refuses instead of overwriting it.",
            )}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={Boolean(view.busy)}
              onClick={() => void confirm(confirming)}
            >
              {t(
                confirming === "undo"
                  ? "Undo file changes"
                  : "Bring changes back",
              )}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(view.busy)}
              onClick={() => {
                setConfirming(null);
                triggerRef.current?.focus({ preventScroll: true });
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <p className={styles.notice} aria-live="polite">
        {view.done && !view.busy && !failure
          ? t(
              view.done === "undo"
                ? "Undone. The files are back to how they were before this turn."
                : "Done. This turn's file changes are back.",
            )
          : ""}
      </p>
      {failure ? (
        <div className={styles.failure} role="alert">
          <p>{t(failure.lead)}</p>
          {failure.detail ? (
            <p className={styles.detail}>
              {failure.fromCore
                ? t("Core said: {detail}", { detail: failure.detail })
                : t("Details: {detail}", { detail: failure.detail })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function failureText(failure: TurnUndoFailure): {
  lead: string;
  detail: string | null;
  fromCore?: boolean;
} {
  const undo = failure.action === "undo";
  switch (failure.kind) {
    case "blocked":
      return {
        lead: "Not sent. Wait for running turns, queued prompts and questions in this workspace to finish, then try again.",
        detail: null,
      };
    case "gone":
      return { lead: failure.detail, detail: null };
    case "unsent":
      return {
        lead: "Not sent, and no files were changed. Check the connection and try again.",
        detail: failure.detail,
      };
    case "conflict":
      return {
        lead: undo
          ? "Not undone: Core says files changed after its last undo or redo, and it will not overwrite them. The files are as they were."
          : "Not brought back: files were edited after the undo, and Core will not overwrite them. Your edits are kept.",
        detail: failure.detail,
        fromCore: true,
      };
    case "refused":
      return {
        lead: undo
          ? "Core did not undo this turn. Check the files in Changes."
          : "Core did not bring this turn back. Check the files in Changes.",
        detail: failure.detail,
        fromCore: true,
      };
    case "uncertain":
      return {
        lead: "No answer from Core, so it is unknown whether the files changed. Check the files in Changes before trying again; nothing is retried automatically.",
        detail: failure.detail,
      };
    case "refresh":
      return {
        lead: "Core finished, but the conversation could not be refreshed. Reload the page to see the latest state.",
        detail: null,
      };
  }
}
