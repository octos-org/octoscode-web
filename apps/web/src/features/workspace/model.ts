import type {
  SessionFileInfo,
  SessionListEntry,
  TaskListEntry,
  TokenCostUpdate,
} from "@octos-org/octoscode-client";

export type SessionActivityStatus =
  "idle" | "running" | "failed" | "done" | "unknown";

export interface SessionActivitySummary {
  status: SessionActivityStatus;
  taskCount: number;
  runningCount: number;
  failedCount: number;
  completedCount: number;
  updatedAt?: string;
  error?: string;
}

export interface WorkspaceProductState {
  sessionsAvailable: boolean;
  deleteAvailable: boolean;
  filesAvailable: boolean;
  loading: boolean;
  filesLoading: boolean;
  deletingSessionId: string | null;
  sessions: SessionListEntry[];
  files: SessionFileInfo[];
  tokenCost: TokenCostUpdate | null;
  activityAvailable: boolean;
  activityLoading: boolean;
  activityBySession: Record<string, SessionActivitySummary>;
  activityUpdatedAt: number | null;
  error: string | null;
}

export const EMPTY_WORKSPACE_PRODUCT: WorkspaceProductState = {
  sessionsAvailable: false,
  deleteAvailable: false,
  filesAvailable: false,
  loading: false,
  filesLoading: false,
  deletingSessionId: null,
  sessions: [],
  files: [],
  tokenCost: null,
  activityAvailable: false,
  activityLoading: false,
  activityBySession: {},
  activityUpdatedAt: null,
  error: null,
};

export function sortSessions(
  sessions: readonly SessionListEntry[],
): SessionListEntry[] {
  return [...sessions].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at ?? "");
    const rightTime = Date.parse(right.updated_at ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }
    if (Number.isFinite(leftTime)) return -1;
    if (Number.isFinite(rightTime)) return 1;
    return left.id.localeCompare(right.id);
  });
}

export function includeActiveSession(
  sessions: readonly SessionListEntry[],
  activeSessionId: string,
): SessionListEntry[] {
  return sessions.some((session) => session.id === activeSessionId)
    ? [...sessions]
    : [{ id: activeSessionId, message_count: 0 }, ...sessions];
}

export function sessionLabel(session: SessionListEntry): string {
  return session.title?.trim() || session.last_prompt?.trim() || session.id;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function mergeTokenCost(
  current: TokenCostUpdate | null,
  next: TokenCostUpdate,
): TokenCostUpdate {
  if (!current || current.sessionId !== next.sessionId) return next;
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined),
    ),
  } as TokenCostUpdate;
}

export function summarizeSessionTasks(
  tasks: readonly TaskListEntry[],
): SessionActivitySummary {
  let runningCount = 0;
  let failedCount = 0;
  let completedCount = 0;
  let hasUnknown = false;
  let updatedAt: string | undefined;
  let updatedAtMs = Number.NEGATIVE_INFINITY;

  for (const task of tasks) {
    if (task.state === "pending" || task.state === "running") {
      runningCount += 1;
    } else if (task.state === "failed" || task.state === "cancelled") {
      failedCount += 1;
    } else if (task.state === "completed") {
      completedCount += 1;
    } else {
      hasUnknown = true;
    }
    const candidate = Date.parse(task.updated_at);
    if (Number.isFinite(candidate) && candidate > updatedAtMs) {
      updatedAtMs = candidate;
      updatedAt = task.updated_at;
    }
  }

  const status: SessionActivityStatus = runningCount
    ? "running"
    : failedCount
      ? "failed"
      : hasUnknown
        ? "unknown"
        : tasks.length
          ? "done"
          : "idle";
  return {
    status,
    taskCount: tasks.length,
    runningCount,
    failedCount,
    completedCount,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function activityLabel(summary: SessionActivitySummary): string {
  if (summary.error) return "Unavailable";
  if (summary.runningCount && summary.failedCount) {
    return `${summary.runningCount} running · ${summary.failedCount} failed`;
  }
  if (summary.runningCount) return `${summary.runningCount} running`;
  if (summary.failedCount) return `${summary.failedCount} failed`;
  if (summary.status === "unknown") return "Needs review";
  if (summary.taskCount) return "Done";
  return "Idle";
}
