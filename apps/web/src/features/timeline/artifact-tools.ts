import { isWorkspaceRelativePath } from "./session-file-read.ts";

/** A file path explicitly written by a tool; never inferred from result prose. */
export function writtenArtifactPath(
  toolName: string,
  argumentsJson: string,
): string {
  if (!["write_file", "edit_file"].includes(toolName)) return "";
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return "";
    const row = parsed as Record<string, unknown>;
    for (const key of ["path", "file_path", "filepath", "filePath", "file"]) {
      const value = validPath(row[key]);
      if (value) return value;
    }
  } catch {
    // Core's arguments_preview may be a key/value rendering or a truncated
    // large write body. Decode only the explicit field, never result prose.
    const field =
      /(?:^|[,{]\s*)"?(?:path|file_path|filepath|filePath|file)"?\s*:\s*("(?:\\.|[^"\\])*")/.exec(
        argumentsJson,
      );
    if (!field) return "";
    try {
      return validPath(JSON.parse(field[1]!)) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function writtenArtifactResultPath(
  toolName: string,
  outputPreview: string,
): string {
  if (!["write_file", "edit_file"].includes(toolName)) return "";
  const match = /^(?:Successfully wrote|Updated|Created|Edited)\s+(.+)$/i.exec(
    outputPreview.trim(),
  );
  return match ? (validPath(match[1]) ?? "") : "";
}

function validPath(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() &&
    !/\p{Cc}/u.test(value) &&
    value.length <= 16_384 &&
    isWorkspaceRelativePath(value)
    ? value
    : null;
}
