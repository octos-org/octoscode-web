/** A Session without a server title reads as its first prompt's first line. */
export function sessionTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0]!.trim();
  const characters = Array.from(firstLine);
  return characters.length > 48
    ? `${characters.slice(0, 48).join("").trimEnd()}…`
    : firstLine;
}
