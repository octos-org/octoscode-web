import { useMemo } from "react";
import type { SessionOpened, WorkMode } from "@octos-org/octoscode-client";
import type { KnownSessionRef } from "../session/known-session-registry.ts";
import {
  mergeWorkspaceSessionRows,
  type WorkspaceCatalogSession,
  type WorkspaceSessionCatalogSnapshot,
} from "../session/workspace-session-catalog.ts";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  workspaceName,
  type RecentWorkspace,
} from "../workspace/workspace-recents.ts";
import { formatRelativeTime } from "./relative-time.ts";
import {
  ProductSidebar,
  type ProductSidebarProps,
  type ProductSidebarSession,
  type ProductSidebarWorkspace,
} from "./ProductSidebar.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import type { PeerRosterEntry } from "../peers/peer-roster.ts";

interface SessionSidebarProps extends Omit<ProductSidebarProps, "workspaces"> {
  peerRoster?: readonly PeerRosterEntry[] | undefined;
  /**
   * Native peer Sessions the server's blackboard lists (`peer/gather`), by
   * identity. A listed peer with no master on this page stays in its
   * workspace list, titled by its name rather than its kickoff text.
   */
  peerDirectory?: ReadonlyMap<string, { readonly name: string }> | undefined;
  recentWorkspaces: readonly RecentWorkspace[];
  knownSessions: readonly KnownSessionRef[];
  /**
   * The server's per-workspace catalog (`session/list { cwd, profile_id }`).
   * Absent when the server cannot list per workspace: the sidebar then shows
   * only the refs this tab opened, exactly as before.
   */
  sessionCatalog?: WorkspaceSessionCatalogSnapshot | undefined;
  activeWorkspacePath: string;
  opened: SessionOpened | null;
  collapsedWorkspaceIds: ReadonlySet<string>;
  backgroundTurns: readonly {
    workspaceRoot: string;
    profileId: string;
    sessionId: string;
    state: "running" | "waiting" | "completed" | "failed";
    firstPrompt: string | null;
  }[];
  hasPendingInteraction: boolean;
  recoveryPhase: string | null;
  activeTurnId: string | null;
  turnStarting: boolean;
  timeline: readonly TimelineEntry[];
  openingSessionId: string | null;
  sessionError?: string | null | undefined;
  /**
   * Chat / Code navigation (two-modes flag). Absent: one list, as before.
   * Code lists every workspace but leaves chats out; Chat lists only chats.
   */
  workMode?: WorkMode | undefined;
  /** The server's chat listing, each chat with its own workspace. */
  chatSessions?: readonly WorkspaceCatalogSession[] | undefined;
  chatCatalogError?: string | undefined;
}

/** Session rows are presentation of server-confirmed references in this tab. */
export function SessionSidebar({
  peerRoster,
  peerDirectory,
  recentWorkspaces,
  knownSessions,
  sessionCatalog,
  activeWorkspacePath,
  opened,
  collapsedWorkspaceIds,
  backgroundTurns,
  hasPendingInteraction,
  recoveryPhase,
  activeTurnId,
  turnStarting,
  timeline,
  openingSessionId,
  sessionError,
  selectedSessionId,
  workMode,
  chatSessions,
  chatCatalogError,
  ...sidebarProps
}: SessionSidebarProps) {
  const t = useUiText();
  const terminal = useMemo(
    () => timeline.findLast((entry) => entry.latestTurnOutcome),
    [timeline],
  );
  const failedSteps = timeline.some(
    (entry) =>
      entry.kind === "tool" &&
      entry.status === "error" &&
      entry.turnId === terminal?.turnId,
  );
  const activePromptTitle = useMemo(() => {
    const firstPrompt = timeline.find(
      (entry) => entry.kind === "user" && entry.body.trim(),
    )?.body;
    return firstPrompt ? sessionTitleFromPrompt(firstPrompt) : null;
  }, [timeline]);
  const workspaces = useMemo(() => {
    let activeStatus: Pick<ProductSidebarSession, "status" | "statusLabel"> =
      {};
    if (hasPendingInteraction) {
      activeStatus = { status: "waiting", statusLabel: "Waiting for input" };
    } else if (recoveryPhase) {
      activeStatus = {
        status: "waiting",
        statusLabel:
          recoveryPhase === "checking"
            ? "Checking response status"
            : "Response status uncertain",
      };
    } else if (activeTurnId) {
      activeStatus = {
        status: "running",
        statusLabel: turnStarting ? "Starting" : "Working",
      };
    } else if (terminal) {
      activeStatus = {
        status:
          terminal.latestTurnOutcome === "completed"
            ? failedSteps
              ? "attention"
              : "completed"
            : "failed",
        statusLabel:
          terminal.latestTurnOutcome === "completed"
            ? failedSteps
              ? t("Completed with failed steps")
              : t("Completed")
            : terminal.latestTurnOutcome === "interrupted"
              ? "Stopped"
              : "Failed",
      };
    }
    const backgroundBySession = new Map(
      backgroundTurns.map((turn) => [
        workspaceSessionKey(turn.workspaceRoot, turn.profileId, turn.sessionId),
        turn,
      ]),
    );
    const peerSessionIds = new Set(
      (peerRoster ?? []).map((peer) => peer.identity),
    );
    const projectRow = (
      workspaceRoot: string,
      item: { sessionId: string; profileId: string; title: string },
      updatedAt: number | undefined,
    ): ProductSidebarSession => {
      const productId = workspaceSessionKey(
        workspaceRoot,
        item.profileId,
        item.sessionId,
      );
      const active = productId === selectedSessionId;
      const background = backgroundBySession.get(productId);
      const updatedLabel = formatRelativeTime(updatedAt);
      return {
        id: productId,
        title: item.title,
        opening: productId === openingSessionId,
        ...(updatedLabel ? { updatedLabel } : {}),
        ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
        ...(active
          ? activeStatus
          : background
            ? backgroundSessionStatus(background.state)
            : {}),
      };
    };
    const openedChat = opened?.work_mode === "chat";
    if (workMode === "chat") {
      const rows = new Map<
        string,
        {
          sessionId: string;
          profileId: string;
          workspaceRoot: string;
          title: string | null;
          updatedAt: number;
        }
      >();
      const remember = (row: {
        sessionId: string;
        profileId: string;
        workspaceRoot: string;
        title: string | null;
        updatedAt: number;
      }) => {
        const key = `${row.profileId}\n${row.sessionId}`;
        const previous = rows.get(key);
        rows.set(key, {
          ...row,
          title: previous?.title ?? row.title,
          updatedAt: Math.max(previous?.updatedAt ?? 0, row.updatedAt),
        });
      };
      for (const row of chatSessions ?? [])
        remember({
          ...row,
          title: row.title ?? row.lastPrompt,
          updatedAt: row.updatedAt ?? 0,
        });
      for (const ref of knownSessions)
        if (ref.workMode === "chat")
          remember({ ...ref, title: null, updatedAt: ref.lastOpenedAt });
      if (openedChat && opened.workspace_root)
        remember({
          sessionId: opened.session_id,
          profileId: opened.active_profile_id ?? "",
          workspaceRoot: opened.workspace_root,
          title: null,
          updatedAt: Date.now(),
        });
      const chats: ProductSidebarWorkspace = {
        id: "chats",
        label: t("Chats"),
        expanded: true,
        sessionCatalogStatus: chatCatalogError ? "error" : "loaded",
        ...(chatCatalogError ? { sessionCatalogError: chatCatalogError } : {}),
        sessions: [...rows.values()]
          .filter((row) => !peerSessionIds.has(row.sessionId))
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .map((row) => {
            const selected =
              workspaceSessionKey(
                row.workspaceRoot,
                row.profileId,
                row.sessionId,
              ) === selectedSessionId;
            return projectRow(
              row.workspaceRoot,
              {
                ...row,
                title:
                  row.title ??
                  (selected ? activePromptTitle : null) ??
                  t("New chat"),
              },
              row.updatedAt,
            );
          }),
      };
      return [chats];
    }
    // Code (or one list without the flag): chats this tab opened stay in Chat.
    const codeSessions =
      workMode === "code"
        ? knownSessions.filter((ref) => ref.workMode !== "chat")
        : knownSessions;
    const workspaces = knownSessionWorkspaces(
      recentWorkspaces,
      codeSessions,
      workMode === "code" && openedChat ? "" : activeWorkspacePath,
    );
    const projected: ProductSidebarWorkspace[] = workspaces.map((workspace) => {
      const isActiveWorkspace = workspace.path === activeWorkspacePath;
      // A workspace the server has not attested a scoped listing for keeps
      // the tab-known behavior exactly (see WorkspaceCatalogState).
      const listed = sessionCatalog?.get(workspace.path);
      const catalog = listed?.status === "unscoped" ? undefined : listed;
      const sourceSessions = mergeWorkspaceSessionRows(
        codeSessions.filter((item) => item.workspaceRoot === workspace.path),
        catalog?.sessions ?? [],
      )
        .map((item) => {
          const productId = workspaceSessionKey(
            workspace.path,
            item.profileId,
            item.sessionId,
          );
          const selected = productId === selectedSessionId;
          const backgroundPrompt =
            backgroundBySession.get(productId)?.firstPrompt;
          const peerName = peerDirectory?.get(item.sessionId)?.name;
          return {
            sessionId: item.sessionId,
            profileId: item.profileId,
            title:
              (peerName ? t("Peer {value0}", { value0: peerName }) : null) ??
              item.title ??
              (selected
                ? activePromptTitle
                : backgroundPrompt
                  ? sessionTitleFromPrompt(backgroundPrompt)
                  : null) ??
              (selected && sessionError ? item.sessionId : null) ??
              t("New session"),
            updatedAt: item.updatedAt,
          };
        })
        .filter((item) => !peerSessionIds.has(item.sessionId));
      if (
        isActiveWorkspace &&
        opened &&
        !(workMode === "code" && openedChat) &&
        !peerSessionIds.has(opened.session_id) &&
        !sourceSessions.some(
          (item) =>
            item.sessionId === opened?.session_id &&
            item.profileId === (opened.active_profile_id ?? ""),
        )
      ) {
        sourceSessions.unshift({
          sessionId: opened.session_id,
          profileId: opened.active_profile_id ?? "",
          title: activePromptTitle ?? t("New session"),
          updatedAt: Date.now(),
        });
      }
      return {
        id: workspace.id,
        label: workspace.name,
        path: workspace.path,
        expanded: !collapsedWorkspaceIds.has(workspace.id),
        // With the server's per-workspace catalog these rows are the
        // workspace's whole history; without it, only the refs opened in
        // this tab.
        sessionCatalogStatus:
          catalog?.status === "loaded" || catalog?.status === "error"
            ? catalog.status
            : "known-only",
        ...(catalog?.status === "error" && catalog.error
          ? { sessionCatalogError: catalog.error }
          : {}),
        sessions: sourceSessions.map((item) =>
          projectRow(workspace.path, item, item.updatedAt),
        ),
      };
    });
    return projected;
  }, [
    selectedSessionId,
    activeTurnId,
    activeWorkspacePath,
    collapsedWorkspaceIds,
    recoveryPhase,
    hasPendingInteraction,
    knownSessions,
    sessionCatalog,
    recentWorkspaces,
    turnStarting,
    backgroundTurns,
    opened,
    terminal,
    activePromptTitle,
    openingSessionId,
    peerRoster,
    peerDirectory,
    sessionError,
    workMode,
    chatSessions,
    chatCatalogError,
    t,
  ]);

  return (
    <ProductSidebar
      {...sidebarProps}
      selectedSessionId={selectedSessionId}
      peerRoster={peerRoster}
      workspaces={workspaces}
    />
  );
}

function workspaceSessionKey(
  workspacePath: string,
  profileId: string,
  sessionId: string,
): string {
  return JSON.stringify([workspacePath, profileId, sessionId]);
}

function knownSessionWorkspaces(
  workspaces: readonly RecentWorkspace[],
  sessions: readonly KnownSessionRef[],
  activePath: string,
): RecentWorkspace[] {
  const projected = new Map(
    workspaces.map((workspace) => [workspace.path, { ...workspace }]),
  );
  for (const session of sessions) {
    const current = projected.get(session.workspaceRoot);
    if (current) continue;
    projected.set(session.workspaceRoot, {
      id: session.workspaceRoot,
      name: workspaceName(session.workspaceRoot),
      path: session.workspaceRoot,
      lastOpenedAt: session.lastOpenedAt,
    });
  }
  if (activePath && !projected.has(activePath)) {
    projected.set(activePath, {
      id: activePath,
      name: workspaceName(activePath),
      path: activePath,
      lastOpenedAt: Date.now(),
    });
  }
  return [...projected.values()];
}

function sessionTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0]!.trim();
  const characters = Array.from(firstLine);
  return characters.length > 48
    ? `${characters.slice(0, 48).join("").trimEnd()}…`
    : firstLine;
}

function backgroundSessionStatus(
  state: "running" | "waiting" | "completed" | "failed",
): Pick<ProductSidebarSession, "status" | "statusLabel"> {
  switch (state) {
    case "running":
      return { status: "running", statusLabel: "Working in background" };
    case "waiting":
      return { status: "waiting", statusLabel: "Waiting for input" };
    case "completed":
      return { status: "completed", statusLabel: "Completed in background" };
    case "failed":
      return { status: "failed", statusLabel: "Background turn failed" };
  }
}
