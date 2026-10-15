import { useEffect, useRef } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./ConversationSearch.module.css";

export interface ConversationSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  matchCount: number;
  activeIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/** Search bar UI for the conversation timeline. */
export function ConversationSearch({
  query,
  onQueryChange,
  caseSensitive,
  onCaseSensitiveChange,
  matchCount,
  activeIndex,
  onNext,
  onPrevious,
  onClose,
}: ConversationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useUiText();

  // Focus the input when the bar first mounts (⌘F open).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape is two-stage (the standard search pattern): with a query it
  // clears first, and an empty query closes the bar and returns focus to
  // the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.target === inputRef.current) {
        event.preventDefault();
        if (query.length > 0) {
          onQueryChange("");
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onQueryChange, query]);

  return (
    <div className={styles.searchBar} role="search">
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder={t("Search conversation")}
        value={query}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
              onPrevious();
            } else {
              onNext();
            }
          }
        }}
        aria-label={t("Search conversation")}
      />
      <button
        type="button"
        className={`${styles.navButton} ${caseSensitive ? styles.toggleOn : ""}`}
        onClick={() => onCaseSensitiveChange(!caseSensitive)}
        aria-pressed={caseSensitive}
        aria-label={t("Match case")}
        title={t("Match case")}
      >
        Aa
      </button>
      <span
        className={`${styles.count} ${query.trim() && matchCount === 0 ? styles.noMatch : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {/* No count before a query exists — a bare "0" reads as failure. */}
        {query.trim()
          ? matchCount === 0
            ? "0"
            : `${activeIndex + 1}/${matchCount}`
          : ""}
      </span>
      <button
        type="button"
        className={styles.navButton}
        onClick={onPrevious}
        disabled={matchCount === 0}
        aria-label={t("Previous match")}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.navButton}
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label={t("Next match")}
      >
        ↓
      </button>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label={t("Close search")}
      >
        ✕
      </button>
    </div>
  );
}
