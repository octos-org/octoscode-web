import type { PromptTurn } from "./turn-queue.ts";
import { CloseIcon } from "../../ui/ShellIcons.tsx";
import styles from "./QueuedPrompts.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export function QueuedPrompts({
  prompts,
  onRemove,
}: {
  prompts: readonly PromptTurn[];
  onRemove: (turnId: string) => void;
}) {
  const t = useUiText();
  if (!prompts.length) return null;
  return (
    <section className={styles.queue} aria-label={t("Queued prompts")}>
      <header>
        <strong aria-live="polite">
          {t("{count} queued", { count: prompts.length })}
        </strong>
        <span>{t("Sent in order after the current response")}</span>
      </header>
      <ol>
        {prompts.map((prompt, index) => (
          <li key={prompt.turnId}>
            <span className={styles.position}>{index + 1}</span>
            <p>{prompt.text}</p>
            <button
              type="button"
              aria-label={t("Remove queued prompt {index}", {
                index: index + 1,
              })}
              title={t("Remove from queue")}
              onClick={() => onRemove(prompt.turnId)}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
