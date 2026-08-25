import type { WebCommandSpec } from "./registry.ts";

interface CommandPaletteProps {
  commands: readonly WebCommandSpec[];
  selectedIndex: number;
  onSelect: (command: WebCommandSpec) => void;
}

export function CommandPalette({
  commands,
  selectedIndex,
  onSelect,
}: CommandPaletteProps) {
  if (commands.length === 0) return null;

  return (
    <div className="command-palette" role="listbox" aria-label="Commands">
      {commands.map((command, index) => (
        <button
          className={index === selectedIndex ? "is-selected" : undefined}
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
        >
          <span>
            <strong>/{command.name}</strong>
            <small>{command.description}</small>
          </span>
          <em>{command.category}</em>
        </button>
      ))}
    </div>
  );
}
