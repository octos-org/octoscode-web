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

/** Hide incomplete inline markers without changing code or escapes. */
export function prepareStreamingMarkdown(text: string): string {
  let plain = "";
  let rendered = "";
  let open: string | null = null;
  for (const line of closeOpenFence(text).split(/(?<=\n)/)) {
    const marker = FENCE.exec(line)?.[1];
    if (open) {
      rendered += line;
      if (marker && marker[0] === open[0] && marker.length >= open.length)
        open = null;
    } else if (marker) {
      rendered += prepareInline(plain);
      plain = "";
      rendered += line;
      open = marker;
    } else {
      plain += line;
    }
  }
  return rendered + prepareInline(plain);
}

function prepareInline(text: string): string {
  let rendered = "";
  let consumed = 0;
  for (const match of text.matchAll(/(`+)([^`\n]*?)\1/g)) {
    const start = match.index;
    rendered += preparePlain(text.slice(consumed, start));
    rendered += match[0];
    consumed = start + match[0].length;
  }
  return rendered + preparePlain(text.slice(consumed));
}

function preparePlain(text: string): string {
  let prepared = text;
  for (const marker of ["**", "__", "~~", "*", "`"]) {
    prepared = hideOddMarker(prepared, marker);
  }
  return prepared;
}

function hideOddMarker(text: string, marker: string): string {
  const positions: number[] = [];
  for (let index = 0; index <= text.length - marker.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (!text.startsWith(marker, index)) continue;
    if (
      marker === "*" &&
      (text[index - 1] === "*" || text[index + 1] === "*")
    ) {
      continue;
    }
    positions.push(index);
    index += marker.length - 1;
  }
  if (positions.length % 2 === 0) return text;
  const last = positions.at(-1)!;
  return text.slice(0, last) + text.slice(last + marker.length);
}
