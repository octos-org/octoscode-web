import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { type SessionConnectionInput } from "./connection-lifecycle.ts";
import {
  prepareCandidateSession,
  type CandidateSessionSnapshot,
  type PreparedCandidateSession,
} from "./candidate-session.ts";
import { missingCodingSessionRequirements } from "./coding-capabilities.ts";
import {
  LaunchTransitionCoordinator,
  type LaunchTransitionLease,
} from "./launch-transition.ts";
import {
  PendingNavigationIntentController,
  type NavigationDispatchLease,
} from "./pending-navigation-intent.ts";
import { bindWebSessionIdToProfile } from "./session-identity.ts";
import {
  BackgroundTurnManager,
  type BackgroundTurnSessionScope,
  type BackgroundTurnSnapshot,
  type PreparedBackgroundTurn,
  type PreparedBackgroundTurnReclaim,
} from "./background-turn-manager.ts";
import {
  prepareRetainedCandidateSession,
  type ActiveSessionAuthority,
  type ActiveSessionRuntimeEvent,
} from "./active-session-runtime.ts";
import { useServerConnection } from "./use-server-connection.ts";
import {
  coreProtocolCompatibilityError,
  APPUI_ONBOARDING_METHODS,
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  DEFAULT_UI_FEATURES,
  OctosUiClient,
  parseTokenCostUpdate,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type ConnectionStatus,
  type LaunchResolveResult,
  type PermissionProfileUpdate,
  type ProfileLlmModel,
  type RpcNotification,
  type SessionOpened,
  type SessionListEntry,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
  type TaskArtifactRecord,
} from "@octos-org/octoscode-client";
import type { ObservedEvent } from "../inspector/EventInspector.tsx";
import { useBlockingInteractions } from "../interaction/use-blocking-interactions.ts";
import {
  useCodingSafety,
  type DiffReviewRuntimeState,
  type PermissionRuntimeState,
} from "../review/use-coding-safety.ts";
import {
  useTurnController,
  type TurnDispatchStateEvent,
} from "../composer/use-turn-controller.ts";
import type {
  PromptTurn,
  PromptTurnQueueSnapshot,
} from "../composer/turn-queue.ts";
import {
  addSystemMessage,
  foldNotification,
  terminalTurnId,
  terminalTurnOutcome,
  timelineFromHydrate,
  type TimelineEntry,
} from "../timeline/model.ts";
import type { SessionRecoverySnapshot } from "./durable-session.ts";
import { type SupervisionRuntimeState } from "../supervision/model.ts";
import { useSupervision } from "../supervision/use-supervision.ts";
import { type WorkspaceProductState } from "../workspace/model.ts";
import { useWorkspaceProduct } from "../workspace/use-workspace-product.ts";
import {
  EMPTY_LAUNCH_RUNTIME,
  type LaunchRuntimeState,
} from "../workspace/launch-model.ts";
import {
  useOnboarding,
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "../onboarding/use-onboarding.ts";
import {
  useModelSelection,
  type ModelSelectionRuntimeState,
} from "../models/use-model-selection.ts";
import type { ModelSettingsClient } from "../models/model-settings.ts";

export type {
  DiffReviewRuntimeState,
  PermissionRuntimeState,
} from "../review/use-coding-safety.ts";

const LEGACY_PROJECTION_METHODS = new Set<string>([
  CORE_UI_METHODS.MESSAGE_DELTA,
  CORE_UI_METHODS.MESSAGE_REASONING_DELTA,
  CORE_UI_METHODS.TOOL_STARTED,
  CORE_UI_METHODS.TOOL_PROGRESS,
  CORE_UI_METHODS.TOOL_COMPLETED,
  CORE_UI_METHODS.TURN_COMPLETED,
  CORE_UI_METHODS.TURN_ERROR,
]);

export type { SessionConnectionInput } from "./connection-lifecycle.ts";

export interface WorkspaceSessionOpenInput {
  sessionId: string;
  cwd: string;
  profileId?: string;
  resolveLaunch?: boolean;
}

export interface PendingWorkspaceNavigation {
  kind: "new-session" | "session";
  cwd: string;
  phase: "starting" | "restoring";
}

interface PendingWorkspaceNavigationIntent {
  input: WorkspaceSessionOpenInput;
  resolve: (outcome: WorkspaceOpenOutcome) => void;
}

export interface OctosSessionRuntime {
  connection: {
    status: ConnectionStatus;
    error: string | null;
    opened: SessionOpened | null;
    recovery: SessionRecoverySnapshot;
    capabilities: UiProtocolCapabilities | undefined;
    authenticated: boolean;
    restoreRejected: boolean;
    connected: boolean;
    connect: (input: SessionConnectionInput) => void;
    restore: (input: SessionConnectionInput) => void;
    disconnect: () => void;
  };
  conversation: {
    timeline: TimelineEntry[];
    setTimeline: Dispatch<SetStateAction<TimelineEntry[]>>;
    queue: PromptTurnQueueSnapshot;
    dispatchingTurnId: string | null;
    interruptible: boolean;
    interruptingTurnId: string | null;
    enqueuePrompt: (text: string) => void;
    interrupt: () => Promise<void>;
  };
  interactions: {
    approval: ApprovalRequested | null;
    question: UserQuestionRequested | null;
    busy: boolean;
    error: string | null;
    respondApproval: (
      decision: ApprovalDecision,
      scope: ApprovalScope,
    ) => Promise<void>;
    respondQuestion: (answers: UserQuestionAnswer[]) => Promise<void>;
  };
  safety: {
    permission: PermissionRuntimeState;
    diffReview: DiffReviewRuntimeState;
    refreshPermission: () => Promise<void>;
    updatePermission: (update: PermissionProfileUpdate) => Promise<void>;
    openDiffReview: (previewId?: string) => Promise<void>;
    closeDiffReview: () => void;
  };
  models: {
    state: ModelSelectionRuntimeState;
    refresh: () => Promise<void>;
    select: (model: ProfileLlmModel) => Promise<void>;
    management: {
      client: ModelSettingsClient | null;
      profileId: string;
      authorityKey: string;
      capabilities: UiProtocolCapabilities | undefined;
      available: boolean;
    };
  };
  work: {
    supervision: SupervisionRuntimeState;
    refresh: () => Promise<void>;
    openTask: (taskId: string) => Promise<void>;
    closeTask: () => void;
    loadMoreOutput: () => Promise<void>;
    cancelTask: (taskId: string) => Promise<void>;
    readArtifact: (artifact: TaskArtifactRecord) => Promise<void>;
    loadMoreArtifact: () => Promise<void>;
  };
  workspaceProduct: {
    state: WorkspaceProductState;
    launch: LaunchRuntimeState;
    transitioning: boolean;
    pendingNavigation: PendingWorkspaceNavigation | null;
    backgroundTurns: readonly BackgroundTurnSnapshot[];
    onboarding: OnboardingRuntimeState;
    refresh: () => Promise<void>;
    listWorkspaceSessions: (cwd: string) => Promise<SessionListEntry[]>;
    switchSession: (sessionId: string) => Promise<WorkspaceOpenOutcome>;
    openSession: (
      input: WorkspaceSessionOpenInput,
    ) => Promise<WorkspaceOpenOutcome>;
    cancelPendingNavigation: () => void;
    deleteSession: (sessionId: string) => Promise<void>;
    chooseLaunchProfile: (profileId: string) => Promise<void>;
    cancelLaunch: () => void;
    retryOnboarding: () => Promise<void>;
    submitOnboarding: (submission: OnboardingSubmission) => Promise<void>;
  };
  diagnostics: { events: ObservedEvent[]; omittedEvents: number };
}

export type WorkspaceOpenOutcome = "opened" | "awaiting_choice" | "failed";

export function useOctosSession(): OctosSessionRuntime {
  const runtimeEventSinkRef = useRef<
    (event: ActiveSessionRuntimeEvent<OctosUiClient>) => void
  >(() => undefined);
  const serverConnection = useServerConnection({
    createClient: (config) =>
      new OctosUiClient({
        endpoint: config.endpoint,
        token: config.token,
        features: DEFAULT_UI_FEATURES,
      }),
    validateServerCapabilities: assertCompatibleProtocol,
    validateSessionCapabilities: (capabilities) => {
      assertCompatibleProtocol(capabilities);
      assertCodingSessionContract(capabilities);
    },
    isFatalSessionError: (reason) =>
      isFatalSessionContractError(errorMessage(reason)),
    onEvent: (event) => runtimeEventSinkRef.current(event),
  });
  const activeRuntime = serverConnection.runtime;
  const connectionSnapshot = serverConnection.snapshot;
  const eventId = useRef(0);
  const candidateAbortRef = useRef<AbortController | null>(null);
  const lifecycleEpochRef = useRef(0);
  const backgroundTurnManagerRef = useRef<BackgroundTurnManager<OctosUiClient>>(
    new BackgroundTurnManager<OctosUiClient>(),
  );
  const pendingBackgroundHandoffRef = useRef<{
    lease: LaunchTransitionLease;
    sourceGeneration: number;
    sourceClient: OctosUiClient;
    handoff: PreparedBackgroundTurn;
  } | null>(null);
  const pendingBackgroundReclaimRef = useRef<{
    lease: LaunchTransitionLease;
    scope: BackgroundTurnSessionScope;
    reclaim: PreparedBackgroundTurnReclaim<OctosUiClient>;
  } | null>(null);
  const launchTransitionRef = useRef(
    new LaunchTransitionCoordinator<
      SessionConnectionInput,
      LaunchResolveResult
    >(),
  );
  const pendingNavigationControllerRef = useRef(
    new PendingNavigationIntentController<PendingWorkspaceNavigationIntent>(),
  );
  const pendingNavigationDispatchRef = useRef<{
    client: OctosUiClient;
    sessionId: string;
    turnId: string;
    lease: NavigationDispatchLease;
  } | null>(null);
  const turnDispatchEventSinkRef = useRef<
    (event: TurnDispatchStateEvent) => void
  >(() => undefined);
  const transitioningRef = useRef(false);
  const pendingRestoreConfigRef = useRef<SessionConnectionInput | null>(null);
  const pendingTurnAfterHydrateRef = useRef<PromptTurn | null>(null);
  const [restoreRejected, setRestoreRejected] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingWorkspaceNavigation | null>(null);
  const [backgroundTurns, setBackgroundTurns] = useState<
    readonly BackgroundTurnSnapshot[]
  >([]);
  const [eventLog, setEventLog] = useState<{
    events: ObservedEvent[];
    omitted: number;
  }>({ events: [], omitted: 0 });
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const currentAuthority = () => activeRuntime.currentAuthority();
  const currentClient = () => currentAuthority()?.client ?? null;
  const currentSessionId = () => currentAuthority()?.sessionId ?? "";
  const currentCapabilities = () => currentAuthority()?.capabilities;
  const interactionController = useBlockingInteractions({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
    onInvalid: (title, body) => {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `invalid-interaction:${crypto.randomUUID()}`,
          title,
          body,
          "error",
        ),
      );
    },
  });
  const approval = interactionController.approval;
  const question = interactionController.question;
  const decisionBusy = interactionController.busy;
  const decisionError = interactionController.error;
  const turnController = useTurnController({
    client: currentClient,
    sessionId: currentSessionId,
    canEnqueue: () => {
      const snapshot = activeRuntime.getSnapshot();
      return (
        snapshot.status === "connected" &&
        snapshot.session !== null &&
        !transitioningRef.current &&
        pendingNavigationControllerRef.current.snapshot().intent === null &&
        supportsMethod(currentCapabilities(), CORE_UI_METHODS.TURN_START) &&
        snapshot.recovery.phase === "healthy"
      );
    },
    canStart: () => {
      const snapshot = activeRuntime.getSnapshot();
      return (
        !transitioningRef.current &&
        supportsMethod(currentCapabilities(), CORE_UI_METHODS.TURN_START) &&
        snapshot.recovery.phase === "healthy"
      );
    },
    canInterrupt: () =>
      supportsMethod(currentCapabilities(), CORE_UI_METHODS.TURN_INTERRUPT),
    setTimeline,
    setConnectionError: (message) => activeRuntime.reportError(message),
    onDispatchState: (event) => turnDispatchEventSinkRef.current(event),
  });
  const supervisionController = useSupervision({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
  });
  const supervision = supervisionController.state;
  const codingSafetyController = useCodingSafety({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
    onPermissionApplied: (client) => {
      void supervisionController.refresh(client);
    },
  });
  const permission = codingSafetyController.permission;
  const diffReview = codingSafetyController.diffReview;
  const workspaceController = useWorkspaceProduct({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
    connectionConfig: () => currentAuthority()?.config ?? null,
  });
  const workspace = workspaceController.state;
  const activeProfileId = () =>
    currentAuthority()?.profileId ??
    connectionSnapshot.session?.opened.active_profile_id ??
    "";
  const modelController = useModelSelection({
    client: currentClient,
    sessionId: currentSessionId,
    profileId: activeProfileId,
    capabilities: currentCapabilities,
  });
  const [launch, setLaunch] =
    useState<LaunchRuntimeState>(EMPTY_LAUNCH_RUNTIME);
  const onboardingController = useOnboarding({
    client: currentClient,
    capabilities: currentCapabilities,
    onConfigured: async (profileId, client) => {
      const transition = launchTransitionRef.current.current();
      const authority = currentAuthority();
      if (!transition || !authority || authority.client !== client) {
        throw new Error("The server connection changed during onboarding.");
      }
      const { config, lease } = transition;
      setLaunch((current) => ({ ...current, phase: "opening" }));
      const opening = openCandidateSession(
        launchProfileConfig(config, profileId),
        lease,
      );
      try {
        const outcome = await opening;
        if (!launchTransitionRef.current.isCurrent(lease)) return;
        if (outcome !== "opened") {
          throw new Error("The new coding session could not be opened.");
        }
        onboardingController.reset();
      } catch (reason) {
        failLaunchTransition(lease, reason);
        throw reason;
      }
    },
  });

  runtimeEventSinkRef.current = handleRuntimeEvent;
  turnDispatchEventSinkRef.current = handleTurnDispatchState;

  useEffect(
    () =>
      backgroundTurnManagerRef.current.subscribe(() => {
        setBackgroundTurns([...backgroundTurnManagerRef.current.getSnapshot()]);
      }),
    [],
  );

  useEffect(() => {
    turnController.setAcceptedOwnerInteraction(Boolean(approval || question));
  }, [approval, question, turnController.dispatchingTurnId]);

  useEffect(() => {
    publishNavigationAuthority(currentAuthority());
  }, [connectionSnapshot.phase, connectionSnapshot.status]);

  useEffect(() => {
    const epoch = ++lifecycleEpochRef.current;
    return () => {
      resetPendingNavigation(false);
      candidateAbortRef.current?.abort();
      launchTransitionRef.current.cancel();
      const pending = pendingBackgroundHandoffRef.current;
      pendingBackgroundHandoffRef.current = null;
      pending?.handoff.rollback();
      const reclaim = pendingBackgroundReclaimRef.current;
      pendingBackgroundReclaimRef.current = null;
      reclaim?.reclaim.rollback();
      queueMicrotask(() => {
        // React StrictMode immediately mounts the same hook again after its
        // development-only cleanup. Only a true final unmount owns shutdown
        // of parked sockets; the remount advances this epoch first.
        if (lifecycleEpochRef.current === epoch) {
          backgroundTurnManagerRef.current.dispose();
        }
      });
    };
  }, []);

  const markTransitioning = (next: boolean) => {
    transitioningRef.current = next;
    setTransitioning(next);
  };

  function handleTurnDispatchState(event: TurnDispatchStateEvent): void {
    const authority = currentAuthority();
    if (
      !authority ||
      authority.client !== event.client ||
      authority.sessionId !== event.sessionId
    ) {
      return;
    }
    const controller = pendingNavigationControllerRef.current;
    if (event.state === "dispatching") {
      const superseded = controller.snapshot().intent;
      superseded?.resolve("failed");
      const authorityKey = `${authority.generation}:${authority.sessionId}`;
      const lease = controller.beginDispatch(authorityKey, event.turnId);
      pendingNavigationDispatchRef.current = {
        client: event.client,
        sessionId: event.sessionId,
        turnId: event.turnId,
        lease,
      };
      return;
    }
    const dispatch = pendingNavigationDispatchRef.current;
    if (
      !dispatch ||
      dispatch.client !== event.client ||
      dispatch.sessionId !== event.sessionId ||
      dispatch.turnId !== event.turnId
    ) {
      return;
    }
    pendingNavigationDispatchRef.current = null;
    if (event.state === "accepted") {
      const released = controller.acceptDispatch(dispatch.lease);
      if (released) {
        const snapshot = activeRuntime.getSnapshot();
        if (snapshot.phase !== "ready") {
          if (controller.holdUntilReady(released)) {
            setPendingNavigation((current) =>
              current ? { ...current, phase: "restoring" } : current,
            );
          } else {
            setPendingNavigation(null);
            released.intent.resolve("failed");
          }
        } else {
          executePendingNavigation(released.intent);
        }
      } else {
        setPendingNavigation(null);
      }
      return;
    }
    const cancelled = controller.snapshot().intent;
    const retired =
      event.state === "rejected"
        ? controller.rejectDispatch(dispatch.lease)
        : controller.cancelDispatch(dispatch.lease);
    if (!retired) return;
    setPendingNavigation(null);
    cancelled?.resolve("failed");
  }

  function resetPendingNavigation(publish = true): void {
    const pending = pendingNavigationControllerRef.current.snapshot().intent;
    pendingNavigationControllerRef.current.reset();
    pendingNavigationDispatchRef.current = null;
    if (publish) setPendingNavigation(null);
    pending?.resolve("failed");
  }

  function cancelPendingNavigation(): void {
    const pending = pendingNavigationControllerRef.current.cancelIntent();
    if (!pending) return;
    setPendingNavigation(null);
    pending.resolve("failed");
  }

  function publishNavigationAuthority(
    authority: ActiveSessionAuthority<OctosUiClient> | null,
  ): void {
    const controller = pendingNavigationControllerRef.current;
    const authorityKey = authority
      ? `${authority.generation}:${authority.sessionId}`
      : null;
    const changed = controller.snapshot().authorityKey !== authorityKey;
    const retired = controller.setAuthority(authorityKey);
    if (changed) pendingNavigationDispatchRef.current = null;
    if (!retired) return;
    setPendingNavigation(null);
    retired.resolve("failed");
  }

  function executePendingNavigation(
    intent: PendingWorkspaceNavigationIntent,
  ): void {
    setPendingNavigation(null);
    void performWorkspaceSessionOpen(intent.input)
      .then(intent.resolve)
      .catch(() => intent.resolve("failed"));
  }

  function rollbackBackgroundHandoff(lease?: LaunchTransitionLease): void {
    const pending = pendingBackgroundHandoffRef.current;
    if (!pending || (lease && pending.lease !== lease)) return;
    pending.handoff.rollback();
    pendingBackgroundHandoffRef.current = null;
  }

  function rollbackBackgroundReclaim(lease?: LaunchTransitionLease): void {
    const pending = pendingBackgroundReclaimRef.current;
    if (!pending || (lease && pending.lease !== lease)) return;
    pending.reclaim.rollback();
    pendingBackgroundReclaimRef.current = null;
  }

  function rollbackBackgroundOwnership(lease?: LaunchTransitionLease): void {
    // Restore capacity only after the source reservation has been released.
    rollbackBackgroundHandoff(lease);
    rollbackBackgroundReclaim(lease);
  }

  function prepareBackgroundReclaim(
    config: SessionConnectionInput,
    lease: LaunchTransitionLease,
  ): PreparedBackgroundTurnReclaim<OctosUiClient> | null {
    const scope: BackgroundTurnSessionScope = {
      workspaceRoot: config.cwd.trim(),
      profileId: config.profileId.trim(),
      sessionId: config.sessionId.trim(),
    };
    const existing = pendingBackgroundReclaimRef.current;
    if (
      existing?.lease === lease &&
      sameBackgroundScope(existing.scope, scope) &&
      existing.reclaim.client.status === "connected"
    ) {
      return existing.reclaim;
    }
    if (existing) {
      // A target-scope exchange and its source handoff share one capacity
      // transaction. Release the source reservation first, then restore the
      // old target slot; the caller immediately prepares both for the new
      // scope, so a full manager can never later commit MAX + 1 owners.
      rollbackBackgroundHandoff(existing.lease);
      rollbackBackgroundReclaim(existing.lease);
    }
    if (!scope.workspaceRoot || !scope.profileId || !scope.sessionId)
      return null;
    const reclaim = backgroundTurnManagerRef.current.prepareReclaim(scope);
    if (!reclaim) return null;
    pendingBackgroundReclaimRef.current = { lease, scope, reclaim };
    return reclaim;
  }

  function prepareBackgroundHandoff(
    authority: ActiveSessionAuthority<OctosUiClient>,
    lease: LaunchTransitionLease,
  ): boolean {
    const existing = pendingBackgroundHandoffRef.current;
    if (
      existing?.lease === lease &&
      existing.sourceGeneration === authority.generation &&
      existing.sourceClient === authority.client
    ) {
      return true;
    }
    if (existing) rollbackBackgroundHandoff(existing.lease);
    const queue = turnController.snapshot();
    if (queue.pending.length) {
      workspaceController.setError(
        "Queued prompts belong to this Session. Let them run or stop queuing before switching.",
      );
      return false;
    }
    const ownership = turnController.activeTurnOwnership();
    if (ownership === "dispatching") {
      workspaceController.setError(
        "Wait for Octos to accept the current turn before switching Sessions.",
      );
      return false;
    }
    if (ownership !== "local-owner") return true;
    const turn = turnController.backgroundHandoffTurn();
    if (!turn || !authority.sessionId) {
      workspaceController.setError(
        "The current turn cannot be moved to the background yet.",
      );
      return false;
    }
    try {
      const handoff = backgroundTurnManagerRef.current.prepare({
        client: authority.client,
        workspaceRoot: authority.cwd,
        profileId: authority.profileId,
        sessionId: authority.sessionId,
        turnId: turn.turnId,
        initialState:
          turn.state === "running" && (approval || question)
            ? "waiting"
            : turn.state,
      });
      pendingBackgroundHandoffRef.current = {
        lease,
        sourceGeneration: authority.generation,
        sourceClient: authority.client,
        handoff,
      };
      return true;
    } catch (reason) {
      workspaceController.setError(errorMessage(reason));
      return false;
    }
  }

  function resetProductSessionState(): void {
    resetPendingNavigation();
    pendingTurnAfterHydrateRef.current = null;
    setEventLog({ events: [], omitted: 0 });
    setTimeline([]);
    turnController.reset();
    interactionController.reset();
    codingSafetyController.reset();
    supervisionController.reset();
    onboardingController.reset();
    workspaceController.reset();
    modelController.reset();
  }

  function handleRuntimeEvent(
    event: ActiveSessionRuntimeEvent<OctosUiClient>,
  ): void {
    if (event.type === "session-cleared") {
      resetProductSessionState();
      setLaunch(EMPTY_LAUNCH_RUNTIME);
      return;
    }
    if (event.type === "authenticated") {
      resetPendingNavigation();
      configureCodingSurfaces(event.authority.capabilities);
      setLaunch(EMPTY_LAUNCH_RUNTIME);
      markTransitioning(false);
      return;
    }
    if (event.type === "raw-notification") {
      appendObservedEvent(event.notification);
      return;
    }
    if (event.type === "session-hydrate") {
      if (!activeRuntime.isCurrent(event.authority)) return;
      publishNavigationAuthority(event.authority);
      if (event.reason === "candidate") {
        // Candidate adoption emits session-cleared before its raw diagnostics,
        // so resetting here would erase the new Session's staged event log.
        pendingRestoreConfigRef.current = null;
        setRestoreRejected(false);
      }
      setTimeline(timelineFromHydrate(event.hydrated));
      const restoredInteractionWaiting = interactionController.restore(
        event.hydrated,
        event.authority.capabilities,
      );
      const pendingReclaim = pendingBackgroundReclaimRef.current;
      const reclaimedOwner =
        event.reason === "candidate" &&
        pendingReclaim?.reclaim.client === event.authority.client &&
        sameBackgroundScope(pendingReclaim.scope, {
          workspaceRoot: event.authority.cwd,
          profileId: event.authority.profileId,
          sessionId: event.authority.sessionId,
        })
          ? pendingReclaim.reclaim.snapshot()
          : null;
      pendingTurnAfterHydrateRef.current = turnController.reconcileFromHydrate(
        event.hydrated,
        event.reason === "recovery",
      );
      if (reclaimedOwner) {
        turnController.restoreTransportOwnership({
          turnId: reclaimedOwner.turnId,
          state: reclaimedOwner.state,
        });
      }
      turnController.setAcceptedOwnerInteraction(restoredInteractionWaiting);
      // A same-transport durable recovery does not replace the capability/RPC
      // authority. Candidate and reconnect hydrates do, so only those retire
      // controller requests that may belong to an obsolete socket.
      if (event.reason !== "recovery") {
        configureCodingSurfaces(event.authority.capabilities);
      }
      if (event.reason === "candidate") {
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        markTransitioning(false);
      }
      return;
    }
    if (event.type === "notification") {
      applyProductNotification(event.notification, event.authority);
      return;
    }
    if (!activeRuntime.isCurrent(event.authority)) return;
    if (event.reason !== "recovery") {
      void codingSafetyController.refreshPermission(event.authority.client);
      void supervisionController.refresh(event.authority.client);
      void workspaceController.refresh(event.authority.client);
      void modelController.refresh(event.authority.client);
    }
    const nextTurn = pendingTurnAfterHydrateRef.current;
    pendingTurnAfterHydrateRef.current = null;
    if (nextTurn) void turnController.startTurn(nextTurn);
    publishNavigationAuthority(event.authority);
    const releasedNavigation =
      pendingNavigationControllerRef.current.releaseReady(
        `${event.authority.generation}:${event.authority.sessionId}`,
      );
    if (releasedNavigation) executePendingNavigation(releasedNavigation.intent);
  }

  function appendObservedEvent(notification: RpcNotification): void {
    setEventLog((current) => {
      const appended = [
        ...current.events,
        {
          id: eventId.current++,
          at: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          notification,
        },
      ];
      const overflow = Math.max(0, appended.length - 100);
      return {
        events: appended.slice(-100),
        omitted: current.omitted + overflow,
      };
    });
  }

  function restoreLaunchChoice(lease: LaunchTransitionLease): boolean {
    const choice = launchTransitionRef.current.restoreChoice(lease);
    if (!choice) return false;
    setLaunch({
      phase: "awaiting_choice",
      cwd: choice.config.cwd,
      decision: choice.decision,
    });
    return true;
  }

  function failLaunchTransition(
    lease: LaunchTransitionLease,
    reason?: unknown,
  ): void {
    if (!launchTransitionRef.current.isCurrent(lease)) return;
    // Some preparation failures already set a precise, actionable product
    // error (notably the retained-owner capacity boundary). Do not replace it
    // with a generic transition failure while still cleaning up the lease.
    if (reason !== undefined)
      workspaceController.setError(errorMessage(reason));
    if (!restoreLaunchChoice(lease)) {
      rollbackBackgroundOwnership(lease);
      launchTransitionRef.current.discard(lease);
      setLaunch(EMPTY_LAUNCH_RUNTIME);
    }
    markTransitioning(false);
  }

  const connect = (input: SessionConnectionInput) => {
    // Authentication and selecting a coding Session are separate product
    // actions. The auth gate must not create a hidden default session.
    beginConnection(input, false);
  };

  const restore = (input: SessionConnectionInput) => {
    // Refresh restoration is a best-effort Session transition after the
    // authenticated server shell is committed. A stale Session must never
    // turn valid credentials into a connection failure.
    beginConnection(input, true);
  };

  const beginConnection = (
    input: SessionConnectionInput,
    restoreAfterAuthentication = false,
  ) => {
    resetPendingNavigation();
    rollbackBackgroundOwnership();
    backgroundTurnManagerRef.current.clear();
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    const config = normalizeConnectionInput(input);
    pendingRestoreConfigRef.current =
      restoreAfterAuthentication && config.sessionId && config.cwd
        ? config
        : null;
    setRestoreRejected(false);
    markTransitioning(false);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    void activeRuntime
      .authenticate(config)
      .then((authority) => {
        if (!authority || !activeRuntime.isCurrent(authority)) return;
        const restoreTarget = pendingRestoreConfigRef.current;
        pendingRestoreConfigRef.current = null;
        if (!restoreTarget) return;
        void openCandidateSession(restoreTarget).then((outcome) => {
          if (outcome === "opened") return;
          if (
            activeRuntime.isCurrent(authority) &&
            authority.client.status === "connected"
          ) {
            setRestoreRejected(true);
          }
        });
      })
      .catch(() => {
        pendingRestoreConfigRef.current = null;
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        markTransitioning(false);
      });
  };

  async function resolveInitialLaunch(
    authority: ActiveSessionAuthority<OctosUiClient>,
    config: SessionConnectionInput,
    lease: LaunchTransitionLease,
  ): Promise<SessionConnectionInput | null> {
    const stillOwnsTransition = () =>
      launchTransitionRef.current.isCurrent(lease) &&
      activeRuntime.isCurrent(authority);
    if (!config.cwd) return stillOwnsTransition() ? config : null;
    const capabilities = authority.capabilities;
    if (
      !supportsFeature(
        capabilities,
        CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1,
      ) ||
      !supportsMethod(capabilities, CORE_UI_METHODS.LAUNCH_RESOLVE)
    ) {
      setLaunch(EMPTY_LAUNCH_RUNTIME);
      return config;
    }
    const decision = await authority.client.resolveLaunch({
      cwd: config.cwd,
      ...(config.profileId ? { profile_id: config.profileId } : {}),
    });
    if (!stillOwnsTransition()) return null;
    const automaticProfile =
      decision.decision === "resume" ||
      (decision.decision === "activate" &&
        config.sessionId.trim().startsWith("web-"))
        ? decision.resolved_profile
        : undefined;
    if (automaticProfile) {
      setLaunch({ phase: "opening", cwd: config.cwd, decision: null });
      return launchProfileConfig(config, automaticProfile);
    }
    if (!launchTransitionRef.current.rememberDecision(lease, decision)) {
      return null;
    }
    setLaunch({
      phase: "awaiting_choice",
      cwd: config.cwd,
      decision,
    });
    if (decision.decision === "no_profile") {
      void onboardingController.prepare();
    }
    return null;
  }

  async function openCandidateSession(
    config: SessionConnectionInput,
    existingLease?: LaunchTransitionLease,
  ): Promise<WorkspaceOpenOutcome> {
    const lease = existingLease ?? launchTransitionRef.current.begin(config);
    if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
    const previous = currentAuthority();
    if (!previous || previous.client.status !== "connected") {
      failLaunchTransition(lease, "The Octos server connection is not ready.");
      return "failed";
    }
    if (missingCodingSessionRequirements(previous.capabilities).length) {
      failLaunchTransition(
        lease,
        "This Octos server cannot open a coding session in the Web app.",
      );
      return "failed";
    }
    let reclaim: PreparedBackgroundTurnReclaim<OctosUiClient> | null = null;
    try {
      reclaim = prepareBackgroundReclaim(config, lease);
    } catch (reason) {
      failLaunchTransition(lease, reason);
      return "failed";
    }
    if (!prepareBackgroundHandoff(previous, lease)) {
      rollbackBackgroundReclaim(lease);
      failLaunchTransition(lease);
      return "failed";
    }

    candidateAbortRef.current?.abort();
    const abortController = new AbortController();
    candidateAbortRef.current = abortController;

    markTransitioning(true);
    const choice = launchTransitionRef.current.restoreChoice(lease);
    setLaunch({
      phase: "opening",
      cwd: config.cwd,
      decision: choice?.decision ?? null,
    });
    workspaceController.setError(null);
    let committed = false;
    let prepared: PreparedCandidateSession<OctosUiClient> | null = null;
    let released: CandidateSessionSnapshot<OctosUiClient> | null = null;
    try {
      const validateOpened = (nextOpened: SessionOpened) =>
        validateCandidateOpened(config, nextOpened, reclaim);
      prepared = reclaim
        ? await prepareRetainedCandidateSession({
            client: reclaim.client,
            config,
            signal: abortController.signal,
            validateOpened,
          })
        : await prepareCandidateSession({
            config,
            signal: abortController.signal,
            createClient: (candidateConfig) =>
              new OctosUiClient({
                endpoint: candidateConfig.endpoint,
                token: candidateConfig.token,
                features: DEFAULT_UI_FEATURES,
              }),
            validateOpened,
          });
      if (
        candidateAbortRef.current !== abortController ||
        !launchTransitionRef.current.isCurrent(lease)
      ) {
        return "failed";
      }
      if (!activeRuntime.isCurrent(previous)) {
        throw new Error(
          "The server connection changed while the new Session was opening.",
        );
      }

      const pendingHandoff = pendingBackgroundHandoffRef.current;
      const handoff =
        pendingHandoff?.lease === lease ? pendingHandoff.handoff : null;
      const queueState = turnController.snapshot();
      const ownership = turnController.activeTurnOwnership();
      if (queueState.pending.length || ownership === "dispatching") {
        throw new Error(
          "The previous session started work while the new session was opening.",
        );
      }
      if (ownership === "local-owner") {
        const activeTurn = turnController.backgroundHandoffTurn();
        if (!handoff || !activeTurn || activeTurn.turnId !== handoff.turnId) {
          throw new Error(
            "The previous session started another turn while the new session was opening.",
          );
        }
      }
      released = prepared.release();
      activeRuntime.adoptCandidate({
        expected: previous,
        config,
        candidate: released,
        preservePreviousTransport: handoff?.shouldPreserveTransport ?? false,
        authorizeCommit: () => launchTransitionRef.current.commit(lease),
      });
      committed = true;
      handoff?.commit();
      if (pendingBackgroundHandoffRef.current?.lease === lease) {
        pendingBackgroundHandoffRef.current = null;
      }
      reclaim?.commit();
      if (pendingBackgroundReclaimRef.current?.lease === lease) {
        pendingBackgroundReclaimRef.current = null;
      }
      return "opened";
    } catch (reason) {
      if (
        candidateAbortRef.current === abortController &&
        launchTransitionRef.current.isCurrent(lease)
      ) {
        failLaunchTransition(lease, reason);
      }
      return "failed";
    } finally {
      if (!committed) {
        if (released && !reclaim) released.client.disconnect();
        else prepared?.dispose();
      }
      if (candidateAbortRef.current === abortController) {
        candidateAbortRef.current = null;
        if (!committed) markTransitioning(false);
      }
    }
  }

  function configureCodingSurfaces(
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    codingSafetyController.configureCapabilities(capabilities);
    supervisionController.configureCapabilities(capabilities);
    workspaceController.configureCapabilities(capabilities);
    modelController.configureCapabilities(capabilities);
  }

  const disconnect = () => {
    resetPendingNavigation();
    rollbackBackgroundOwnership();
    backgroundTurnManagerRef.current.clear();
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    pendingRestoreConfigRef.current = null;
    setRestoreRejected(false);
    markTransitioning(false);
    activeRuntime.disconnect();
  };

  const refreshWorkspace = async () => {
    await workspaceController.refresh();
  };

  const switchSession = async (
    sessionId: string,
  ): Promise<WorkspaceOpenOutcome> => {
    const target = sessionId.trim();
    const authority = currentAuthority();
    const config = authority?.config;
    if (!target || target === authority?.sessionId || !config) return "failed";
    return openWorkspaceSession({
      sessionId: target,
      cwd: config.cwd,
      profileId: authority.profileId,
      resolveLaunch: false,
    });
  };

  const openWorkspaceSession = (
    input: WorkspaceSessionOpenInput,
  ): Promise<WorkspaceOpenOutcome> => {
    const target = input.sessionId.trim();
    const cwd = input.cwd.trim();
    if (!target || !cwd || !currentAuthority() || transitioningRef.current) {
      return Promise.resolve("failed");
    }
    if (turnController.snapshot().pending.length) {
      workspaceController.setError(
        "Queued prompts belong to this Session. Let them run or stop queuing before switching.",
      );
      return Promise.resolve("failed");
    }
    return new Promise<WorkspaceOpenOutcome>((resolve) => {
      const intent: PendingWorkspaceNavigationIntent = { input, resolve };
      const decision = pendingNavigationControllerRef.current.request(intent);
      if (decision.kind === "run-now") {
        void performWorkspaceSessionOpen(input)
          .then(resolve)
          .catch(() => resolve("failed"));
        return;
      }
      decision.replacedIntent?.resolve("failed");
      workspaceController.setError(null);
      setPendingNavigation({
        kind: input.resolveLaunch === false ? "session" : "new-session",
        cwd,
        phase: decision.stage === "ready" ? "restoring" : "starting",
      });
    });
  };

  async function performWorkspaceSessionOpen(
    input: WorkspaceSessionOpenInput,
  ): Promise<WorkspaceOpenOutcome> {
    const target = input.sessionId.trim();
    const cwd = input.cwd.trim();
    const authority = currentAuthority();
    const config = authority?.config;
    if (!target || !cwd || !config || !authority) return "failed";
    const candidateConfig = {
      ...config,
      sessionId: target,
      cwd,
      profileId: input.profileId?.trim() || config.profileId,
    };
    rollbackBackgroundOwnership();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    const lease = launchTransitionRef.current.begin(candidateConfig);
    try {
      prepareBackgroundReclaim(candidateConfig, lease);
    } catch (reason) {
      workspaceController.setError(errorMessage(reason));
      launchTransitionRef.current.discard(lease);
      return "failed";
    }
    if (!prepareBackgroundHandoff(authority, lease)) {
      rollbackBackgroundReclaim(lease);
      launchTransitionRef.current.discard(lease);
      return "failed";
    }
    onboardingController.reset();
    workspaceController.setError(null);
    markTransitioning(true);
    if (input.resolveLaunch === false) {
      // A catalog row already names an authoritative Session. Folder launch
      // resolution is for creating a Session and may resolve another default
      // profile; reopen with the server-confirmed id and profile tuple.
      setLaunch({ phase: "opening", cwd, decision: null });
      return openCandidateSession(candidateConfig, lease);
    }
    setLaunch({ phase: "resolving", cwd, decision: null });
    try {
      const resolved = await resolveInitialLaunch(
        authority,
        candidateConfig,
        lease,
      );
      if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
      if (!resolved) return "awaiting_choice";
      return openCandidateSession(resolved, lease);
    } catch (reason) {
      if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
      failLaunchTransition(lease, reason);
      return "failed";
    }
  }

  const chooseLaunchProfile = async (profileId: string) => {
    const target = profileId.trim();
    const transition = launchTransitionRef.current.current();
    const decision = transition?.decision;
    const authority = currentAuthority();
    const config = transition?.config;
    const lease = transition?.lease;
    const allowed = decision
      ? [decision.resolved_profile, ...decision.existing_profiles].filter(
          (candidate): candidate is string => Boolean(candidate),
        )
      : [];
    if (
      !target ||
      !authority ||
      !config ||
      !lease ||
      !decision ||
      !allowed.includes(target) ||
      candidateAbortRef.current !== null
    ) {
      return;
    }
    setLaunch((current) => ({ ...current, phase: "opening" }));
    const opening = openCandidateSession(
      launchProfileConfig(config, target),
      lease,
    );
    try {
      const outcome = await opening;
      if (!launchTransitionRef.current.isCurrent(lease)) return;
      if (outcome !== "opened") restoreLaunchChoice(lease);
    } catch (reason) {
      if (!launchTransitionRef.current.isCurrent(lease)) return;
      failLaunchTransition(lease, reason);
    }
  };

  const cancelLaunch = () => {
    rollbackBackgroundOwnership();
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    onboardingController.reset();
    workspaceController.setError(null);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    markTransitioning(false);
  };

  function applyProductNotification(
    notification: RpcNotification,
    authority: ActiveSessionAuthority<OctosUiClient>,
  ): void {
    if (!activeRuntime.isCurrent(authority)) return;
    codingSafetyController.observeNotification(notification);
    supervisionController.observeNotification(notification);
    const tokenCost = parseTokenCostUpdate(notification);
    if (tokenCost && tokenCost.sessionId === authority.sessionId) {
      workspaceController.observeTokenCost(tokenCost);
    }

    const canonicalProjection = supportsFeature(
      authority.capabilities,
      CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
    );
    const foldIntoTimeline = !(
      canonicalProjection && LEGACY_PROJECTION_METHODS.has(notification.method)
    );
    if (foldIntoTimeline) {
      setTimeline((current) => foldNotification(current, notification));
    }

    interactionController.observeNotification(notification);

    const terminal = foldIntoTimeline ? terminalTurnId(notification) : null;
    if (terminal) {
      interactionController.settleTurn(terminal);
      turnController.settleTurn(
        terminal,
        terminalTurnOutcome(notification) ?? "failed",
      );
    }
  }

  return {
    connection: {
      status: connectionSnapshot.status,
      error: connectionSnapshot.error,
      opened: connectionSnapshot.session?.opened ?? null,
      recovery: connectionSnapshot.recovery,
      capabilities:
        connectionSnapshot.session?.capabilities ??
        connectionSnapshot.serverCapabilities,
      connected:
        connectionSnapshot.status === "connected" &&
        connectionSnapshot.session !== null &&
        connectionSnapshot.recovery.phase === "healthy",
      authenticated: connectionSnapshot.authenticated,
      restoreRejected,
      connect,
      restore,
      disconnect,
    },
    conversation: {
      timeline,
      setTimeline,
      queue: turnController.queue,
      dispatchingTurnId: turnController.dispatchingTurnId,
      interruptible: turnController.interruptible,
      interruptingTurnId: turnController.interruptingTurnId,
      enqueuePrompt: turnController.enqueuePrompt,
      interrupt: turnController.interrupt,
    },
    interactions: {
      approval,
      question,
      busy: decisionBusy,
      error: decisionError,
      respondApproval: interactionController.respondApproval,
      respondQuestion: interactionController.respondQuestion,
    },
    safety: {
      permission,
      diffReview,
      refreshPermission: codingSafetyController.refreshPermission,
      updatePermission: codingSafetyController.updatePermission,
      openDiffReview: codingSafetyController.openDiffReview,
      closeDiffReview: codingSafetyController.closeDiffReview,
    },
    models: {
      state: modelController.state,
      refresh: modelController.refresh,
      select: modelController.select,
      management: {
        client: currentClient(),
        profileId: activeProfileId(),
        authorityKey: `${currentAuthority()?.generation ?? 0}:${activeProfileId()}`,
        capabilities: currentCapabilities(),
        available:
          supportsMethod(
            currentCapabilities(),
            APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
          ) ||
          supportsMethod(
            currentCapabilities(),
            APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
          ),
      },
    },
    work: {
      supervision,
      refresh: supervisionController.refresh,
      openTask: supervisionController.openTaskDetail,
      closeTask: supervisionController.closeTaskDetail,
      loadMoreOutput: supervisionController.loadMoreTaskOutput,
      cancelTask: supervisionController.cancelTask,
      readArtifact: supervisionController.readTaskArtifact,
      loadMoreArtifact: supervisionController.loadMoreTaskArtifact,
    },
    workspaceProduct: {
      state: workspace,
      launch,
      transitioning,
      pendingNavigation,
      backgroundTurns,
      onboarding: onboardingController.state,
      refresh: refreshWorkspace,
      listWorkspaceSessions: workspaceController.listWorkspaceSessions,
      switchSession,
      openSession: openWorkspaceSession,
      cancelPendingNavigation,
      deleteSession: workspaceController.deleteSession,
      chooseLaunchProfile,
      cancelLaunch,
      retryOnboarding: onboardingController.prepare,
      submitOnboarding: onboardingController.submit,
    },
    diagnostics: {
      events: eventLog.events,
      omittedEvents: eventLog.omitted,
    },
  };
}

function launchProfileConfig(
  config: SessionConnectionInput,
  profileId: string,
): SessionConnectionInput {
  return {
    ...config,
    sessionId: bindWebSessionIdToProfile(config.sessionId, profileId),
    profileId,
  };
}

function normalizeConnectionInput(
  input: SessionConnectionInput,
): SessionConnectionInput {
  return {
    endpoint: input.endpoint.trim(),
    token: input.token,
    sessionId: input.sessionId.trim(),
    profileId: input.profileId.trim(),
    cwd: input.cwd.trim(),
  };
}

function sameBackgroundScope(
  left: BackgroundTurnSessionScope,
  right: BackgroundTurnSessionScope,
): boolean {
  return (
    left.workspaceRoot === right.workspaceRoot &&
    left.profileId === right.profileId &&
    left.sessionId === right.sessionId
  );
}

function validateCandidateOpened(
  config: SessionConnectionInput,
  opened: SessionOpened,
  reclaim: PreparedBackgroundTurnReclaim<OctosUiClient> | null,
): void {
  assertCompatibleProtocol(opened.capabilities);
  assertCodingSessionContract(opened.capabilities);
  if (opened.session_id !== config.sessionId) {
    throw new Error("session/open returned another Session id");
  }
  if (config.profileId && opened.active_profile_id !== config.profileId) {
    throw new Error("session/open returned another Profile");
  }
  if (
    reclaim &&
    (opened.workspace_root !== reclaim.workspaceRoot ||
      opened.active_profile_id !== reclaim.profileId)
  ) {
    throw new Error("session/open returned another Session scope");
  }
}

function isFatalSessionContractError(message: string): boolean {
  return (
    message.startsWith("Server protocol contract is incompatible") ||
    message.startsWith("Server lacks the coding Session contract") ||
    message === "session/hydrate returned an invalid result"
  );
}

function assertCompatibleProtocol(
  capabilities: UiProtocolCapabilities | undefined,
): void {
  const error = coreProtocolCompatibilityError(capabilities);
  if (error) {
    throw new Error(`Server protocol contract is incompatible: ${error}`);
  }
}

function assertCodingSessionContract(
  capabilities: UiProtocolCapabilities | undefined,
): void {
  const missing = missingCodingSessionRequirements(capabilities);
  if (missing.length) {
    throw new Error(
      `Server lacks the coding Session contract: ${missing.join(", ")}`,
    );
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
