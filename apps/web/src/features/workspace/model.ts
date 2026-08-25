import type {
  SessionFileInfo,
  SessionListEntry,
  TokenCostUpdate,
} from "@octos-org/octoscode-client";

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
