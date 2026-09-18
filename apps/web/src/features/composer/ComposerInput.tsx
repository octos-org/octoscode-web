import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { usePreferences } from "../preferences/preferences.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  PEER_READONLY_HINT,
  peerReadonlySlug,
  type PeerReadonlyRow,
} from "./peer-readonly.ts";
import { clearVimPending, reduceVimEdit, resetVimMode } from "./vim-edit.ts";

interface ComposerInputProps {
  recordKey: string;
  /**
   * The captured parent keeps a handle on the textarea so it can return the
   * keyboard to the composer (session attach, a takeover dialog closing). The
   * composer still owns the element; this only mirrors it outward.
   */
  inputRef?: RefObject<HTMLTextAreaElement | null> | undefined;
  /**
   * A takeover (approval / question) replaces the composer rather than
   * overlaying it, so finishing one REMOUNTS this component. Claiming the
   * keyboard on mount is what hands the operator straight back to their draft
   * instead of dropping focus on <body>.
   */
  focusOnMount?: boolean | undefined;
  value: string;
  disabled: boolean;
  placeholder: string;
  /**
   * Peer roster rows for the Session being viewed (audit row 7). When
   * `peerSessionId` is one of these peer identities the composer refuses plain
   * prompts: a dim status row names the peer and the textarea is disabled.
   */
  peerRoster?: readonly PeerReadonlyRow[] | undefined;
  peerSessionId?: string | null | undefined;
  paletteId: string;
  commandCount: number;
  selectedCommandId: string | undefined;
  onChange(value: string): void;
  onCommandMove(delta: number): void;
  onCommandDismiss(): void;
  onSubmit(): void;
  onInterrupt(): void;
}

/** Cold, browser-only editing. The captured parent still owns all admission. */
export function ComposerInput(props: ComposerInputProps) {
  const { vimMode } = usePreferences();
  const t = useUiText();
  // Audit row 7: a focused peer is a read-only watch surface. Exact identity-set
  // membership (never a `peer-` topic prefix), matching the TUI predicate.
  const readOnlyPeerSlug = peerReadonlySlug(
    props.peerRoster ?? [],
    props.peerSessionId ?? null,
  );
  const commandMode =
    props.commandCount > 0 || props.value.trimStart().startsWith("/");
  const textarea = useRef<HTMLTextAreaElement>(null);
  // a11y review 0800 §1: disabling a FOCUSED textarea drops focus to <body>.
  // Keep a legal landing (the status row) and the intent to use it — focus is
  // only moved on the read-only EDGE, so an unfocused composer is never stolen.
  const statusRow = useRef<HTMLParagraphElement>(null);
  const hadFocus = useRef(false);
  const peerReadOnly = useRef(false);
  const mode = useRef({
    ...resetVimMode(),
    enabled: vimMode,
    recordKey: props.recordKey,
  });
  const [, renderMode] = useState(0);
  const selection = useRef<{
    recordKey: string;
    text: string;
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null>(null);
  // Reconcile before rendering/handling keys, not in a delayed effect after a
  // newly selected record could inherit the previous record's operator.
  if (mode.current.enabled !== vimMode) {
    mode.current = {
      ...resetVimMode(),
      enabled: vimMode,
      recordKey: props.recordKey,
    };
  } else if (mode.current.recordKey !== props.recordKey) {
    mode.current = {
      ...mode.current,
      ...clearVimPending(mode.current),
      recordKey: props.recordKey,
    };
    selection.current = null;
  }
  useLayoutEffect(() => {
    if (!props.focusOnMount) return;
    const frame = requestAnimationFrame(() => textarea.current?.focus());
    return () => cancelAnimationFrame(frame);
    // Mount only: a later render must never steal the keyboard back.
  }, []);
  useLayoutEffect(() => {
    const caret = selection.current;
    const target = textarea.current;
    selection.current = null;
    if (
      caret &&
      target &&
      document.activeElement === target &&
      caret.recordKey === props.recordKey &&
      caret.text === props.value
    ) {
      target.setSelectionRange(caret.start, caret.end, caret.direction);
    }
  });
  // a11y review 0800 §1: when the session flips peer-readonly while the operator
  // was typing, `disabled` would drop focus to <body>. Land it on the status row
  // instead — on the EDGE only (a stable read-only re-render must not re-steal
  // focus), and only if the textarea actually held focus at the flip.
  const peerReadOnlyNow = readOnlyPeerSlug !== null;
  useLayoutEffect(() => {
    const was = peerReadOnly.current;
    peerReadOnly.current = peerReadOnlyNow;
    if (
      peerReadOnlyNow &&
      !was &&
      (hadFocus.current || document.activeElement === textarea.current)
    ) {
      statusRow.current?.focus();
    }
  }, [peerReadOnlyNow]);
  return (
    <>
      <textarea
        ref={(node) => {
          textarea.current = node;
          if (props.inputRef) props.inputRef.current = node;
        }}
        value={props.value}
        disabled={props.disabled || readOnlyPeerSlug !== null}
        placeholder={props.placeholder}
        aria-label="Message Octos"
        data-vim-mode={vimMode ? mode.current.mode : "off"}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={() => {
          hadFocus.current = false;
          mode.current = { ...mode.current, ...clearVimPending(mode.current) };
          selection.current = null;
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            document.activeElement !== event.currentTarget
          )
            return;
          // Native IME owns commit/cancel, including Safari's composing keyCode.
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            mode.current = {
              ...mode.current,
              ...clearVimPending(mode.current),
            };
            return;
          }
          if (
            props.commandCount &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            ["ArrowDown", "ArrowUp", "Escape"].includes(event.key)
          ) {
            event.preventDefault();
            mode.current = {
              ...mode.current,
              ...clearVimPending(mode.current),
            };
            if (event.key === "Escape") props.onCommandDismiss();
            else props.onCommandMove(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          const target = event.currentTarget;
          const edit = reduceVimEdit(
            {
              ...mode.current,
              text: props.value,
              selectionStart: target.selectionStart,
              selectionEnd: target.selectionEnd,
              selectionDirection: target.selectionDirection,
            },
            event,
          );
          if (
            edit.mode !== mode.current.mode ||
            edit.pending !== mode.current.pending
          )
            renderMode((n) => n + 1);
          mode.current = {
            ...mode.current,
            mode: edit.mode,
            pending: edit.pending,
          };
          if (edit.consumed) {
            event.preventDefault();
            selection.current = {
              recordKey: props.recordKey,
              text: edit.text,
              start: edit.selectionStart,
              end: edit.selectionEnd,
              direction: edit.selectionDirection,
            };
            props.onChange(edit.text);
            // Pure motions may leave the controlled text unchanged.
            target.setSelectionRange(
              edit.selectionStart,
              edit.selectionEnd,
              edit.selectionDirection,
            );
            renderMode((n) => n + 1);
            return;
          }
          if (
            (event.key === "Enter" && event.altKey) ||
            (event.key.toLowerCase() === "j" && event.ctrlKey)
          ) {
            event.preventDefault();
            const start = target.selectionStart;
            const next = `${props.value.slice(0, start)}\n${props.value.slice(target.selectionEnd)}`;
            selection.current = {
              recordKey: props.recordKey,
              text: next,
              start: start + 1,
              end: start + 1,
              direction: "none",
            };
            props.onChange(next);
          } else if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            event.preventDefault();
            props.onSubmit();
          } else if (
            event.key === "Escape" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            props.onInterrupt();
          }
        }}
        aria-autocomplete={commandMode ? "list" : undefined}
        aria-haspopup={commandMode ? "listbox" : undefined}
        aria-controls={props.commandCount > 0 ? props.paletteId : undefined}
        aria-activedescendant={props.selectedCommandId}
        rows={3}
      />
      {readOnlyPeerSlug !== null ? (
        <p
          ref={statusRow}
          role="status"
          tabIndex={-1}
          className="peer-readonly-composer"
        >
          {t(PEER_READONLY_HINT, { slug: readOnlyPeerSlug })}
        </p>
      ) : null}
      {vimMode && readOnlyPeerSlug === null ? (
        <small className="field-note" aria-live="polite">
          {t(mode.current.mode === "insert" ? "Vim · Insert" : "Vim · Normal")}
        </small>
      ) : null}
    </>
  );
}
