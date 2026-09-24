import { useMemo } from "react";
import type { SessionOpened } from "@octos-org/octoscode-client";
import type { KnownSessionRef } from "../session/known-session-registry.ts";
import {
  mergeWorkspaceSessionRows,
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

interface SessionSidebarProps extends Omit<ProductSidebarProps, "workspaces"> {
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
  }[];
  hasPendingInteraction: boolean;
  recoveryPhase: string | null;
  activeTurnId: string | null;
  turnStarting: boolean;
  timeline: readonly TimelineEntry[];
  openingSessionId: string | null;
}

/** Session rows are presentation of server-confirmed references in this tab. */
export function SessionSidebar({
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
  selectedSessionId,
  ...sidebarProps
}: SessionSidebarProps) {
  const terminal = useMemo(
    () => timeline.findLast((entry) => entry.latestTurnOutcome),
    [timeline],
  );
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
          terminal.latestTurnOutcome === "completed" ? "completed" : "failed",
        statusLabel:
          terminal.latestTurnOutcome === "completed"
            ? "Completed"
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
    const workspaces = knownSessionWorkspaces(
      recentWorkspaces,
      knownSessions,
      activeWorkspacePath,
    );
    const projected: ProductSidebarWorkspace[] = workspaces.map((workspace) => {
      const isActiveWorkspace = workspace.path === activeWorkspacePath;
      const catalog = sessionCatalog?.get(workspace.path);
      const sourceSessions = mergeWorkspaceSessionRows(
        knownSessions.filter((item) => item.workspaceRoot === workspace.path),
        catalog?.sessions ?? [],
      ).map((item) => ({
        sessionId: item.sessionId,
        profileId: item.profileId,
        title: item.title ?? knownSessionTitle(item.sessionId),
        updatedAt: item.updatedAt,
      }));
      if (
        isActiveWorkspace &&
        opened &&
        !sourceSessions.some(
          (item) =>
            item.sessionId === opened?.session_id &&
            item.profileId === (opened.active_profile_id ?? ""),
        )
      ) {
        sourceSessions.unshift({
          sessionId: opened.session_id,
          profileId: opened.active_profile_id ?? "",
          title: knownSessionTitle(opened.session_id),
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
        sessionCatalogStatus: catalog?.status ?? "known-only",
        ...(catalog?.status === "error" && catalog.error
          ? { sessionCatalogError: catalog.error }
          : {}),
        sessions: sourceSessions.map((item): ProductSidebarSession => {
          const productId = workspaceSessionKey(
            workspace.path,
            item.profileId,
            item.sessionId,
          );
          const active = productId === selectedSessionId;
          const background = backgroundBySession.get(productId);
          const updatedLabel = formatRelativeTime(item.updatedAt);
          const updatedAt = item.updatedAt;
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
        }),
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
    openingSessionId,
  ]);

  return (
    <ProductSidebar
      {...sidebarProps}
      selectedSessionId={selectedSessionId}
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

function knownSessionTitle(sessionId: string): string {
  const wireLeaf = sessionId.split(":").at(-1)?.trim() || sessionId.trim();
  const compact = wireLeaf.length > 10 ? wireLeaf.slice(-8) : wireLeaf;
  return `Session ${compact || "unknown"}`;
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
