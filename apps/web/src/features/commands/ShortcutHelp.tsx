import { useEffect, useRef } from "react";
import styles from "./ShortcutHelp.module.css";

export interface ShortcutHelpProps {
  onClose: () => void;
}

interface Entry {
  keys: string;
  label: string;
}

const ENTRIES: readonly Entry[] = [
  { keys: "⌘K / Ctrl+K", label: "Command palette" },
  { keys: "⌘F / Ctrl+F", label: "Search conversation" },
  { keys: "Alt+A", label: "Show approval panel" },
  { keys: "Alt+P", label: "Toggle peer dock" },
  { keys: "Alt+D", label: "Focus peer dispatch" },
  { keys: "Esc", label: "Close dialog / search / palette" },
];

/**
 * Keyboard shortcuts overlay (#21 keyboard-first layer discoverability).
 * Opened with `?` outside text inputs and dialogs.
 */
export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Escape closes (the shortcut list below advertises this), and focus
  // moves into the dialog on open so the modal owns the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={styles.card}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard shortcuts</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close shortcuts help"
          >
            ✕
          </button>
        </div>
        <dl className={styles.list}>
          {ENTRIES.map((entry) => (
            <div className={styles.row} key={entry.keys}>
              <dt className={styles.keys}>{entry.keys}</dt>
              <dd className={styles.label}>{entry.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
