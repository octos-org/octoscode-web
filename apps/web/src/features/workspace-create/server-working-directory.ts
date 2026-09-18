/** Project the opened result into the first-entry shape (pure). */
export function serverWorkingDirectoryEntry(
  workspaceRoot: string | null,
  reported: boolean,
): {
  label: string;
  path: string | null;
  order: "first";
  requiresExplicitPath: boolean;
} {
  const trimmed = workspaceRoot?.trim() ?? "";
  if (reported && trimmed) {
    return {
      label: "Server's working directory",
      path: trimmed,
      order: "first",
      requiresExplicitPath: false,
    };
  }
  return {
    label: "Server's working directory (path not reported)",
    path: null,
    order: "first",
    requiresExplicitPath: true,
  };
}
