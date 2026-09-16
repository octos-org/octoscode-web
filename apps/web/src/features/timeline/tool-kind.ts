/**
 * A tool row's icon family, derived from the server-authored tool name.
 *
 * The glyph is decoration: the row still carries the tool's real name and its
 * status word, so an unknown tool simply falls back to the generic mark rather
 * than guessing. Matching is on whole words inside the name so `read_file` and
 * `fs.readFile` land together while `thread` does not.
 */
export type ToolKind = "shell" | "read" | "edit" | "search" | "web" | "generic";

const PATTERNS: readonly (readonly [ToolKind, RegExp])[] = [
  ["shell", /\b(shell|bash|sh|zsh|exec|run|command|terminal)\b/i],
  ["edit", /\b(edit|write|patch|apply|create|delete|move|rename|format)\b/i],
  ["read", /\b(read|cat|open|view|show|list|ls|stat|tree)\b/i],
  ["search", /\b(search|grep|find|glob|ripgrep|rg|lookup|query)\b/i],
  ["web", /\b(web|http|fetch|curl|browse|browser|url|download)\b/i],
];

/** Split camelCase and separators so `readFile` and `web_fetch` both match. */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._\-/:]+/g, " ")
    .trim();
}

export function toolKind(toolName: string): ToolKind {
  const text = words(toolName);
  if (!text) return "generic";
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return "generic";
}
