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
