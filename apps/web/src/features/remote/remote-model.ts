import type { WorkspaceCatalogSession } from "../session/workspace-session-catalog.ts";
import type {
  BackgroundSessionSnapshot,
  BackgroundWaitingFor,
  WatchedSessionRef,
} from "../session/use-octos-session.ts";
import { workspaceName } from "../workspace/workspace-recents.ts";

/**
 * The phone overview answers three questions on one screen: what is waiting
 * for me, what is running, and what finished lately. Server listing
 * (`active_turn`) says what runs anywhere; live records (background watches
 * and the open session) add what a running session is waiting on and how a
 * turn ended. A row is never promoted past what that evidence says.
 */
export type RemoteRowState =
  "waiting" | "running" | "completed" | "failed" | "idle";

export interface RemoteRow {
  key: string;
  sessionId: string;
  profileId: string;
  workspaceRoot: string;
  folderName: string;
  title: string | null;
  updatedAt: number | null;
  state: RemoteRowState;
  waitingFor: BackgroundWaitingFor | null;
}

export interface RemoteOverview {
  waiting: RemoteRow[];
  running: RemoteRow[];
  recent: RemoteRow[];
  /** Running sessions whose live state is not observed yet. */
  unwatched: WatchedSessionRef[];
}

/** The open session's live state, in the background snapshot's terms. */
export type LiveSessionSnapshot = Pick<
  BackgroundSessionSnapshot,
  | "sessionId"
  | "profileId"
  | "workspaceRoot"
  | "state"
  | "waitingFor"
  | "firstPrompt"
>;

export const RECENT_LIMIT = 6;

export function remoteKey(ref: {
  workspaceRoot: string;
  profileId: string;
  sessionId: string;
}): string {
  return `${ref.workspaceRoot}\n${ref.profileId}\n${ref.sessionId}`;
}

export function remoteOverview(input: {
  catalog: readonly WorkspaceCatalogSession[];
  live: readonly LiveSessionSnapshot[];
}): RemoteOverview {
  const live = new Map(input.live.map((entry) => [remoteKey(entry), entry]));
  const rows = new Map<string, RemoteRow>();
  for (const session of input.catalog) {
    const key = remoteKey(session);
    const observed = live.get(key);
    rows.set(key, {
      key,
      sessionId: session.sessionId,
      profileId: session.profileId,
      workspaceRoot: session.workspaceRoot,
      folderName: workspaceName(session.workspaceRoot),
      title:
        session.title ?? session.lastPrompt ?? observed?.firstPrompt ?? null,
      updatedAt: session.updatedAt,
      state: rowState(observed, session.activeTurn === true),
      waitingFor: observed?.waitingFor ?? null,
    });
  }
  // A live record the listing has not caught up with (a turn just started
  // from this phone) still belongs on the overview.
  for (const [key, observed] of live) {
    if (rows.has(key)) continue;
    rows.set(key, {
      key,
      sessionId: observed.sessionId,
      profileId: observed.profileId,
      workspaceRoot: observed.workspaceRoot,
      folderName: workspaceName(observed.workspaceRoot),
      title: observed.firstPrompt,
      updatedAt: null,
      state: rowState(observed, false),
      waitingFor: observed.waitingFor,
    });
  }
  const newestFirst = (left: RemoteRow, right: RemoteRow) =>
    (right.updatedAt ?? Number.POSITIVE_INFINITY) -
    (left.updatedAt ?? Number.POSITIVE_INFINITY);
  const all = [...rows.values()].sort(newestFirst);
  return {
    waiting: all.filter((row) => row.state === "waiting"),
    running: all.filter((row) => row.state === "running"),
    recent: all
      .filter(
        (row) =>
          row.state === "completed" ||
          row.state === "failed" ||
          row.state === "idle",
      )
      .slice(0, RECENT_LIMIT),
    unwatched: all
      .filter((row) => row.state === "running" && !live.has(row.key))
      .map(({ sessionId, profileId, workspaceRoot }) => ({
        sessionId,
        profileId,
        workspaceRoot,
      })),
  };
}

function rowState(
  observed: LiveSessionSnapshot | undefined,
  listedActive: boolean,
): RemoteRowState {
  if (observed?.waitingFor || observed?.state === "waiting") return "waiting";
  if (observed?.state === "running") return "running";
  // The listing is server-wide truth about a live turn; a stale record that
  // has not seen the new turn yet must not hide it.
  if (listedActive) return "running";
  if (observed?.state === "completed") return "completed";
  if (observed?.state === "failed") return "failed";
  return "idle";
}
