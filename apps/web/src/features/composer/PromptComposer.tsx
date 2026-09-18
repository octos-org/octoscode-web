import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import { commandSuggestions } from "../commands/registry.ts";
import { CommandPalette } from "../commands/CommandPalette.tsx";
import {
  TurnStopButton,
  type TurnStopButtonProps,
} from "../product-controls/TurnStopButton.tsx";
import { ArrowUpIcon } from "../../ui/Icon.tsx";
import styles from "./PromptComposer.module.css";

interface PromptComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (override?: string) => void;
  capabilities: UiProtocolCapabilities | undefined;
  disabled: boolean;
  sendDisabled?: boolean;
  focusOnMount: boolean;
  placeholder: string;
  turn: TurnStopButtonProps;
  controls: ReactNode;
  contextPercent: number | null;
  recoveryHint?: ReactNode;
}

/** Editing and keyboard behavior stay mounted together, including after a takeover. */
export function PromptComposer({
  inputRef,
  draft,
  onDraftChange,
  onSubmit,
  capabilities,
  disabled,
  sendDisabled = false,
  focusOnMount,
  placeholder,
  turn,
  controls,
  contextPercent,
  recoveryHint,
}: PromptComposerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialFocusDone = useRef(false);
  const commands =
    dismissed || disabled ? [] : commandSuggestions(draft, capabilities);
  const selected =
    commands[Math.min(selectedIndex, Math.max(0, commands.length - 1))];
  const paletteId = "composer-command-palette";
  useEffect(() => {
    if (!focusOnMount || initialFocusDone.current) return;
    const frame = requestAnimationFrame(() => {
      initialFocusDone.current = true;
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount, inputRef]);
  useEffect(() => {
    // A touch takeover can finish without opening another software keyboard.
    // Give assistive technology a reading position when the old control vanished.
    if (!focusOnMount && document.activeElement === document.body)
      surfaceRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);
  const edit = (value: string) => {
    onDraftChange(value);
    setSelectedIndex(0);
    setDismissed(false);
  };
  return (
    <>
      <div
        className="composer"
        ref={surfaceRef}
        role="group"
        aria-label="Message composer"
        tabIndex={-1}
      >
        <CommandPalette
          id={paletteId}
          commands={commands}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          onDismiss={() => {
            setDismissed(true);
            setSelectedIndex(0);
            inputRef.current?.focus();
          }}
          onSelect={(command) => {
            if (!sendDisabled) onSubmit(`/${command.name}`);
          }}
        />
        <textarea
          ref={inputRef}
          aria-label="Message Octos"
          aria-describedby="composer-hint"
          value={draft}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            if (
              commands.length &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              setSelectedIndex(
                (current) =>
                  (current +
                    (event.key === "ArrowDown" ? 1 : commands.length - 1)) %
                  commands.length,
              );
            } else if (commands.length && event.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
              setSelectedIndex(0);
            } else if (
              (event.key === "Enter" && event.altKey) ||
              (event.key.toLowerCase() === "j" && event.ctrlKey)
            ) {
              event.preventDefault();
              const target = event.currentTarget;
              const start = target.selectionStart;
              edit(
                `${draft.slice(0, start)}\n${draft.slice(target.selectionEnd)}`,
              );
              requestAnimationFrame(() =>
                target.setSelectionRange(start + 1, start + 1),
              );
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey
            ) {
              event.preventDefault();
              if (!sendDisabled)
                onSubmit(selected ? `/${selected.name}` : undefined);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={styles.field}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={commands.length ? paletteId : undefined}
          aria-activedescendant={
            selected ? `${paletteId}-${selected.name}` : undefined
          }
          rows={3}
        />
        <div className="composer-footer">
          {controls}
          <div className="composer-actions">
            {contextPercent !== null ? (
              <span
                className={styles.contextUsage}
                title={`${contextPercent}% of the model context window used`}
              >
                {contextPercent}%
              </span>
            ) : null}
            <TurnStopButton {...turn} />
            {!turn.activeTurnId || draft.trim() ? (
              <button
                className="send-button"
                type="button"
                onClick={() => {
                  onSubmit();
                  inputRef.current?.focus();
                }}
                disabled={disabled || sendDisabled || !draft.trim()}
                aria-label={turn.activeTurnId ? "Queue prompt" : "Send prompt"}
                title={turn.activeTurnId ? "Queue prompt" : "Send prompt"}
              >
                <ArrowUpIcon size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div id="composer-hint" className={styles.hint}>
        {recoveryHint ?? (
          <span>
            {turn.activeTurnId
              ? "Messages you send now will join the queue."
              : "Enter to send · Shift + Enter for a new line"}
          </span>
        )}
        <span>Type / for commands</span>
      </div>
    </>
  );
}
