import { useMemo } from "react";
import type { SessionOpened } from "@octos-org/octoscode-client";
import type { KnownSessionRef } from "../session/known-session-registry.ts";
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
}

/** Session rows are presentation of server-confirmed references in this tab. */
export function SessionSidebar({
  recentWorkspaces,
  knownSessions,
  activeWorkspacePath,
  opened,
  collapsedWorkspaceIds,
  backgroundTurns,
  hasPendingInteraction,
  recoveryPhase,
  activeTurnId,
  turnStarting,
  selectedSessionId,
  ...sidebarProps
}: SessionSidebarProps) {
  const workspaces = useMemo(() => {
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
      const sourceSessions = knownSessions
        .filter((item) => item.workspaceRoot === workspace.path)
        .map((item) => ({
          sessionId: item.sessionId,
          profileId: item.profileId,
          title: knownSessionTitle(item.sessionId),
          updatedAt: item.lastOpenedAt,
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
        // Core rc.9 has no authoritative server-wide SessionRef catalog.
        // These rows are only the server-confirmed refs opened in this tab.
        sessionCatalogStatus: "known-only",
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
            ...(updatedLabel ? { updatedLabel } : {}),
            ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
            ...(active && hasPendingInteraction
              ? {
                  status: "waiting" as const,
                  statusLabel: "Waiting for input",
                }
              : active && recoveryPhase
                ? {
                    status: "waiting" as const,
                    statusLabel:
                      recoveryPhase === "checking"
                        ? "Checking response status"
                        : "Response status uncertain",
                  }
                : active && activeTurnId
                  ? {
                      status: "running" as const,
                      statusLabel: turnStarting ? "Starting" : "Working",
                    }
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
    recentWorkspaces,
    turnStarting,
    backgroundTurns,
    opened,
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
    if (current) {
      current.lastOpenedAt = Math.max(
        current.lastOpenedAt,
        session.lastOpenedAt,
      );
      continue;
    }
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
  return [...projected.values()].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  );
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
