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

function validPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /\p{Cc}/u.test(value) ||
    value.length > 16_384
  ) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  return !normalized.split("/").includes("..") &&
    !normalized.startsWith("up/") &&
    !normalized.startsWith("pf/")
    ? normalized
    : null;
}
