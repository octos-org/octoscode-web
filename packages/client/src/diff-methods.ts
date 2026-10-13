// Narrow AppUI extension, audited against Core rc13 (Keep Changes).
export const APPUI_DIFF_METHODS = {
  WORKSPACE_GET: "diff/workspace/get",
} as const;

/** Convenience alias matching the single-method consumers. */
export const DIFF_WORKSPACE_GET = APPUI_DIFF_METHODS.WORKSPACE_GET;
