/**
 * Close a code fence the model has opened but not yet closed.
 *
 * Markdown is rendered while a reply streams, and mid-stream a fenced block is
 * usually still open: the model has written "```ts" and some code, but not the
 * closing fence. CommonMark treats an unclosed fence as running to the end of
 * the document, which is right for the finished text but renders a
 * half-written block as code and nothing else — and a fence that is still being
 * typed ("``") as a stray paragraph. Appending the matching closer for display
 * keeps the in-progress block looking like the code block it is becoming. The
 * stored text is never changed; this is only what is rendered.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function closeOpenFence(text: string): string {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    if (open === null) {
      open = marker;
    } else if (marker[0] === open[0] && marker.length >= open.length) {
      // A closing fence must use the same character, at least as many times.
      open = null;
    }
  }
  if (open === null) return text;
  return `${text}${text.endsWith("\n") ? "" : "\n"}${open}`;
}
