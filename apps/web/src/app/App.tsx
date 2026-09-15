import { lazy, useEffect, useRef, useState } from "react";
import { SurfaceBoundary } from "../features/error/SurfaceBoundary.tsx";
import { timelineActivity } from "../features/timeline/model.ts";
import { useConversationScroll } from "../features/timeline/use-conversation-scroll.ts";
import { useCompactLayout } from "../features/shell/use-compact-layout.ts";
import { NavigationSurface } from "../features/shell/NavigationSurface.tsx";
import { parseSavedSessionReference } from "../features/session-links/saved-session-link.ts";
import { QueuedPrompts } from "../features/composer/QueuedPrompts.tsx";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
import { resolveComposerIntent } from "../features/composer/intent.ts";
import { useOctosSession } from "../features/session/use-octos-session.ts";
import { codingProductCapabilities } from "../features/session/coding-capabilities.ts";
import { SessionDraftCache } from "../features/session/session-draft-cache.ts";
import {
  clearConnectionPreferences,
  clearKnownSessions,
  loadAutoConnect,
  loadConnectionPreferences,
  loadKnownSessions,
  rememberKnownSession,
  saveConnectionPreferences,
  setAutoConnect,
} from "../features/connection/preferences.ts";
import { freshWebSessionId } from "../features/session/session-identity.ts";
import type { KnownSessionRef } from "../features/session/known-session-registry.ts";
import type { ProductSidebarOrderMode } from "../features/shell/ProductSidebar.tsx";
import {
  findModel,
  modelControlState,
  modelGroups,
  permissionControlState,
  permissionOptionId,
  permissionOptions,
  profileDefaultNeedsRestart,
  selectedModel,
} from "../features/shell/product-projection.ts";
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
import { SkeletonRows } from "../ui/Skeleton.tsx";
import { RefreshIcon, MenuIcon, DiffIcon } from "../ui/Icon.tsx";

const LeaveConnectionDialog = lazy(async () => ({
  default: (await import("../features/connection/LeaveConnectionDialog.tsx"))
    .LeaveConnectionDialog,
}));

const TurnRecoveryNotice = lazy(async () => ({
  default: (await import("../features/composer/TurnRecoveryNotice.tsx"))
    .TurnRecoveryNotice,
}));
const SavedSessionLinkPanel = lazy(async () => ({
  default: (await import("../features/session-links/SavedSessionLinkPanel.tsx"))
    .SavedSessionLinkPanel,
}));

const PromptComposer = lazy(async () => ({
  default: (await import("../features/composer/PromptComposer.tsx"))
    .PromptComposer,
}));

const Timeline = lazy(async () => ({
  default: (await import("../features/timeline/Timeline.tsx")).Timeline,
}));
const SessionSidebar = lazy(async () => ({
  default: (await import("../features/shell/SessionSidebar.tsx"))
    .SessionSidebar,
}));
const SessionControlBar = lazy(async () => ({
  default: (await import("../features/product-controls/SessionControlBar.tsx"))
    .SessionControlBar,
}));
const LaunchDecisionPanel = lazy(async () => ({
  default: (await import("../features/workspace/LaunchDecisionPanel.tsx"))
    .LaunchDecisionPanel,
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
  const commandSessionRef = useRef(session.opened);
  commandSessionRef.current = session.opened;
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
  const [commandError, setCommandError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const compact = useCompactLayout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(compact);
  useEffect(() => setSidebarCollapsed(compact), [compact]);
  const [sidebarOrder, setSidebarOrder] =
    useState<ProductSidebarOrderMode>("updated");
  const [sidebarView, setSidebarView] = useState<"grouped" | "flat">("grouped");
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveConnectionAction, setLeaveConnectionAction] = useState<
    "disconnect" | "forget" | null
  >(null);
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
  const [knownSessions, setKnownSessions] = useState<KnownSessionRef[]>(() =>
    loadKnownSessions(window.sessionStorage, connection),
  );
  const [savedLink, setSavedLink] = useState(() => {
    const key = new URLSearchParams(window.location.search).get("s");
    return key ? { key, reference: parseSavedSessionReference(key) } : null;
  });
  const [savedLinkOpening, setSavedLinkOpening] = useState(false);
  const [savedLinkError, setSavedLinkError] = useState<string | null>(null);
  const autoLinkAttempted = useRef(false);
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
        if (savedLink) {
          const rememberedKey = workspaceSessionKey(
            connection.cwd,
            connection.profileId,
            connection.sessionId,
          );
          // A new link takes precedence over the tab's previous selection.
          if (savedLink.key !== rememberedKey) {
            session.connect(connection);
            return;
          }
          // The existing restore path already opens this exact reference.
          autoLinkAttempted.current = true;
        }
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
    if (
      savedLink?.key ===
      workspaceSessionKey(
        connection.cwd,
        connection.profileId,
        connection.sessionId,
      )
    ) {
      setSavedLink(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("s");
      window.history.replaceState(null, "", url);
    }
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
    setKnownSessions(
      rememberKnownSession(window.sessionStorage, connection, opened),
    );
  }, [
    connection.endpoint,
    connection.token,
    session.connected,
    session.opened,
  ]);

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
    if (intent.kind === "prompt" && conversation.turnRecovery) return;
    if (intent.kind === "prompt" && !codingCapabilities.turnStartAvailable)
      return;

    draftRef.current = "";
    setDraft("");
    setCommandError(null);

    if (intent.kind === "prompt") {
      jumpToLatest();
      conversation.enqueuePrompt(intent.text);
      return;
    }
    if (intent.kind === "interrupt") {
      void conversation.interrupt();
      return;
    }
    const isCurrent = () => commandSessionRef.current === opened;
    void import("../features/commands/execute-local-command.ts")
      .then(({ executeLocalCommand }) =>
        executeLocalCommand({
          intent,
          opened,
          conversation,
          models,
          safety,
          work,
          isCurrent,
        }),
      )
      .catch(() => {
        // A failed local command load must never fall through to model dispatch.
        if (!isCurrent()) return;
        if (!draftRef.current) {
          draftRef.current = text;
          setDraft(text);
        }
        setCommandError(
          "Command unavailable. Nothing was sent. Try the command again when the connection is stable.",
        );
      });
  };

  const activeTurnId = conversation.queue.active?.turnId ?? null;
  const turnStarting = Boolean(
    activeTurnId && conversation.dispatchingTurnId === activeTurnId,
  );
  const activityLabel = timelineActivity(conversation.timeline, activeTurnId);
  const hasUnfinishedWork = Boolean(
    activeTurnId ||
    conversation.queue.pending.length ||
    workspaceProduct.backgroundTurns.some(
      (turn) => turn.state === "running" || turn.state === "waiting",
    ),
  );
  useEffect(() => {
    if (!hasUnfinishedWork) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnfinishedWork]);
  const navigationPending = workspaceProduct.pendingNavigation;
  // A server-accepted turn may keep running on its owner socket while this
  // tab focuses another Session. Browser-local queued prompts cannot: they
  // still belong to the current controller and therefore block navigation.
  const navigationBlocked = workspaceProduct.transitioning;
  const runtimeMutationBlocked = Boolean(
    conversation.queue.active ||
    conversation.queue.pending.length ||
    navigationPending ||
    workspaceProduct.transitioning,
  );
  const activeWorkspacePath =
    session.opened?.workspace_root?.trim() ||
    workspaceProduct.launch.cwd?.trim() ||
    "";
  const activeSessionKey = session.opened
    ? workspaceSessionKey(
        activeWorkspacePath,
        session.opened.active_profile_id ?? "",
        session.opened.session_id,
      )
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

    setCommandError(null);
    previousActiveSessionKeyRef.current = activeSessionKey;
    if (activeSessionKey) setConversationTab("chat");
    // Keep the URL addressable: a selected session survives a bookmark or
    // share. replaceState only — no history spam, and the parameter is
    // stripped again when the selection clears.
    if (savedLink && savedLink.key !== activeSessionKey) return;
    const url = new URL(window.location.href);
    if (activeSessionKey) {
      url.searchParams.set("s", activeSessionKey);
    } else {
      url.searchParams.delete("s");
    }
    window.history.replaceState(null, "", url);
  }, [activeSessionKey]);

  const {
    scrollRef: conversationScrollRef,
    contentRef: conversationContentRef,
    onScroll: syncConversationFollow,
    onDisclosureInteraction,
    showJumpLatest,
    jumpToLatest,
  } = useConversationScroll(activeSessionKey, conversationTab);

  useEffect(() => {
    if (!activeSessionKey || conversationTab !== "chat" || compact) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeSessionKey, conversationTab, compact]);

  useEffect(() => {
    if (!navigationPending) return;
    setWorkspacePicker((current) =>
      current.open ? { ...current, open: false } : current,
    );
  }, [navigationPending]);

  const moveToProductSession = async (productSessionId: string) => {
    const target = knownSessions.find(
      (item) =>
        workspaceSessionKey(
          item.workspaceRoot,
          item.profileId,
          item.sessionId,
        ) === productSessionId,
    );
    if (!target || navigationBlocked || productSessionId === activeSessionKey)
      return;
    const outcome = await workspaceProduct.openSession({
      sessionId: target.sessionId,
      cwd: target.workspaceRoot,
      profileId: target.profileId,
      resolveLaunch: false,
    });
    if (outcome !== "opened") return;
    if (compact) setSidebarCollapsed(true);
  };
  const dismissSavedLink = () => {
    setSavedLink(null);
    setSavedLinkError(null);
    const url = new URL(window.location.href);
    if (activeSessionKey) url.searchParams.set("s", activeSessionKey);
    else url.searchParams.delete("s");
    window.history.replaceState(null, "", url);
  };
  const openSavedLink = async () => {
    const reference = savedLink?.reference;
    if (!reference || !session.authenticated || savedLinkOpening) return;
    if (
      navigationBlocked ||
      activeTurnId ||
      conversation.queue.pending.length
    ) {
      setSavedLinkError(
        "Finish the current response and remove queued messages before opening this conversation.",
      );
      return;
    }
    setSavedLinkOpening(true);
    setSavedLinkError(null);
    try {
      const outcome = await workspaceProduct.openSession({
        sessionId: reference.sessionId,
        profileId: reference.profileId,
        cwd: reference.workspaceRoot,
        resolveLaunch: false,
        requireExactWorkspace: true,
      });
      if (outcome === "opened") {
        setSavedLink(null);
        if (compact) setSidebarCollapsed(true);
      } else
        setSavedLinkError(
          "The saved conversation could not be opened. Check the server and try again.",
        );
    } finally {
      setSavedLinkOpening(false);
    }
  };
  useEffect(() => {
    if (
      !savedLink ||
      !session.authenticated ||
      session.status !== "connected" ||
      navigationBlocked
    )
      return;
    if (savedLink.key === activeSessionKey) {
      setSavedLink(null);
      return;
    }
    if (activeTurnId || autoLinkAttempted.current) return;
    if (
      !knownSessions.some(
        (item) =>
          workspaceSessionKey(
            item.workspaceRoot,
            item.profileId,
            item.sessionId,
          ) === savedLink.key,
      )
    )
      return;
    autoLinkAttempted.current = true;
    void openSavedLink();
  }, [
    savedLink,
    session.authenticated,
    session.status,
    navigationBlocked,
    activeTurnId,
    activeSessionKey,
    knownSessions,
  ]);
  const savedLinkPanel = savedLink ? (
    savedLink.reference ? (
      <SurfaceBoundary
        fallback={<DeferredSurface label="Loading saved conversation…" />}
      >
        <SavedSessionLinkPanel
          reference={savedLink.reference}
          serverOrigin={connection.endpoint}
          opening={savedLinkOpening}
          error={savedLinkError ?? workspaceProduct.state.error}
          onOpen={() => void openSavedLink()}
          onDismiss={dismissSavedLink}
        />
      </SurfaceBoundary>
    ) : (
      <section className={productStyles.sessionUnavailable} role="alert">
        <strong>This conversation link is invalid</strong>
        <p>
          It does not contain a complete server workspace and conversation
          reference.
        </p>
        <button type="button" onClick={dismissSavedLink}>
          Dismiss link
        </button>
      </section>
    )
  ) : null;
  const createSessionInWorkspace = async (workspacePath: string) => {
    if (
      !codingCapabilities.sessionCreationAvailable ||
      navigationBlocked ||
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
    if (compact) setSidebarCollapsed(true);
    setWorkspacePicker((current) => ({ ...current, open: false }));
  };
  const requestNewSession = (workspaceId?: string) => {
    if (!codingCapabilities.sessionCreationAvailable) return;
    if (compact) setSidebarCollapsed(true);
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
      clearKnownSessions(window.sessionStorage, connection);
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
      setKnownSessions([]);
      sessionDraftsRef.current.clear();
      previousActiveSessionKeyRef.current = null;
      draftRef.current = "";
      setDraft("");
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
    clearKnownSessions(window.sessionStorage, connection);
    clearRecentWorkspaces(window.sessionStorage, connection.endpoint);
    clearRecentWorkspaces(window.localStorage, connection.endpoint);
    setRecentWorkspaces([]);
    setKnownSessions([]);
    sessionDraftsRef.current.clear();
    previousActiveSessionKeyRef.current = null;
    draftRef.current = "";
    setDraft("");
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
          runtimeMutationBlocked ||
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

  const recoveryStop = conversation.interruptible ? (
    <button type="button" onClick={() => void conversation.interrupt()}>
      Stop
    </button>
  ) : null;

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
      <a className={productStyles.skipLink} href="#workspace-main">
        Skip to content
      </a>
      <main className="workspace-grid" id="workspace-main" tabIndex={-1}>
        <h1 className="sr-only">Octoscode coding workspace</h1>
        <NavigationSurface
          compact={compact}
          open={!sidebarCollapsed}
          onClose={() => setSidebarCollapsed(true)}
        >
          <SurfaceBoundary
            fallback={
              <aside
                className={productStyles.sidebarFallback}
                aria-label="Product navigation"
                aria-busy="true"
              >
                <SkeletonRows rows={5} />
                <span className="sr-only">Loading sessions…</span>
              </aside>
            }
          >
            <SessionSidebar
              collapsed={sidebarCollapsed}
              recentWorkspaces={recentWorkspaces}
              knownSessions={knownSessions}
              activeWorkspacePath={activeWorkspacePath}
              opened={session.opened}
              collapsedWorkspaceIds={collapsedWorkspaceIds}
              backgroundTurns={workspaceProduct.backgroundTurns}
              hasPendingInteraction={Boolean(
                interactions.approval || interactions.question,
              )}
              recoveryPhase={conversation.turnRecovery?.phase ?? null}
              activeTurnId={activeTurnId}
              turnStarting={turnStarting}
              selectedSessionId={activeSessionKey}
              loading={workspaceProduct.state.loading}
              error={workspaceProduct.state.error}
              settingsActive={settingsOpen}
              sessionCreationAvailable={
                codingCapabilities.sessionCreationAvailable
              }
              viewMode={sidebarView}
              orderMode={sidebarOrder}
              onCollapsedChange={setSidebarCollapsed}
              onNewSession={requestNewSession}
              onAddWorkspace={() => {
                if (compact) setSidebarCollapsed(true);
                setWorkspacePicker({ open: true, view: "add" });
              }}
              onViewModeChange={setSidebarView}
              onOrderModeChange={setSidebarOrder}
              onWorkspaceExpandedChange={(workspaceId, expanded) => {
                setCollapsedWorkspaceIds((current) => {
                  const next = new Set(current);
                  if (expanded) next.delete(workspaceId);
                  else next.add(workspaceId);
                  return next;
                });
              }}
              onSessionSelect={moveToProductSession}
              onSettings={() => {
                if (compact) setSidebarCollapsed(true);
                setSettingsOpen(true);
              }}
              onRetry={() => {
                void workspaceProduct.refresh();
              }}
            />
          </SurfaceBoundary>
        </NavigationSurface>

        <section className="conversation">
          <header className="conversation-header">
            {compact ? (
              <button
                type="button"
                className={productStyles.navigationTrigger}
                aria-label="Open sessions"
                aria-haspopup="dialog"
                aria-expanded={!sidebarCollapsed}
                onClick={() => setSidebarCollapsed(false)}
              >
                <MenuIcon size={20} />
              </button>
            ) : null}
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
                  className={
                    compact ? productStyles.compactReview : "review-chip"
                  }
                  type="button"
                  aria-label="Review changes"
                  title="Review changes"
                  onClick={() => void safety.openDiffReview()}
                >
                  {compact ? <DiffIcon size={20} /> : "Review changes"}
                </button>
              ) : null}
            </div>
          </header>
          <div
            ref={conversationScrollRef}
            className="conversation-scroll"
            role="region"
            aria-label="Conversation"
            tabIndex={0}
            onScroll={syncConversationFollow}
          >
            <div
              ref={conversationContentRef}
              className={productStyles.conversationContent}
              onClickCapture={onDisclosureInteraction}
              onKeyDownCapture={onDisclosureInteraction}
            >
              {workspaceProduct.launch.decision ? (
                <SurfaceBoundary
                  fallback={<DeferredSurface label="Loading launch…" />}
                >
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
                </SurfaceBoundary>
              ) : !session.opened && savedLink ? (
                savedLinkPanel
              ) : !session.opened ? (
                <div className={productStyles.newSessionHero}>
                  {codingCapabilities.sessionCreationAvailable ? (
                    <SurfaceBoundary
                      fallback={<DeferredSurface label="Loading workspaces…" />}
                    >
                      <NewSessionWorkspacePicker
                        presentation="hero"
                        cancelLabel="Change server"
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
                    </SurfaceBoundary>
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
                <SurfaceBoundary
                  fallback={<DeferredSurface label="Loading trajectory…" />}
                >
                  <SessionTrajectory
                    state={work.supervision}
                    onRefresh={() => void work.refresh()}
                    onOpenTask={(taskId) => void work.openTask(taskId)}
                    onCancelTask={(taskId) => void work.cancelTask(taskId)}
                  />
                </SurfaceBoundary>
              ) : (
                <>
                  {savedLinkPanel}
                  <SurfaceBoundary
                    key={activeSessionKey ?? undefined}
                    name="Conversation"
                    fallback={<DeferredSurface label="Loading conversation…" />}
                  >
                    <Timeline
                      key={activeSessionKey ?? undefined}
                      entries={conversation.timeline}
                      connected={session.connected}
                    />
                  </SurfaceBoundary>
                  {conversation.turnRecovery ? (
                    <SurfaceBoundary
                      fallback={
                        <DeferredSurface label="Checking response status…" />
                      }
                    >
                      <TurnRecoveryNotice
                        recovery={conversation.turnRecovery}
                        onRetry={() => void conversation.retryTurnRecovery()}
                      />
                    </SurfaceBoundary>
                  ) : null}
                  {activityLabel &&
                  !conversation.turnRecovery &&
                  !interactions.approval &&
                  !interactions.question ? (
                    <div
                      className={productStyles.thinkingIndicator}
                      role="status"
                    >
                      <span className={productStyles.thinkingDot} />
                      <span>{turnStarting ? "Starting…" : activityLabel}</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <div
            className={`composer-wrap${!session.opened || workspaceProduct.launch.decision || (conversationTab === "trajectory" && !navigationPending) ? " is-hidden" : ""}`}
          >
            {showJumpLatest ? (
              <button
                type="button"
                className={productStyles.jumpLatest}
                onClick={jumpToLatest}
              >
                Back to latest ↓
              </button>
            ) : null}
            {navigationPending ? (
              <div
                className={productStyles.pendingNavigation}
                role="status"
                aria-live="polite"
              >
                <span className={productStyles.pendingNavigationCopy}>
                  <strong>
                    {navigationPending.phase === "restoring"
                      ? "Finishing recovery before navigation"
                      : navigationPending.kind === "new-session"
                        ? "New Session opens next"
                        : "Session switch runs next"}
                  </strong>
                  <small title={navigationPending.cwd}>
                    {navigationPending.phase === "restoring"
                      ? "Octos accepted the turn. Durable state is syncing before this action continues in "
                      : "Octos is accepting the current turn. This action will continue automatically in "}
                    {workspaceName(navigationPending.cwd)}.
                  </small>
                </span>
                <button
                  type="button"
                  aria-label="Cancel pending Session navigation"
                  onClick={workspaceProduct.cancelPendingNavigation}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {session.opened && session.recovery.phase !== "healthy" ? (
              <div
                className={`recovery-banner recovery-${session.recovery.phase}`}
                role="status"
              >
                <span className="recovery-banner-mark">
                  <RefreshIcon size={16} />
                </span>
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
                      "Your session is reconnecting. Queued messages will wait until it is ready."}
                  </small>
                </span>
              </div>
            ) : interactions.approval ? (
              <SurfaceBoundary
                key={`approval:${interactions.approval.approvalId}`}
                name="Approval"
                actions={recoveryStop}
                fallback={<DeferredSurface label="Loading approval…" />}
              >
                <ApprovalPanel
                  approval={interactions.approval}
                  busy={interactions.busy}
                  error={interactions.error}
                  onDecide={(decision, scope) =>
                    void interactions.respondApproval(decision, scope)
                  }
                  {...(conversation.interruptible
                    ? { onInterrupt: () => void conversation.interrupt() }
                    : {})}
                  onReviewDiff={(previewId) =>
                    void safety.openDiffReview(previewId)
                  }
                />
              </SurfaceBoundary>
            ) : interactions.question ? (
              <SurfaceBoundary
                key={`question:${interactions.question.questionId}`}
                name="Question"
                actions={recoveryStop}
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
                  {...(conversation.interruptible
                    ? { onInterrupt: () => void conversation.interrupt() }
                    : {})}
                />
              </SurfaceBoundary>
            ) : conversationTab === "trajectory" ? null : (
              <>
                {commandError ? <p role="alert">{commandError}</p> : null}
                <QueuedPrompts
                  prompts={conversation.queue.pending}
                  onRemove={(turnId) => conversation.cancelQueuedPrompt(turnId)}
                />
                <SurfaceBoundary
                  key={activeSessionKey ?? undefined}
                  name="Message input"
                  actions={recoveryStop}
                  fallback={<DeferredSurface label="Loading message input…" />}
                >
                  <PromptComposer
                    key={activeSessionKey}
                    inputRef={composerRef}
                    draft={draft}
                    onDraftChange={(value) => {
                      draftRef.current = value;
                      setDraft(value);
                    }}
                    onSubmit={submit}
                    sendDisabled={Boolean(conversation.turnRecovery)}
                    recoveryHint={
                      conversation.turnRecovery ? (
                        <button
                          className={productStyles.recoveryLink}
                          type="button"
                          onClick={jumpToLatest}
                        >
                          Sending paused · View response status
                        </button>
                      ) : undefined
                    }
                    capabilities={session.opened?.capabilities}
                    disabled={
                      !session.connected ||
                      !codingCapabilities.turnStartAvailable ||
                      workspaceProduct.transitioning ||
                      Boolean(navigationPending)
                    }
                    focusOnMount={
                      !compact && !settingsOpen && !workspacePicker.open
                    }
                    placeholder={
                      session.connected && codingCapabilities.turnStartAvailable
                        ? "Ask Octos to change, explain, or review code…"
                        : session.connected
                          ? "This server cannot start coding turns"
                          : "Connect a workspace to begin"
                    }
                    turn={{
                      activeTurnId,
                      starting: turnStarting,
                      interruptingTurnId: conversation.interruptingTurnId,
                      available: conversation.interruptible,
                      onInterrupt: () => void conversation.interrupt(),
                    }}
                    contextPercent={contextPercent}
                    controls={
                      <>
                        {session.opened ? (
                          <SurfaceBoundary
                            fallback={
                              <div
                                className={
                                  productStyles.sessionControlsFallback
                                }
                                role="status"
                                aria-label="Loading session controls"
                              />
                            }
                          >
                            <SessionControlBar
                              ariaLabel="Session controls"
                              permission={permissionControl}
                              model={null}
                              runtimeModel={
                                codingCapabilities.runtimeStatusAvailable &&
                                work.supervision.statusAvailable
                                  ? {
                                      label: runtimeModelLabel,
                                      ...(pendingProfileDefault
                                        ? { pendingProfileDefault }
                                        : {}),
                                      onOpenSettings: () => {
                                        setSettingsSection(
                                          showModelsSettings
                                            ? "models"
                                            : "general",
                                        );
                                        setSettingsOpen(true);
                                      },
                                    }
                                  : null
                              }
                            />
                          </SurfaceBoundary>
                        ) : null}
                      </>
                    }
                  />
                </SurfaceBoundary>
              </>
            )}
          </div>
        </section>
      </main>
      {codingCapabilities.sessionCreationAvailable && workspacePicker.open ? (
        <SurfaceBoundary
          name="Workspaces"
          onDismiss={() =>
            setWorkspacePicker((current) => ({ ...current, open: false }))
          }
          fallback={<DeferredSurface label="Loading workspaces…" />}
        >
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
        </SurfaceBoundary>
      ) : null}
      {settingsOpen ? (
        <SurfaceBoundary
          name="Settings"
          onDismiss={() => setSettingsOpen(false)}
          fallback={<DeferredSurface label="Loading settings…" />}
        >
          <SettingsDialog
            open
            activeSection={settingsSection}
            labels={SETTINGS_LABELS}
            slots={{
              general: (
                <GeneralSettingsContent
                  {...(session.opened?.active_profile_id &&
                  session.opened.workspace_root
                    ? {
                        sessionReference: {
                          workspaceRoot: session.opened.workspace_root,
                          profileId: session.opened.active_profile_id,
                          sessionId: session.opened.session_id,
                        },
                      }
                    : {})}
                  serverOrigin={connection.endpoint}
                  connectionStatus={session.status}
                  workspaceLabel={
                    activeWorkspacePath
                      ? workspaceName(activeWorkspacePath)
                      : null
                  }
                  workspacePath={activeWorkspacePath || null}
                  displayProfile={session.opened?.active_profile_id ?? null}
                  locked={
                    workspaceProduct.transitioning || Boolean(navigationPending)
                  }
                  onDisconnect={() =>
                    hasUnfinishedWork
                      ? setLeaveConnectionAction("disconnect")
                      : disconnect()
                  }
                  onForgetConnection={() =>
                    hasUnfinishedWork
                      ? setLeaveConnectionAction("forget")
                      : forgetConnection()
                  }
                  onCopyDiagnostics={() => {
                    // Redacted by construction: origin only (never the
                    // token, never the WS query string), plus state the
                    // settings screen already displays.
                    const snapshot = {
                      generated_at: new Date().toISOString(),
                      user_agent: navigator.userAgent,
                      connection: {
                        endpoint: connection.endpoint,
                        status: session.status,
                        error: session.error ?? null,
                        recovery: session.recovery,
                      },
                      // Runtime lifecycle ring — newest-last entries of
                      // {at, kind, detail?}: method names and recovery
                      // phases only, never task output or params.
                      diagnostics: session.diagnostics,
                      session: session.opened
                        ? {
                            session_id: session.opened.session_id,
                            active_profile_id:
                              session.opened.active_profile_id ?? null,
                            capabilities: session.opened.capabilities ?? null,
                          }
                        : null,
                    };
                    return navigator.clipboard.writeText(
                      JSON.stringify(snapshot, null, 2),
                    );
                  }}
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
                            locked={runtimeMutationBlocked || models.state.busy}
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
                          locked={runtimeMutationBlocked}
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
        </SurfaceBoundary>
      ) : null}
      {leaveConnectionAction ? (
        <SurfaceBoundary
          name="Connection confirmation"
          onDismiss={() => setLeaveConnectionAction(null)}
          fallback={
            <DeferredSurface label="Loading connection confirmation…" />
          }
        >
          <LeaveConnectionDialog
            action={leaveConnectionAction}
            onCancel={() => setLeaveConnectionAction(null)}
            onConfirm={() => {
              const action = leaveConnectionAction;
              setLeaveConnectionAction(null);
              if (action === "forget") forgetConnection();
              else disconnect();
            }}
          />
        </SurfaceBoundary>
      ) : null}
      {safety.diffReview.active ? (
        <SurfaceBoundary
          name="Review"
          onDismiss={safety.closeDiffReview}
          fallback={<DeferredSurface label="Loading review…" />}
        >
          <DiffReviewDialog
            state={safety.diffReview}
            onClose={safety.closeDiffReview}
            onRefresh={() => void safety.openDiffReview()}
          />
        </SurfaceBoundary>
      ) : null}
      {work.supervision.detail.active ? (
        <SurfaceBoundary
          name="Task"
          onDismiss={work.closeTask}
          fallback={<DeferredSurface label="Loading task…" />}
        >
          <TaskDetailDialog
            state={work.supervision}
            onClose={work.closeTask}
            onLoadMore={() => void work.loadMoreOutput()}
            onReadArtifact={(artifact) => void work.readArtifact(artifact)}
            onLoadMoreArtifact={() => void work.loadMoreArtifact()}
          />
        </SurfaceBoundary>
      ) : null}
    </div>
  );
}

function DeferredSurface({ label }: { label: string }) {
  return (
    <div className={productStyles.deferredSurface} role="status">
      <SkeletonRows rows={3} />
      <span className="sr-only">{label}</span>
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
  return window.location.origin;
}

function workspaceSessionKey(
  workspacePath: string,
  profileId: string,
  sessionId: string,
): string {
  return JSON.stringify([workspacePath, profileId, sessionId]);
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
