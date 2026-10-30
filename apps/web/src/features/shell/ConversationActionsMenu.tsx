import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useOutsideDismiss } from "../product-controls/SessionControlBar.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import { CopyConversationButton } from "../transcript-export/CopyConversationButton.tsx";
import type { ConversationCopySource } from "../transcript-export/copy-conversation.ts";
import { MoreIcon } from "../../ui/ShellIcons.tsx";
import styles from "./ConversationActionsMenu.module.css";

interface ConversationActionsMenuProps {
  copySource?: ConversationCopySource | undefined;
  onOpenPreferences: () => void;
  triggerClassName: string;
}

/** Secondary conversation actions leave the header's primary space to Panel. */
export function ConversationActionsMenu({
  copySource,
  onOpenPreferences,
  triggerClassName,
}: ConversationActionsMenuProps) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  useOutsideDismiss(open, rootRef, () => close());

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab" && open) close();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    event.preventDefault();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0
        ? direction > 0
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className={styles.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={t("More actions")}
        title={t("More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon size={20} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label={t("Conversation actions")}
        >
          {copySource ? (
            <CopyConversationButton
              key={copySource.sessionId}
              source={copySource}
              className={styles.menuItem ?? ""}
              role="menuitem"
            />
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              close();
              onOpenPreferences();
            }}
          >
            {t("Browser preferences")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
