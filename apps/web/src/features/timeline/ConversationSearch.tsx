import { useEffect, useRef } from "react";
import styles from "./conversation-search.module.css";

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

  // Focus the input when the bar first mounts (⌘F open).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes the search and returns focus to the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.target === inputRef.current) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.searchBar} role="search">
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="Search conversation"
        value={query}
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
        aria-label="Search conversation"
      />
      <button
        type="button"
        className={`${styles.navButton} ${caseSensitive ? styles.toggleOn : ""}`}
        onClick={() => onCaseSensitiveChange(!caseSensitive)}
        aria-pressed={caseSensitive}
        aria-label="Match case"
        title="Match case"
      >
        Aa
      </button>
      <span className={styles.count}>
        {matchCount === 0 ? "0" : `${activeIndex + 1}/${matchCount}`}
      </span>
      <button
        type="button"
        className={styles.navButton}
        onClick={onPrevious}
        disabled={matchCount === 0}
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.navButton}
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label="Close search"
      >
        ✕
      </button>
    </div>
  );
}
