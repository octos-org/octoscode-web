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
import { bindWebSessionIdToProfile } from "./session-identity.ts";
import type {
  ActiveSessionAuthority,
  ActiveSessionRuntimeEvent,
} from "./active-session-runtime.ts";
import { useServerConnection } from "./use-server-connection.ts";
import {
  coreProtocolCompatibilityError,
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
import { useTurnController } from "../composer/use-turn-controller.ts";
import type {
  PromptTurn,
  PromptTurnQueueSnapshot,
} from "../composer/turn-queue.ts";
import {
  addSystemMessage,
  foldNotification,
  terminalTurnId,
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
    onboarding: OnboardingRuntimeState;
    refresh: () => Promise<void>;
    listWorkspaceSessions: (cwd: string) => Promise<SessionListEntry[]>;
    switchSession: (sessionId: string) => Promise<WorkspaceOpenOutcome>;
    openSession: (input: {
      sessionId: string;
      cwd: string;
      profileId?: string | null;
    }) => Promise<WorkspaceOpenOutcome>;
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
  const launchTransitionRef = useRef(
    new LaunchTransitionCoordinator<
      SessionConnectionInput,
      LaunchResolveResult
    >(),
  );
  const transitioningRef = useRef(false);
  const pendingRestoreConfigRef = useRef<SessionConnectionInput | null>(null);
  const pendingTurnAfterHydrateRef = useRef<PromptTurn | null>(null);
  const [restoreRejected, setRestoreRejected] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
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
  const modelController = useModelSelection({
    client: currentClient,
    sessionId: currentSessionId,
    profileId: () =>
      currentAuthority()?.profileId ??
      connectionSnapshot.session?.opened.active_profile_id ??
      "",
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

  useEffect(
    () => () => {
      candidateAbortRef.current?.abort();
      launchTransitionRef.current.cancel();
    },
    [],
  );

  const markTransitioning = (next: boolean) => {
    transitioningRef.current = next;
    setTransitioning(next);
  };

  function resetProductSessionState(): void {
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
      if (event.reason === "candidate") {
        // Candidate adoption emits session-cleared before its raw diagnostics,
        // so resetting here would erase the new Session's staged event log.
        pendingRestoreConfigRef.current = null;
        setRestoreRejected(false);
      }
      setTimeline(timelineFromHydrate(event.hydrated));
      interactionController.restore(
        event.hydrated,
        event.authority.capabilities,
      );
      pendingTurnAfterHydrateRef.current = turnController.reconcileFromHydrate(
        event.hydrated,
      );
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
    reason: unknown,
  ): void {
    if (!launchTransitionRef.current.isCurrent(lease)) return;
    workspaceController.setError(errorMessage(reason));
    if (!restoreLaunchChoice(lease)) {
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
    if (decision.decision === "resume" && decision.resolved_profile) {
      setLaunch({ phase: "opening", cwd: config.cwd, decision: null });
      return launchProfileConfig(config, decision.resolved_profile);
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
      prepared = await prepareCandidateSession({
        config,
        signal: abortController.signal,
        createClient: (candidateConfig) =>
          new OctosUiClient({
            endpoint: candidateConfig.endpoint,
            token: candidateConfig.token,
            features: DEFAULT_UI_FEATURES,
          }),
        validateOpened: (nextOpened) => {
          assertCompatibleProtocol(nextOpened.capabilities);
          assertCodingSessionContract(nextOpened.capabilities);
        },
      });
      if (
        candidateAbortRef.current !== abortController ||
        !launchTransitionRef.current.isCurrent(lease) ||
        !activeRuntime.isCurrent(previous)
      ) {
        return "failed";
      }

      const queueState = turnController.snapshot();
      if (queueState.active || queueState.pending.length) {
        throw new Error(
          "The previous session started work while the new session was opening.",
        );
      }
      released = prepared.release();
      activeRuntime.adoptCandidate({
        expected: previous,
        config,
        candidate: released,
      });
      committed = true;
      if (!launchTransitionRef.current.commit(lease)) {
        throw new Error("The launch transition was superseded before commit.");
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
        if (released) released.client.disconnect();
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
    const queueState = turnController.snapshot();
    if (!target || target === authority?.sessionId || !config) return "failed";
    if (queueState.active || queueState.pending.length) {
      workspaceController.setError(
        "The foreground queue must settle before this Web client can switch sessions.",
      );
      return "failed";
    }
    return openCandidateSession({ ...config, sessionId: target });
  };

  const openWorkspaceSession = async (input: {
    sessionId: string;
    cwd: string;
    profileId?: string | null;
  }): Promise<WorkspaceOpenOutcome> => {
    const target = input.sessionId.trim();
    const cwd = input.cwd.trim();
    const authority = currentAuthority();
    const config = authority?.config;
    const queueState = turnController.snapshot();
    if (!target || !cwd || !config || !authority) return "failed";
    if (queueState.active || queueState.pending.length) {
      workspaceController.setError(
        "The foreground queue must settle before this Web client can open another workspace.",
      );
      return "failed";
    }
    const candidateConfig = {
      ...config,
      sessionId: target,
      cwd,
      profileId:
        input.profileId === null
          ? ""
          : input.profileId?.trim() || config.profileId,
    };
    const lease = launchTransitionRef.current.begin(candidateConfig);
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    onboardingController.reset();
    workspaceController.setError(null);
    markTransitioning(true);
    if (input.profileId === null) {
      // A catalog row already names an authoritative Session. Folder launch
      // resolution is for creating a Session and may resolve an unrelated
      // current/default profile; reopen the exact id without a stale hint.
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
  };

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
      turnController.settleTurn(terminal);
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
      onboarding: onboardingController.state,
      refresh: refreshWorkspace,
      listWorkspaceSessions: workspaceController.listWorkspaceSessions,
      switchSession,
      openSession: openWorkspaceSession,
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
