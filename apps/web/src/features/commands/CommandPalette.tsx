import type { WebCommandSpec } from "./registry.ts";
import { useUiText } from "../preferences/ui-text.tsx";

interface CommandPaletteProps {
  id: string;
  commands: readonly WebCommandSpec[];
  selectedIndex: number;
  onSelect: (command: WebCommandSpec) => void;
}

export function CommandPalette({
  id,
  commands,
  selectedIndex,
  onSelect,
}: CommandPaletteProps) {
  const t = useUiText();
  if (commands.length === 0) return null;

  return (
    <div
      className="command-palette"
      id={id}
      role="listbox"
      aria-label={t("Commands")}
    >
      {commands.map((command, index) => (
        <button
          className={index === selectedIndex ? "is-selected" : undefined}
          key={command.name}
          id={`${id}-${command.name}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
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
