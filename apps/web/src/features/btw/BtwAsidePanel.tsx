import { useId, useSyncExternalStore } from "react";
import { MarkdownBody } from "../markdown/MarkdownBody.tsx";
import type { LazyBtwController } from "./lazy-btw-controller.ts";
import styles from "./BtwAsidePanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

/** Ephemeral reading surface, not a modal or a durable timeline entry. */
export function BtwAsidePanel({
  controller,
}: {
  controller: Pick<LazyBtwController, "subscribe" | "getSnapshot" | "dismiss">;
}) {
  const t = useUiText();
  const aside = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const title = useId();
  if (!aside) return null;
  return (
    <aside className={styles.panel} aria-labelledby={title}>
      <header className={styles.header}>
        <h2 id={title}>{t("Aside — /btw")}</h2>
        <button
          type="button"
          onClick={controller.dismiss}
          aria-label={t("Dismiss aside")}
        >
          {t("Close")}
        </button>
      </header>
      <p className={styles.question}>{aside.question}</p>
      {aside.state === "answering" ? (
        <p role="status">{t("Answering…")}</p>
      ) : null}
      {aside.state === "failed" ? <p role="alert">{aside.error}</p> : null}
      {aside.state === "answered" ? (
        <MarkdownBody text={aside.answer ?? ""} />
      ) : null}
      <p className={styles.note}>
        {t("This aside is not saved to the conversation.")}
      </p>
    </aside>
  );
}
