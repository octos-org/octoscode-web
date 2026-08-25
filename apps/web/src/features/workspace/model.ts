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
  activityTasksBySession: Record<string, TaskListEntry[]>;
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
  activityTasksBySession: {},
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

export type ActivityFilter = "all" | "running" | "failed" | "done";

export interface WorkspaceActivityRow {
  sessionId: string;
  sessionTitle: string;
  taskId: string;
  title: string;
  detail: string;
  state: SessionActivityStatus;
  updatedAt?: string;
  searchText: string;
}

export interface WorkspaceActivityModel {
  rows: WorkspaceActivityRow[];
  counts: Record<ActivityFilter, number>;
}

export function buildWorkspaceActivityModel(
  state: WorkspaceProductState,
  query: string,
  filter: ActivityFilter,
): WorkspaceActivityModel {
  const sessionById = new Map(
    state.sessions.map((session) => [session.id, session]),
  );
  const allRows = Object.entries(state.activityTasksBySession).flatMap(
    ([sessionId, tasks]) => {
      const session = sessionById.get(sessionId);
      const sessionTitle = session ? sessionLabel(session) : sessionId;
      return tasks.map((task): WorkspaceActivityRow => {
        const state = taskActivityStatus(task);
        const title =
          task.summary?.trim() || task.role?.trim() || task.tool_name;
        const detail = [task.role, task.current_phase, task.status, task.error]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(" · ");
        return {
          sessionId,
          sessionTitle,
          taskId: task.id,
          title,
          detail,
          state,
          ...(task.updated_at ? { updatedAt: task.updated_at } : {}),
          searchText: [
            sessionId,
            sessionTitle,
            task.id,
            title,
            detail,
            task.tool_name,
            task.state,
          ]
            .join(" ")
            .toLocaleLowerCase(),
        };
      });
    },
  );
  allRows.sort((left, right) => {
    const priority = { running: 0, failed: 1, unknown: 2, done: 3, idle: 4 };
    const stateOrder = priority[left.state] - priority[right.state];
    if (stateOrder) return stateOrder;
    const leftTime = Date.parse(left.updatedAt ?? "");
    const rightTime = Date.parse(right.updatedAt ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title);
  });
  const counts = {
    all: allRows.length,
    running: allRows.filter((row) => row.state === "running").length,
    failed: allRows.filter((row) => row.state === "failed").length,
    done: allRows.filter((row) => row.state === "done").length,
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return {
    counts,
    rows: allRows.filter(
      (row) =>
        (filter === "all" || row.state === filter) &&
        (!normalizedQuery || row.searchText.includes(normalizedQuery)),
    ),
  };
}

export function recentSessionTasks(
  tasks: readonly TaskListEntry[],
  limit = 50,
): TaskListEntry[] {
  return [...tasks]
    .sort((left, right) => {
      const leftTime = Date.parse(left.updated_at);
      const rightTime = Date.parse(right.updated_at);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return rightTime - leftTime;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}

function taskActivityStatus(task: TaskListEntry): SessionActivityStatus {
  if (task.state === "pending" || task.state === "running") return "running";
  if (task.state === "failed" || task.state === "cancelled") return "failed";
  if (task.state === "completed") return "done";
  return "unknown";
}
