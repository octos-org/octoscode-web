import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./SessionActions.module.css";

/** The server rejects longer titles (`SESSION_TITLE_SET_MAX_CHARS`). */
export const SESSION_TITLE_MAX_CHARS = 200;

/**
 * What a sidebar row may do. Delete names why it is unavailable instead of
 * hiding the item, so the menu can say what to do first.
 */
export interface SessionRowActions {
  rename: boolean;
  delete: "available" | "open" | "running" | null;
}

const isComposing = (event: ReactKeyboardEvent) =>
  event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

/**
 * The row's action menu. It renders beside the tree (not inside its scroll
 * box) so the last rows' menu is not clipped, and positions itself under the
 * row, or above it when there is no room below.
 */
export function SessionActionsMenu({
  id,
  anchor,
  container,
  actions,
  onRename,
  onDelete,
  onClose,
}: {
  id: string;
  anchor: HTMLElement;
  container: HTMLElement;
  actions: SessionRowActions;
  onRename: () => void;
  onDelete: () => void;
  /** `restoreFocus` is false when the pointer moved focus elsewhere. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const t = useUiText();
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      const box = container.getBoundingClientRect();
      const row = anchor.getBoundingClientRect();
      const below = row.bottom - box.top + 4;
      const above = row.top - box.top - menu.offsetHeight - 4;
      const top =
        below + menu.offsetHeight > box.height && above >= 0 ? above : below;
      menu.style.setProperty("--session-menu-top", `${Math.round(top)}px`);
      menu.style.setProperty(
        "--session-menu-right",
        `${Math.max(4, Math.round(box.right - row.right))}px`,
      );
    };
    place();
    menu.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [anchor, container]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target)) return;
      if (anchor.contains(event.target)) return;
      onCloseRef.current(false);
    };
    // A scrolled tree or resized window would leave the menu beside the
    // wrong row; closing is simpler and matches native menus.
    const onMove = () => onCloseRef.current(false);
    const scroller = anchor.closest("[role='tree']");
    document.addEventListener("pointerdown", onPointerDown);
    scroller?.addEventListener("scroll", onMove);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      scroller?.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  }, [anchor]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event)) return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ??
        []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        return;
      case "ArrowUp":
        move(index - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(items.length - 1);
        return;
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        return;
    }
  };

  const deleteHint =
    actions.delete === "open"
      ? t("Switch to another session first.")
      : actions.delete === "running"
        ? t("Stop this session’s work first.")
        : null;

  return (
    <div
      ref={menuRef}
      id={id}
      className={styles.menu}
      role="menu"
      aria-label={t("Session actions")}
      onKeyDown={onKeyDown}
    >
      {actions.rename ? (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          aria-keyshortcuts="F2"
          onClick={onRename}
        >
          <span>{t("Rename")}</span>
          <kbd className={styles.shortcut}>F2</kbd>
        </button>
      ) : null}
      {actions.delete ? (
        <button
          type="button"
          role="menuitem"
          className={`${styles.item} ${styles.danger}`}
          aria-keyshortcuts="Delete"
          aria-disabled={deleteHint ? true : undefined}
          onClick={() => {
            if (!deleteHint) onDelete();
          }}
        >
          <span className={styles.itemText}>
            <span>{t("Delete…")}</span>
            {deleteHint ? (
              <span className={styles.hint}>{deleteHint}</span>
            ) : null}
          </span>
          {deleteHint ? null : (
            <kbd className={styles.shortcut}>{t("Del")}</kbd>
          )}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Inline title editor. Enter saves and Escape cancels (both ignored while an
 * input method is composing); leaving the field saves a changed title, the
 * way file and chat lists behave. A failed save keeps the text and the field.
 */
export function SessionRenameField({
  initialTitle,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  saving: boolean;
  error: string | null;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const t = useUiText();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [value, setValue] = useState(initialTitle);
  const [empty, setEmpty] = useState(false);
  // Escape unmounts the field, and some browsers then report a blur; that
  // blur must not save the text the user just abandoned.
  const settledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const cancel = () => {
    settledRef.current = true;
    onCancel();
  };

  const commit = (fromBlur: boolean) => {
    if (saving || settledRef.current) return;
    const title = value.trim();
    if (title === initialTitle.trim()) {
      cancel();
      return;
    }
    if (!title) {
      if (fromBlur) cancel();
      else setEmpty(true);
      return;
    }
    onSave(title);
  };

  const message = empty ? t("Enter a title.") : error;
  return (
    <span className={styles.rename}>
      <input
        ref={inputRef}
        className={styles.renameInput}
        aria-label={t("Session title")}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        aria-busy={saving || undefined}
        readOnly={saving}
        maxLength={SESSION_TITLE_MAX_CHARS}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setEmpty(false);
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isComposing(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit(false);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={() => commit(true)}
      />
      {message ? (
        <span id={errorId} className={styles.renameError} role="alert">
          {message}
        </span>
      ) : saving ? (
        <span className={styles.renameStatus} role="status">
          {t("Saving…")}
        </span>
      ) : null}
    </span>
  );
}

export function DeleteSessionDialog({
  title,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useUiText();
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      describedBy={descriptionId}
      busy={deleting}
      initialFocusRef={cancelRef}
      closeOnBackdrop={!deleting}
      {...(deleting ? {} : { onEscape: onCancel })}
    >
      <h2 id={titleId}>{t("Delete this session?")}</h2>
      <p id={descriptionId} className={styles.description}>
        {t(
          "“{title}” and its conversation will be deleted from the server. This cannot be undone.",
          { title },
        )}
      </p>
      {error ? (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          ref={cancelRef}
          type="button"
          disabled={deleting}
          onClick={onCancel}
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          className={styles.confirm}
          aria-disabled={deleting || undefined}
          onClick={() => {
            if (!deleting) onConfirm();
          }}
        >
          {deleting ? t("Deleting…") : t("Delete")}
        </button>
      </div>
    </ModalSurface>
  );
}
