import { useEffect, useRef } from "react";
import type { WebCommandSpec } from "./registry.ts";
import { useUiText } from "../preferences/ui-text.tsx";

interface CommandPaletteProps {
  id: string;
  commands: readonly WebCommandSpec[];
  selectedIndex: number;
  onSelect: (command: WebCommandSpec) => void;
  onSelectedIndexChange: (index: number) => void;
  onDismiss: () => void;
}

export function CommandPalette({
  id,
  commands,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
  onDismiss,
}: CommandPaletteProps) {
  const t = useUiText();
  const selected = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectedName = commands[selectedIndex]?.name;
  useEffect(() => {
    if (list.current?.contains(document.activeElement))
      selected.current?.focus({ preventScroll: true });
    selected.current?.scrollIntoView({ block: "nearest" });
  }, [selectedName]);
  if (commands.length === 0) return null;

  return (
    <div
      ref={list}
      className="command-palette"
      id={id}
      role="listbox"
      aria-label={t("Commands")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          onSelectedIndexChange(
            (selectedIndex +
              (event.key === "ArrowDown" ? 1 : -1) +
              commands.length) %
              commands.length,
          );
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onSelectedIndexChange(event.key === "Home" ? 0 : commands.length - 1);
        }
      }}
    >
      {commands.map((command, index) => (
        <button
          ref={index === selectedIndex ? selected : undefined}
          className={index === selectedIndex ? "is-selected" : undefined}
          key={command.name}
          id={`${id}-${command.name}`}
          type="button"
          role="option"
          tabIndex={index === selectedIndex ? 0 : -1}
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => onSelectedIndexChange(index)}
          onClick={() => {
            onDismiss();
            onSelect(command);
          }}
        >
          <span>
            <strong>/{command.name}</strong>
            <small>{t(command.description)}</small>
          </span>
          <em>{t(command.category)}</em>
        </button>
      ))}
    </div>
  );
}
