import type { PromptTurn } from "./turn-queue.ts";
import { CloseIcon } from "../../ui/Icon.tsx";
import styles from "./QueuedPrompts.module.css";

export function QueuedPrompts({
  prompts,
  onRemove,
}: {
  prompts: readonly PromptTurn[];
  onRemove: (turnId: string) => void;
}) {
  if (!prompts.length) return null;
  return (
    <section className={styles.queue} aria-label="Queued prompts">
      <header>
        <strong aria-live="polite">{prompts.length} queued</strong>
        <span>Sent in order after the current response</span>
      </header>
      <ol>
        {prompts.map((prompt, index) => (
          <li key={prompt.turnId}>
            <span className={styles.position}>{index + 1}</span>
            <p>{prompt.text}</p>
            <button
              type="button"
              aria-label={`Remove queued prompt ${index + 1}`}
              title="Remove from queue"
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
