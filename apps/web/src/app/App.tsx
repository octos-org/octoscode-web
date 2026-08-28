import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { addSystemMessage } from "../features/timeline/model.ts";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
import { Timeline } from "../features/timeline/Timeline.tsx";
import { resolveComposerIntent } from "../features/composer/intent.ts";
import {
  commandSuggestions,
  type WebCommandSpec,
} from "../features/commands/registry.ts";
import { useOctosSession } from "../features/session/use-octos-session.ts";
import { codingProductCapabilities } from "../features/session/coding-capabilities.ts";
import { SessionDraftCache } from "../features/session/session-draft-cache.ts";
import {
  clearConnectionPreferences,
  loadAutoConnect,
  loadConnectionPreferences,
  saveConnectionPreferences,
  setAutoConnect,
} from "../features/connection/preferences.ts";
import { freshWebSessionId } from "../features/session/session-identity.ts";
import {
  ProductSidebar,
  type ProductSidebarSession,
  type ProductSidebarWorkspace,
} from "../features/shell/ProductSidebar.tsx";
import {
  findModel,
  formatRelativeTime,
  modelControlState,
  modelGroups,
  permissionControlState,
  permissionOptionId,
  permissionOptions,
  profileDefaultNeedsRestart,
  selectedModel,
} from "../features/shell/product-projection.ts";
import { SessionControlBar } from "../features/product-controls/SessionControlBar.tsx";
import { TurnStopButton } from "../features/product-controls/TurnStopButton.tsx";
import type {
  ModelSelection,
  SettingsSectionId,
} from "../features/product-controls/types.ts";
import type { WorkspacePickerView } from "../features/workspace-create/NewSessionWorkspacePicker.tsx";
import {
  clearRecentWorkspaces,
  loadRecentWorkspaces,
  rememberWorkspace,
  workspaceName,
  type RecentWorkspace,
} from "../features/workspace/workspace-recents.ts";
import productStyles from "./AppProduct.module.css";

const LaunchDecisionPanel = lazy(async () => ({
  default: (await import("../features/workspace/LaunchDecisionPanel.tsx"))
    .LaunchDecisionPanel,
}));
const CommandPalette = lazy(async () => ({
  default: (await import("../features/commands/CommandPalette.tsx"))
    .CommandPalette,
}));
const ApprovalPanel = lazy(async () => ({
  default: (await import("../features/approval/ApprovalPanel.tsx"))
    .ApprovalPanel,
}));
const UserQuestionPanel = lazy(async () => ({
  default: (await import("../features/questions/UserQuestionPanel.tsx"))
    .UserQuestionPanel,
}));
const NewSessionWorkspacePicker = lazy(async () => ({
  default: (
    await import("../features/workspace-create/NewSessionWorkspacePicker.tsx")
  ).NewSessionWorkspacePicker,
}));
const SessionTrajectory = lazy(async () => ({
  default: (await import("../features/supervision/SessionTrajectory.tsx"))
    .SessionTrajectory,
}));
const SettingsDialog = lazy(async () => ({
  default: (await import("../features/product-controls/SettingsDialog.tsx"))
    .SettingsDialog,
}));
const GeneralSettingsContent = lazy(async () => ({
  default: (
    await import("../features/product-settings/GeneralSettingsContent.tsx")
  ).GeneralSettingsContent,
}));
const ModelsSettingsContent = lazy(async () => ({
  default: (
    await import("../features/product-settings/ModelsSettingsContent.tsx")
  ).ModelsSettingsContent,
}));
const ModelManagementSettings = lazy(async () => ({
  default: (
    await import("../features/product-settings/ModelManagementSettings.tsx")
  ).ModelManagementSettings,
}));
const DiffReviewDialog = lazy(async () => ({
  default: (await import("../features/review/DiffReviewDialog.tsx"))
    .DiffReviewDialog,
}));
const TaskDetailDialog = lazy(async () => ({
  default: (await import("../features/supervision/TaskDetailDialog.tsx"))
    .TaskDetailDialog,
}));

const initialConnection: ConnectionDraft = {
  endpoint: defaultEndpoint(),
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};
const COMMAND_PALETTE_ID = "composer-command-palette";

export function App() {
  const {
    connection: session,
    conversation,
    interactions,
    safety,
    models,
    work,
    workspaceProduct,
  } = useOctosSession();
  const draftRef = useRef("");
  const sessionDraftsRef = useRef(new SessionDraftCache());
  const previousActiveSessionKeyRef = useRef<string | null>(null);
  const restoreConnectionRef = useRef(loadAutoConnect(window.sessionStorage));
  const restoreAttemptedRef = useRef(false);
  const [connection, setConnection] = useState(() =>
    loadConnectionPreferences(
      initialConnection,
      window.localStorage,
      window.sessionStorage,
    ),
  );
  const [draft, setDraft] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarView, setSidebarView] = useState<"grouped" | "flat">("grouped");
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  const [conversationTab, setConversationTab] = useState<"chat" | "trajectory">(
    "chat",
  );
  const [workspacePicker, setWorkspacePicker] = useState<{
    open: boolean;
    view: WorkspacePickerView;
  }>({ open: false, view: "choose" });
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(
    () => loadRecentWorkspaces(window.sessionStorage, connection.endpoint),
  );
  const codingCapabilities = codingProductCapabilities(session.capabilities);

  useEffect(() => {
    saveConnectionPreferences(
      connection,
      window.localStorage,
      window.sessionStorage,
    );
  }, [connection]);

  useEffect(() => {
    if (restoreAttemptedRef.current || !restoreConnectionRef.current) return;
    const timer = window.setTimeout(() => {
      if (restoreAttemptedRef.current) return;
      restoreAttemptedRef.current = true;
      if (connection.endpoint.trim() && connection.sessionId.trim()) {
        session.restore(connection);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [connection, session]);

  useEffect(() => {
    if (session.authenticated) {
      setAutoConnect(window.sessionStorage, true);
    }
  }, [session.authenticated]);

  useEffect(() => {
    if (!session.authenticated || !session.restoreRejected) return;
    setConnection((current) =>
      current.cwd || current.profileId
        ? {
            ...current,
            sessionId: initialConnection.sessionId,
            profileId: "",
            cwd: "",
          }
        : current,
    );
  }, [session.authenticated, session.restoreRejected]);

  useEffect(() => {
    const opened = session.opened;
    if (!session.connected || !opened) return;
    setConnection((current) => {
      const next = {
        ...current,
        sessionId: opened.session_id,
        profileId: opened.active_profile_id ?? current.profileId,
        cwd: opened.workspace_root ?? current.cwd,
      };
      return next.sessionId === current.sessionId &&
        next.profileId === current.profileId &&
        next.cwd === current.cwd
        ? current
        : next;
    });
  }, [session.connected, session.opened]);

  useEffect(() => {
    if (
      conversationTab === "trajectory" &&
      !work.supervision.planAvailable &&
      !work.supervision.taskListAvailable &&
      !work.supervision.statusAvailable
    ) {
      setConversationTab("chat");
    }
  }, [
    conversationTab,
    work.supervision.planAvailable,
    work.supervision.taskListAvailable,
    work.supervision.statusAvailable,
  ]);

  useEffect(() => {
    if (
      settingsSection === "models" &&
      !models.state.available &&
      !models.management.available
    ) {
      setSettingsSection("general");
    }
  }, [models.management.available, models.state.available, settingsSection]);

  useEffect(() => {
    // v1 persisted session ids/titles in localStorage. Remove that data rather
    // than migrating it into the product: Core is the session authority.
    clearRecentWorkspaces(window.localStorage, connection.endpoint);
  }, [connection.endpoint]);

  useEffect(() => {
    const opened = session.opened;
    const path = opened?.workspace_root?.trim();
    if (!session.connected || !opened || !path) return;
    setRecentWorkspaces(
      rememberWorkspace(window.sessionStorage, connection.endpoint, path),
    );
  }, [connection.endpoint, session.connected, session.opened]);

  const submit = (override?: string) => {
    const text = (override ?? draftRef.current).trim();
    const opened = session.opened;
    if (
      !session.connected ||
      !opened ||
      !text ||
      workspaceProduct.transitioning
    )
      return;

    const intent = resolveComposerIntent(text, opened.capabilities);
    if (intent.kind === "empty-command") return;
    if (intent.kind === "prompt" && !codingCapabilities.turnStartAvailable)
      return;

    draftRef.current = "";
    setDraft("");
    setSelectedCommandIndex(0);
    setCommandPaletteDismissed(false);

    switch (intent.kind) {
      case "prompt":
        conversation.enqueuePrompt(intent.text);
        return;
      case "interrupt":
        void conversation.interrupt();
        return;
      case "help": {
        const available = commandSuggestions("/", opened.capabilities)
          .map(
            (command) =>
              `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
          )
          .join(" · ");
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `help:${crypto.randomUUID()}`,
            "Commands",
            `${available}. Unsupported slash commands are never sent to the model.`,
          ),
        );
        return;
      }
      case "process-status":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `process-status:${crypto.randomUUID()}`,
            "Process status",
            conversation.queue.active
              ? `Foreground turn ${conversation.queue.active.turnId.slice(0, 8)} is active. ${conversation.queue.pending.length} prompt${conversation.queue.pending.length === 1 ? "" : "s"} queued.`
              : "No foreground turn is active and the prompt queue is empty.",
          ),
        );
        return;
      case "status": {
        const runtimeModel = work.supervision.runtimeStatus?.model;
        const profileDefault = models.state.models.find(
          (model) => model.selected,
        );
        const currentPermission = safety.permission.result?.current;
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `status:${crypto.randomUUID()}`,
            "Session status",
            [
              `Workspace: ${opened.workspace_root ?? "server default"}`,
              `Runtime model: ${runtimeModel?.title ?? runtimeModel?.model ?? "not reported"}`,
              `Profile default: ${profileDefault?.title ?? profileDefault?.model ?? "not reported"}`,
              `Access: ${currentPermission ? `${currentPermission.mode} · network ${currentPermission.network}` : "server default"}`,
              `Queue: ${conversation.queue.active ? "working" : "idle"}`,
            ].join("\n"),
          ),
        );
        return;
      }
      case "copy": {
        const lastReply = conversation.timeline.findLast(
          (entry) => entry.kind === "assistant" && entry.body,
        );
        if (!lastReply) {
          conversation.setTimeline((current) =>
            addSystemMessage(
              current,
              `copy-empty:${crypto.randomUUID()}`,
              "Nothing to copy",
              "There is no assistant reply in this session yet.",
            ),
          );
          return;
        }
        void navigator.clipboard
          .writeText(lastReply.body)
          .then(() =>
            conversation.setTimeline((current) =>
              addSystemMessage(
                current,
                `copy-ok:${crypto.randomUUID()}`,
                "Copied",
                "The last assistant reply is on the clipboard.",
                "complete",
              ),
            ),
          )
          .catch((reason: unknown) =>
            conversation.setTimeline((current) =>
              addSystemMessage(
                current,
                `copy-error:${crypto.randomUUID()}`,
                "Copy failed",
                reason instanceof Error ? reason.message : String(reason),
                "error",
              ),
            ),
          );
        return;
      }
      case "local-shell-unavailable":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `shell-unavailable:${crypto.randomUUID()}`,
            "Local shell unavailable",
            "Octoscode's ! command runs on the TUI host. A browser cannot execute a local process, so nothing was sent.",
            "error",
          ),
        );
        return;
      case "unsupported-command":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `unsupported-command:${crypto.randomUUID()}`,
            `/${intent.command} is unavailable`,
            "This Web build cannot execute that Octoscode command. Nothing was sent to the model.",
            "error",
          ),
        );
        return;
      default:
        return assertNever(intent);
    }
  };

  function insertComposerNewline(target: HTMLTextAreaElement) {
    const value = draftRef.current;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${value.slice(0, start)}\n${value.slice(end)}`;
    draftRef.current = next;
    setDraft(next);
    requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
  }

  const activeTurnId = conversation.queue.active?.turnId ?? null;
  const suggestedCommands = commandPaletteDismissed
    ? []
    : commandSuggestions(draft, session.opened?.capabilities);
  const chooseCommand = (command: WebCommandSpec) => submit(`/${command.name}`);
  const switchBlocked = Boolean(
    conversation.queue.active ||
    conversation.queue.pending.length ||
    workspaceProduct.transitioning,
  );
  const activeWorkspacePath =
    session.opened?.workspace_root?.trim() ||
    workspaceProduct.launch.cwd?.trim() ||
    "";
  const activeSessionKey = session.opened
    ? workspaceSessionKey(activeWorkspacePath, session.opened.session_id)
    : null;
  useEffect(() => {
    const previous = previousActiveSessionKeyRef.current;
    if (previous === activeSessionKey) return;
    if (previous) {
      sessionDraftsRef.current.set(previous, draftRef.current);
    }
    const restored = activeSessionKey
      ? (sessionDraftsRef.current.get(activeSessionKey) ?? "")
      : "";
    draftRef.current = restored;
    setDraft(restored);
    setSelectedCommandIndex(0);
    setCommandPaletteDismissed(false);
    previousActiveSessionKeyRef.current = activeSessionKey;
    if (activeSessionKey) setConversationTab("chat");
  }, [activeSessionKey]);
  const sidebarProjection = useMemo(() => {
    const workspaces = activeWorkspacePath
      ? ensureActiveWorkspace(recentWorkspaces, activeWorkspacePath)
      : recentWorkspaces;
    const targets = new Map<
      string,
      { sessionId: string; workspacePath: string }
    >();
    const projected: ProductSidebarWorkspace[] = workspaces.map((workspace) => {
      const isActiveWorkspace = workspace.path === activeWorkspacePath;
      const sourceSessions = isActiveWorkspace
        ? workspaceProduct.state.sessions.map((item) => ({
            id: item.id,
            title: item.title?.trim() || item.last_prompt?.trim() || item.id,
            ...(item.updated_at ? { updatedAt: item.updated_at } : {}),
          }))
        : [];
      if (
        isActiveWorkspace &&
        session.opened &&
        !sourceSessions.some((item) => item.id === session.opened?.session_id)
      ) {
        sourceSessions.unshift({
          id: session.opened.session_id,
          title: "New coding session",
        });
      }
      return {
        id: workspace.id,
        label: workspace.name,
        path: workspace.path,
        expanded: !collapsedWorkspaceIds.has(workspace.id),
        // Core's compatibility list does not echo Workspace/Profile scope.
        // Only the successfully opened Session is safe to project here.
        sessionCatalogStatus: "current-only",
        sessions: sourceSessions.map((item): ProductSidebarSession => {
          const productId = workspaceSessionKey(workspace.path, item.id);
          targets.set(productId, {
            sessionId: item.id,
            workspacePath: workspace.path,
          });
          const active = productId === activeSessionKey;
          const updatedLabel = formatRelativeTime(item.updatedAt);
          const updatedAt = Date.parse(item.updatedAt ?? "");
          return {
            id: productId,
            title: item.title,
            ...(updatedLabel ? { updatedLabel } : {}),
            ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
            ...(active && (interactions.approval || interactions.question)
              ? {
                  status: "waiting" as const,
                  statusLabel: "Waiting for input",
                }
              : active && activeTurnId
                ? { status: "running" as const, statusLabel: "Working" }
                : {}),
          };
        }),
      };
    });
    return { workspaces: projected, targets };
  }, [
    activeSessionKey,
    activeTurnId,
    activeWorkspacePath,
    collapsedWorkspaceIds,
    interactions.approval,
    interactions.question,
    recentWorkspaces,
    workspaceProduct.state.sessions,
  ]);

  const moveToProductSession = async (productSessionId: string) => {
    const target = sidebarProjection.targets.get(productSessionId);
    if (!target || switchBlocked || productSessionId === activeSessionKey)
      return;
    const outcome = await workspaceProduct.openSession({
      sessionId: target.sessionId,
      cwd: target.workspacePath,
      profileId: null,
    });
    if (outcome !== "opened") return;
  };
  const createSessionInWorkspace = async (workspacePath: string) => {
    if (
      !codingCapabilities.sessionCreationAvailable ||
      switchBlocked ||
      !workspacePath.trim()
    )
      return;
    const sessionId = freshWebSessionId();
    const outcome = await workspaceProduct.openSession({
      sessionId,
      cwd: workspacePath,
    });
    if (outcome === "awaiting_choice") {
      setWorkspacePicker((current) => ({ ...current, open: false }));
      return;
    }
    if (outcome !== "opened") return;
    setWorkspacePicker((current) => ({ ...current, open: false }));
  };
  const requestNewSession = (workspaceId?: string) => {
    if (!codingCapabilities.sessionCreationAvailable) return;
    const workspace = workspaceId
      ? recentWorkspaces.find((candidate) => candidate.id === workspaceId)
      : null;
    if (workspace) {
      createSessionInWorkspace(workspace.path);
      return;
    }
    if (workspaceId && workspaceId === activeWorkspacePath) {
      createSessionInWorkspace(activeWorkspacePath);
      return;
    }
    setWorkspacePicker({ open: true, view: "choose" });
  };
  const changeConnection = (next: ConnectionDraft) => {
    restoreConnectionRef.current = false;
    setAutoConnect(window.sessionStorage, false);
    const identityChanged =
      next.endpoint !== connection.endpoint || next.token !== connection.token;
    if (identityChanged) {
      clearConnectionPreferences(window.localStorage, window.sessionStorage);
      for (const endpoint of new Set([
        connection.endpoint.trim(),
        next.endpoint.trim(),
      ])) {
        if (!endpoint) continue;
        clearRecentWorkspaces(window.sessionStorage, endpoint);
        clearRecentWorkspaces(window.localStorage, endpoint);
      }
      setRecentWorkspaces([]);
    }
    setConnection(
      identityChanged
        ? {
            ...next,
            sessionId: initialConnection.sessionId,
            profileId: "",
            cwd: "",
          }
        : next,
    );
  };
  const disconnect = () => {
    restoreConnectionRef.current = false;
    setAutoConnect(window.sessionStorage, false);
    setSettingsOpen(false);
    setWorkspacePicker((current) => ({ ...current, open: false }));
    session.disconnect();
  };
  const forgetConnection = () => {
    clearRecentWorkspaces(window.sessionStorage, connection.endpoint);
    clearRecentWorkspaces(window.localStorage, connection.endpoint);
    setRecentWorkspaces([]);
    disconnect();
    clearConnectionPreferences(window.localStorage, window.sessionStorage);
    setConnection(initialConnection);
  };

  const projectedPermissionOptions = permissionOptions(
    safety.permission.result,
  );
  const currentPermission = safety.permission.result?.current;
  const projectedModelGroups = modelGroups(models.state.models);
  const currentProfileModel = selectedModel(models.state.models);
  const runtimeModel = work.supervision.runtimeStatus?.model;
  const runtimeModelLabel = runtimeModel?.title ?? runtimeModel?.model ?? null;
  const selectModel = async (selection: ModelSelection) => {
    const target = findModel(models.state.models, selection);
    if (!target) return;
    await models.select(target);
    await work.refresh();
  };
  const permissionControl = safety.permission.available
    ? {
        state: permissionControlState(safety.permission),
        options: projectedPermissionOptions,
        selectedId: currentPermission
          ? permissionOptionId(
              currentPermission.mode,
              currentPermission.network,
            )
          : null,
        locked:
          switchBlocked ||
          safety.permission.busy ||
          !safety.permission.editable,
        labels: PERMISSION_LABELS,
        riskCopy: PERMISSION_RISK_COPY,
        onSelect: (option: (typeof projectedPermissionOptions)[number]) => {
          const selection = [
            safety.permission.result?.current,
            ...(safety.permission.result?.profiles ?? []),
          ].find(
            (candidate) =>
              candidate?.mode === option.mode &&
              candidate.network === option.network,
          );
          if (selection) void safety.updatePermission(selection);
        },
        onRetry: () => void safety.refreshPermission(),
      }
    : null;
  const showModelsSettings = Boolean(
    session.opened && (models.state.available || models.management.available),
  );
  const restartPending = profileDefaultNeedsRestart(
    runtimeModel,
    models.state.models,
    models.state.restartHint,
  );
  const pendingProfileDefault = restartPending
    ? currentProfileModel
      ? (projectedModelGroups
          .find((group) => group.id === currentProfileModel.providerId)
          ?.models.find((model) => model.id === currentProfileModel.modelId)
          ?.name ?? currentProfileModel.modelId)
      : "saved model"
    : undefined;
  const contextPercent = sessionContextPercent(
    workspaceProduct.state.tokenCost?.inputTokens,
    workspaceProduct.state.tokenCost?.contextWindow,
  );

  const showProductShell = Boolean(
    session.authenticated || workspaceProduct.launch.decision,
  );
  if (!showProductShell) {
    const gateStatus =
      session.status === "connected" ? "connecting" : session.status;
    return (
      <ConnectionPanel
        value={connection}
        status={gateStatus}
        error={session.error}
        onChange={changeConnection}
        onConnect={() => session.connect(connection)}
        onDisconnect={disconnect}
        onForget={forgetConnection}
      />
    );
  }

  return (
    <div className="app-shell">
      <main className="workspace-grid">
        <ProductSidebar
          collapsed={sidebarCollapsed}
          workspaces={sidebarProjection.workspaces}
          selectedSessionId={activeSessionKey}
          loading={workspaceProduct.state.loading}
          error={workspaceProduct.state.error}
          settingsActive={settingsOpen}
          sessionCreationAvailable={codingCapabilities.sessionCreationAvailable}
          viewMode={sidebarView}
          orderMode="updated"
          onCollapsedChange={setSidebarCollapsed}
          onNewSession={requestNewSession}
          onAddWorkspace={() => setWorkspacePicker({ open: true, view: "add" })}
          onViewModeChange={setSidebarView}
          onOrderModeChange={() => undefined}
          onWorkspaceExpandedChange={(workspaceId, expanded) => {
            setCollapsedWorkspaceIds((current) => {
              const next = new Set(current);
              if (expanded) next.delete(workspaceId);
              else next.add(workspaceId);
              return next;
            });
          }}
          onSessionSelect={moveToProductSession}
          onSettings={() => setSettingsOpen(true)}
          onRetry={() => {
            void workspaceProduct.refresh();
          }}
        />

        <section className="conversation">
          <header className="conversation-header">
            <div className="workspace-title">
              <span>{workspaceName(activeWorkspacePath || "Workspace")}</span>
              <small>{activeWorkspacePath || "Choose a workspace"}</small>
            </div>
            {session.opened &&
            (work.supervision.planAvailable ||
              work.supervision.taskListAvailable ||
              work.supervision.statusAvailable) ? (
              <nav
                className={productStyles.conversationTabs}
                aria-label="Session views"
              >
                <button
                  type="button"
                  aria-current={conversationTab === "chat" ? "page" : undefined}
                  onClick={() => setConversationTab("chat")}
                >
                  Chat
                </button>
                <button
                  type="button"
                  aria-current={
                    conversationTab === "trajectory" ? "page" : undefined
                  }
                  onClick={() => setConversationTab("trajectory")}
                >
                  Trajectory
                </button>
              </nav>
            ) : null}
            <div className="header-actions">
              {safety.diffReview.available &&
              safety.diffReview.latestPreviewId ? (
                <button
                  className="review-chip"
                  type="button"
                  onClick={() => void safety.openDiffReview()}
                >
                  Review changes
                </button>
              ) : null}
            </div>
          </header>
          <div
            className="conversation-scroll"
            role="region"
            aria-label="Conversation"
            tabIndex={0}
          >
            {workspaceProduct.launch.decision ? (
              <Suspense fallback={<DeferredSurface label="Loading launch…" />}>
                <LaunchDecisionPanel
                  state={workspaceProduct.launch}
                  onboarding={workspaceProduct.onboarding}
                  error={workspaceProduct.state.error}
                  onSubmitOnboarding={(submission) =>
                    void workspaceProduct.submitOnboarding(submission)
                  }
                  onRetryOnboarding={() =>
                    void workspaceProduct.retryOnboarding()
                  }
                  onChooseProfile={(profileId) =>
                    void workspaceProduct.chooseLaunchProfile(profileId)
                  }
                  onCancel={workspaceProduct.cancelLaunch}
                />
              </Suspense>
            ) : !session.opened ? (
              <div className={productStyles.newSessionHero}>
                {codingCapabilities.sessionCreationAvailable ? (
                  <Suspense
                    fallback={<DeferredSurface label="Loading workspaces…" />}
                  >
                    <NewSessionWorkspacePicker
                      presentation="hero"
                      workspaces={recentWorkspaces.map((workspace) => ({
                        id: workspace.id,
                        name: workspace.name,
                        path: workspace.path,
                      }))}
                      {...(recentWorkspaces[0]
                        ? { recentWorkspaceId: recentWorkspaces[0].id }
                        : {})}
                      error={workspaceProduct.state.error}
                      creating={
                        session.status === "connecting" ||
                        workspaceProduct.transitioning
                      }
                      onCancel={disconnect}
                      onCreate={({ workspacePath }) =>
                        createSessionInWorkspace(workspacePath)
                      }
                    />
                  </Suspense>
                ) : (
                  <section
                    className={productStyles.sessionUnavailable}
                    role="status"
                  >
                    <strong>Coding sessions unavailable</strong>
                    <p>
                      This Octos server does not support starting coding
                      sessions in this Web app.
                    </p>
                    <button type="button" onClick={disconnect}>
                      Change server
                    </button>
                  </section>
                )}
              </div>
            ) : conversationTab === "trajectory" ? (
              <Suspense
                fallback={<DeferredSurface label="Loading trajectory…" />}
              >
                <SessionTrajectory
                  state={work.supervision}
                  onRefresh={() => void work.refresh()}
                  onOpenTask={(taskId) => void work.openTask(taskId)}
                  onCancelTask={(taskId) => void work.cancelTask(taskId)}
                />
              </Suspense>
            ) : (
              <Timeline
                entries={conversation.timeline}
                connected={session.connected}
              />
            )}
          </div>
          <div
            className={`composer-wrap${!session.opened || workspaceProduct.launch.decision || conversationTab === "trajectory" ? " is-hidden" : ""}`}
          >
            {session.opened && session.recovery.phase !== "healthy" ? (
              <div
                className={`recovery-banner recovery-${session.recovery.phase}`}
                role="status"
              >
                <span className="recovery-banner-mark">↻</span>
                <span>
                  <strong>
                    {session.recovery.phase === "reconnecting"
                      ? "Reconnecting to Octos"
                      : session.recovery.phase === "hydrating"
                        ? "Restoring session state"
                        : "Session recovery required"}
                  </strong>
                  <small>
                    {session.recovery.detail ??
                      "Prompts are paused until the durable projection is synchronized."}
                  </small>
                </span>
              </div>
            ) : interactions.approval ? (
              <Suspense
                fallback={<DeferredSurface label="Loading approval…" />}
              >
                <ApprovalPanel
                  approval={interactions.approval}
                  busy={interactions.busy}
                  error={interactions.error}
                  onDecide={(decision, scope) =>
                    void interactions.respondApproval(decision, scope)
                  }
                  {...(codingCapabilities.turnInterruptAvailable
                    ? { onInterrupt: () => void conversation.interrupt() }
                    : {})}
                  onReviewDiff={(previewId) =>
                    void safety.openDiffReview(previewId)
                  }
                />
              </Suspense>
            ) : interactions.question ? (
              <Suspense
                fallback={<DeferredSurface label="Loading question…" />}
              >
                <UserQuestionPanel
                  key={interactions.question.questionId}
                  request={interactions.question}
                  busy={interactions.busy}
                  error={interactions.error}
                  onSubmit={(answers) =>
                    void interactions.respondQuestion(answers)
                  }
                  {...(codingCapabilities.turnInterruptAvailable
                    ? { onInterrupt: () => void conversation.interrupt() }
                    : {})}
                />
              </Suspense>
            ) : (
              <div className="composer">
                {suggestedCommands.length > 0 ? (
                  <Suspense fallback={null}>
                    <CommandPalette
                      id={COMMAND_PALETTE_ID}
                      commands={suggestedCommands}
                      selectedIndex={Math.min(
                        selectedCommandIndex,
                        Math.max(0, suggestedCommands.length - 1),
                      )}
                      onSelect={chooseCommand}
                    />
                  </Suspense>
                ) : null}
                {conversation.queue.pending.length > 0 ? (
                  <div className="prompt-queue" aria-live="polite">
                    <strong>{conversation.queue.pending.length} queued</strong>
                    <span>{conversation.queue.pending[0]?.text}</span>
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(event) => {
                    draftRef.current = event.target.value;
                    setDraft(event.target.value);
                    setSelectedCommandIndex(0);
                    setCommandPaletteDismissed(false);
                  }}
                  onKeyDown={(event) => {
                    if (suggestedCommands.length && event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedCommandIndex(
                        (current) => (current + 1) % suggestedCommands.length,
                      );
                    } else if (
                      suggestedCommands.length &&
                      event.key === "ArrowUp"
                    ) {
                      event.preventDefault();
                      setSelectedCommandIndex(
                        (current) =>
                          (current - 1 + suggestedCommands.length) %
                          suggestedCommands.length,
                      );
                    } else if (
                      suggestedCommands.length &&
                      event.key === "Escape"
                    ) {
                      event.preventDefault();
                      setCommandPaletteDismissed(true);
                      setSelectedCommandIndex(0);
                    } else if (
                      (event.key === "Enter" && event.altKey) ||
                      (event.key.toLowerCase() === "j" && event.ctrlKey)
                    ) {
                      event.preventDefault();
                      insertComposerNewline(event.currentTarget);
                    } else if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.ctrlKey &&
                      !event.metaKey
                    ) {
                      event.preventDefault();
                      const selected = suggestedCommands[selectedCommandIndex];
                      if (selected) chooseCommand(selected);
                      else submit();
                    }
                  }}
                  placeholder={
                    session.connected && codingCapabilities.turnStartAvailable
                      ? "Ask Octos to change, explain, or review code…"
                      : session.connected
                        ? "This server cannot start coding turns"
                        : "Connect a workspace to begin"
                  }
                  disabled={
                    !session.connected ||
                    !codingCapabilities.turnStartAvailable ||
                    workspaceProduct.transitioning
                  }
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-expanded={suggestedCommands.length > 0}
                  aria-controls={COMMAND_PALETTE_ID}
                  aria-activedescendant={
                    suggestedCommands[selectedCommandIndex]
                      ? `${COMMAND_PALETTE_ID}-${suggestedCommands[selectedCommandIndex].name}`
                      : undefined
                  }
                  rows={3}
                />
                <div className="composer-footer">
                  <SessionControlBar
                    ariaLabel="Session controls"
                    permission={permissionControl}
                    model={null}
                    runtimeModel={
                      session.opened &&
                      codingCapabilities.runtimeStatusAvailable &&
                      work.supervision.statusAvailable
                        ? {
                            label: runtimeModelLabel,
                            ...(pendingProfileDefault
                              ? { pendingProfileDefault }
                              : {}),
                            onOpenSettings: () => {
                              setSettingsSection(
                                showModelsSettings ? "models" : "general",
                              );
                              setSettingsOpen(true);
                            },
                          }
                        : null
                    }
                  />
                  <div className="composer-actions">
                    {contextPercent !== null ? (
                      <span
                        className={productStyles.contextUsage}
                        title={`${contextPercent}% of the model context window used`}
                      >
                        {contextPercent}%
                      </span>
                    ) : null}
                    <TurnStopButton
                      activeTurnId={activeTurnId}
                      interruptingTurnId={conversation.interruptingTurnId}
                      available={codingCapabilities.turnInterruptAvailable}
                      onInterrupt={() => void conversation.interrupt()}
                    />
                    <button
                      className="send-button"
                      type="button"
                      onClick={() => submit()}
                      disabled={
                        !session.connected ||
                        !codingCapabilities.turnStartAvailable ||
                        workspaceProduct.transitioning ||
                        !draft.trim()
                      }
                      aria-label={activeTurnId ? "Queue prompt" : "Send prompt"}
                      title={activeTurnId ? "Queue prompt" : "Send prompt"}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      {codingCapabilities.sessionCreationAvailable && workspacePicker.open ? (
        <Suspense fallback={<DeferredSurface label="Loading workspaces…" />}>
          <NewSessionWorkspacePicker
            open
            initialView={workspacePicker.view}
            workspaces={recentWorkspaces.map((workspace) => ({
              id: workspace.id,
              name: workspace.name,
              path: workspace.path,
            }))}
            {...(activeWorkspacePath
              ? { selectedWorkspaceId: activeWorkspacePath }
              : {})}
            {...(recentWorkspaces[0]
              ? { recentWorkspaceId: recentWorkspaces[0].id }
              : {})}
            error={workspaceProduct.state.error}
            creating={
              session.status === "connecting" || workspaceProduct.transitioning
            }
            onCancel={() =>
              setWorkspacePicker((current) => ({ ...current, open: false }))
            }
            onCreate={({ workspacePath }) =>
              createSessionInWorkspace(workspacePath)
            }
          />
        </Suspense>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={<DeferredSurface label="Loading settings…" />}>
          <SettingsDialog
            open
            activeSection={settingsSection}
            labels={SETTINGS_LABELS}
            slots={{
              general: (
                <GeneralSettingsContent
                  serverOrigin={connection.endpoint}
                  connectionStatus={session.status}
                  workspaceLabel={
                    activeWorkspacePath
                      ? workspaceName(activeWorkspacePath)
                      : null
                  }
                  workspacePath={activeWorkspacePath || null}
                  displayProfile={session.opened?.active_profile_id ?? null}
                  locked={switchBlocked}
                  onDisconnect={disconnect}
                  onForgetConnection={forgetConnection}
                />
              ),
              ...(showModelsSettings
                ? {
                    models: (
                      <>
                        {models.state.available ? (
                          <ModelsSettingsContent
                            state={modelControlState(models.state)}
                            groups={projectedModelGroups}
                            selected={currentProfileModel}
                            runtimeModel={runtimeModelLabel}
                            restartRequired={restartPending}
                            selectionEnabled={models.state.editable}
                            locked={switchBlocked || models.state.busy}
                            onRefresh={() => void models.refresh()}
                            onSelect={(selection) =>
                              void selectModel(selection)
                            }
                          />
                        ) : null}
                        <ModelManagementSettings
                          key={models.management.authorityKey}
                          client={models.management.client}
                          profileId={models.management.profileId}
                          capabilities={models.management.capabilities}
                          profileDefaultKey={`${currentProfileModel?.providerId ?? ""}:${currentProfileModel?.modelId ?? ""}`}
                          locked={switchBlocked}
                          onConfiguredModelsChange={models.refresh}
                        />
                      </>
                    ),
                  }
                : {}),
            }}
            onSectionChange={setSettingsSection}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      ) : null}
      {safety.diffReview.active ? (
        <Suspense fallback={<DeferredSurface label="Loading review…" />}>
          <DiffReviewDialog
            state={safety.diffReview}
            onClose={safety.closeDiffReview}
            onRefresh={() => void safety.openDiffReview()}
          />
        </Suspense>
      ) : null}
      {work.supervision.detail.active ? (
        <Suspense fallback={<DeferredSurface label="Loading task…" />}>
          <TaskDetailDialog
            state={work.supervision}
            onClose={work.closeTask}
            onLoadMore={() => void work.loadMoreOutput()}
            onReadArtifact={(artifact) => void work.readArtifact(artifact)}
            onLoadMoreArtifact={() => void work.loadMoreArtifact()}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled composer intent: ${JSON.stringify(value)}`);
}

function DeferredSurface({ label }: { label: string }) {
  return (
    <div className={productStyles.deferredSurface} role="status">
      {label}
    </div>
  );
}

const PERMISSION_LABELS = {
  menu: "Permission",
  loading: "Loading access…",
  unavailable: "Permission unavailable",
  select: "Permission",
  empty: "No permission presets are available.",
  retry: "Retry",
} as const;

const PERMISSION_RISK_COPY = {
  title: "Enable full access?",
  description:
    "Octos can read and modify files outside the workspace and use the network without the normal sandbox boundary.",
  accessLabel: "Filesystem access",
  networkLabel: "Network access",
  acknowledgement:
    "I understand that this session can make unrestricted changes.",
  cancel: "Cancel",
  confirm: "Enable full access",
} as const;

const SETTINGS_LABELS = {
  title: "Settings",
  navigation: "Settings sections",
  general: "General",
  models: "Models",
  close: "Close settings",
} as const;

function defaultEndpoint(): string {
  const configured = import.meta.env.VITE_OCTOS_DEFAULT_ENDPOINT?.trim();
  if (configured) return configured;
  const hostname = window.location.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  ) {
    return "http://127.0.0.1:50080";
  }
  return window.location.origin;
}

function workspaceSessionKey(workspacePath: string, sessionId: string): string {
  return JSON.stringify([workspacePath, sessionId]);
}

function ensureActiveWorkspace(
  workspaces: readonly RecentWorkspace[],
  path: string,
): RecentWorkspace[] {
  if (workspaces.some((workspace) => workspace.path === path)) {
    return [...workspaces];
  }
  return [
    {
      id: path,
      name: workspaceName(path),
      path,
      lastOpenedAt: Date.now(),
    },
    ...workspaces,
  ];
}

function sessionContextPercent(
  inputTokens: number | undefined,
  contextWindow: number | undefined,
): number | null {
  if (
    inputTokens === undefined ||
    contextWindow === undefined ||
    contextWindow <= 0
  ) {
    return null;
  }
  return Math.min(
    100,
    Math.max(0, Math.round((inputTokens / contextWindow) * 100)),
  );
}
