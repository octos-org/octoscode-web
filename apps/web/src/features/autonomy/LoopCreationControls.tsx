import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildLoopCreationInput,
  createLoopCreationSubmission,
  parseLoopCreationInterval,
  type CreateLoop,
  type LoopCreationDraft,
} from "./loop-creation.ts";
import styles from "./LoopCreationControls.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface LoopCreationControlsProps {
  enabled: boolean;
  busy: boolean;
  createLoop: CreateLoop;
}
/** The enclosing AutonomyDialog owns the captured Session/authority lifetime. */
export function LoopCreationControls({
  enabled,
  busy,
  createLoop,
}: LoopCreationControlsProps) {
  const t = useUiText();
  const [draft, setDraft] = useState<LoopCreationDraft>({
    mode: "maintenance",
    prompt: "",
    interval: "5m",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const submission = useRef(createLoopCreationSubmission()).current;
  useEffect(() => () => submission.cancel(), [submission]);
  // Capabilities withdrawing while mounted must retire the unsent/awaited
  // form operation too; the store separately fences the underlying RPC.
  useEffect(() => {
    if (!enabled) {
      submission.cancel();
      setPending(false);
    }
  }, [enabled, submission]);
  if (!enabled) return null;
  const disabled = pending || busy;
  const parsed = buildLoopCreationInput(draft);
  const interval =
    draft.mode === "fixed_interval"
      ? parseLoopCreationInterval(draft.interval)
      : null;
  function change(next: Partial<LoopCreationDraft>) {
    if (disabled) return;
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
    setConfirmed(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setPending(true);
    setError(null);
    setConfirmed(false);
    const receipt = await submission.submit(draft, createLoop);
    if (receipt.kind === "stale") return;
    setPending(false);
    if (receipt.kind !== "confirmed") {
      setError(receipt.reason);
      return;
    }
    setConfirmed(true);
    setDraft((current) => ({ ...current, prompt: "" }));
  }
  return (
    <form
      className={styles.form}
      aria-label={t("Create native loop")}
      onSubmit={(event) => void submit(event)}
    >
      <label>
        {t("Loop cadence")}
        <select
          aria-label={t("Loop cadence")}
          value={draft.mode}
          disabled={disabled}
          onChange={(event) => change({ mode: event.target.value })}
        >
          <option value="maintenance">{t("Maintenance")}</option>
          <option value="self_paced">{t("Self-paced")}</option>
          <option value="fixed_interval">{t("Fixed interval")}</option>
        </select>
      </label>
      <p className={styles.hint}>
        {draft.mode === "maintenance"
          ? t(
              "Native /loop default. Leave the prompt empty to use the server's maintenance prompt and cadence.",
            )
          : draft.mode === "self_paced"
            ? t("The server decides the next run from the loop's result.")
            : t(
                "Use the native interval syntax, with a whole number and unit: 60s, 5m, 2h, or 1d.",
              )}
      </p>
      <label>
        {t("Prompt")}
        {draft.mode === "maintenance" ? " " + t("(optional)") : ""}
        <textarea
          aria-label={t("New loop prompt")}
          value={draft.prompt}
          disabled={disabled}
          required={draft.mode !== "maintenance"}
          placeholder={
            draft.mode === "maintenance"
              ? t("Use the server's maintenance prompt")
              : t("Run the checks and summarize drift")
          }
          onChange={(event) => change({ prompt: event.target.value })}
          rows={3}
        />
      </label>
      {draft.mode === "fixed_interval" ? (
        <label>
          {t("Interval")}
          <input
            aria-label={t("Loop interval")}
            type="text"
            value={draft.interval}
            required
            disabled={disabled}
            placeholder={t("5m")}
            onChange={(event) => change({ interval: event.target.value })}
          />
          <span className={styles.hint}>
            {interval?.ok
              ? t("Native interval: {value0} seconds{value1}.", {
                  value0: String(interval.seconds),
                  value1: String(
                    interval.truncatedMilliseconds
                      ? " (whole seconds, as in the native client)"
                      : "",
                  ),
                })
              : t(
                  "Pinned server policy: 60 seconds to 24 hours. Units are required.",
                )}
          </span>
        </label>
      ) : null}
      <p className={styles.hint}>
        {t(
          "Creating a loop schedules server-owned work. It does not run in this browser, and closing this panel does not stop it.",
        )}
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {confirmed ? (
        <p role="status">
          {t(
            "Loop created. Its current schedule appears in the server's loop list.",
          )}
        </p>
      ) : null}
      <button
        type="submit"
        aria-label={t("Create loop")}
        disabled={disabled || !parsed.ok}
      >
        {pending ? t("Creating loop…") : t("Create loop")}
      </button>
    </form>
  );
}
