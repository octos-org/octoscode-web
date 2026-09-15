import type {
  DiffPreviewFile,
  DiffPreviewLine,
} from "@octos-org/octoscode-client";
import {
  highlightToTokens,
  type HighlightToken,
} from "../markdown/highlight.ts";

export interface DiffToken extends HighlightToken {
  changed: boolean;
}

interface Range {
  start: number;
  end: number;
}

export function diffKind(kind: string): "added" | "removed" | "context" {
  if (["added", "insert", "inserted"].includes(kind)) return "added";
  if (["removed", "delete", "deleted"].includes(kind)) return "removed";
  return "context";
}

/** Decoration is optional; these limits never truncate the server preview. */
export function canDecorateDiff(files: DiffPreviewFile[]): boolean {
  let lines = 0;
  let characters = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        lines += 1;
        characters += line.content.length;
        if (lines > 400 || characters > 40_000 || line.content.length > 2_000)
          return false;
      }
    }
  }
  return true;
}

export function diffLanguage(path: string): string | undefined {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if ([".bashrc", ".zshrc", ".bash_profile"].includes(name)) return "sh";
  return name.includes(".") ? name.split(".").at(-1) : undefined;
}

export function decorateDiffHunk(
  lines: DiffPreviewLine[],
  language: string | undefined,
): DiffToken[][] {
  const syntax = new Map<number, HighlightToken[]>();
  // Hunks can begin midway through a lexical construct. Highlight only the
  // supplied context, and keep the original text authoritative in every case.
  for (const side of ["removed", "added"] as const) {
    const indexes = lines.flatMap((line, index) =>
      diffKind(line.kind) === (side === "removed" ? "added" : "removed")
        ? []
        : [index],
    );
    if (!indexes.length) continue;
    const highlighted = highlightToTokens(
      indexes.map((index) => lines[index]!.content).join("\n"),
      language,
    );
    if (highlighted?.length !== indexes.length) continue;
    for (const [position, index] of indexes.entries()) {
      const tokens = highlighted[position]!;
      // Shiki splits line endings. If the wire line contains CR/LF or any
      // other normalization, display that line verbatim instead of losing it.
      if (
        tokens.map((token) => token.content).join("") === lines[index]!.content
      )
        syntax.set(index, tokens);
    }
  }

  const ranges = new Map<number, Range[]>();
  let start = 0;
  while (start < lines.length) {
    if (diffKind(lines[start]!.kind) === "context") {
      start += 1;
      continue;
    }
    let end = start;
    const removed: number[] = [];
    const added: number[] = [];
    while (end < lines.length && diffKind(lines[end]!.kind) !== "context") {
      (diffKind(lines[end]!.kind) === "removed" ? removed : added).push(end);
      end += 1;
    }
    // Unequal blocks don't establish which lines replace one another. Keep
    // their existing line-level markings rather than imply a false pairing.
    if (removed.length === added.length) {
      for (let pair = 0; pair < removed.length; pair += 1) {
        const before = removed[pair]!;
        const after = added[pair]!;
        const changes = changedWords(
          lines[before]!.content,
          lines[after]!.content,
        );
        if (changes) {
          ranges.set(before, changes[0]);
          ranges.set(after, changes[1]);
        }
      }
    }
    start = end;
  }
  return lines.map((line, index) =>
    annotateTokens(
      syntax.get(index) ?? [{ content: line.content, className: "" }],
      ranges.get(index) ?? [],
    ),
  );
}

function changedWords(
  before: string,
  after: string,
): [Range[], Range[]] | undefined {
  // Unicode-aware words and code points preserve surrogate pairs and exact
  // whitespace. A bounded LCS isolates multiple small edits on one line.
  const words = (text: string) =>
    text.match(/[\p{L}\p{N}\p{M}_$]+|\s+|[^\p{L}\p{N}\p{M}_$\s]/gu) ?? [];
  const left = words(before);
  const right = words(after);
  if (!left.length || !right.length || left.length > 160 || right.length > 160)
    return undefined;
  const width = right.length + 1;
  const matrix = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i * width + j] =
        left[i] === right[j]
          ? 1 + matrix[(i + 1) * width + j + 1]!
          : Math.max(matrix[(i + 1) * width + j]!, matrix[i * width + j + 1]!);
    }
  }
  const keptLeft = new Set<number>();
  const keptRight = new Set<number>();
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      keptLeft.add(i);
      keptRight.add(j);
      shared += left[i]!.trim().length;
      i += 1;
      j += 1;
    } else if (matrix[(i + 1) * width + j]! >= matrix[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  if (shared / Math.max(before.trim().length, after.trim().length, 1) < 0.25)
    return undefined;
  const changed = (tokens: string[], kept: Set<number>) => {
    let offset = 0;
    const result: Range[] = [];
    for (const [index, content] of tokens.entries()) {
      const end = offset + content.length;
      if (!kept.has(index)) {
        const last = result.at(-1);
        if (last?.end === offset) last.end = end;
        else result.push({ start: offset, end });
      }
      offset = end;
    }
    return result;
  };
  return [changed(left, keptLeft), changed(right, keptRight)];
}

function annotateTokens(
  tokens: HighlightToken[],
  ranges: Range[],
): DiffToken[] {
  const result: DiffToken[] = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.content.length;
    const cuts = [offset, end];
    for (const range of ranges) {
      if (range.start > offset && range.start < end) cuts.push(range.start);
      if (range.end > offset && range.end < end) cuts.push(range.end);
    }
    cuts.sort((a, b) => a - b);
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const start = cuts[index]!;
      const stop = cuts[index + 1]!;
      result.push({
        content: token.content.slice(start - offset, stop - offset),
        className: token.className,
        changed: ranges.some(
          (range) => range.start <= start && range.end >= stop,
        ),
      });
    }
    offset = end;
  }
  return result;
}
