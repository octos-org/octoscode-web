import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  SessionConnectionLifecycle,
  type SessionConnectionInput,
} from "./connection-lifecycle.ts";
import {
  coreProtocolCompatibilityError,
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  DEFAULT_UI_FEATURES,
  OctosUiClient,
  OctosUiProtocolError,
  parseTokenCostUpdate,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type ConnectionStatus,
  type PermissionProfileUpdate,
  type RpcNotification,
  type SessionOpened,
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
import type { PromptTurnQueueSnapshot } from "../composer/turn-queue.ts";
import {
  addSystemMessage,
  foldNotification,
  terminalTurnId,
  timelineFromHydrate,
  type TimelineEntry,
} from "../timeline/model.ts";
import {
  DurableSessionProjection,
  type SessionRecoverySnapshot,
} from "./durable-session.ts";
import { notificationMatchesSessionScope } from "./scope.ts";
import { type SupervisionRuntimeState } from "../supervision/model.ts";
import { useSupervision } from "../supervision/use-supervision.ts";
import { type WorkspaceProductState } from "../workspace/model.ts";
import { useWorkspaceProduct } from "../workspace/use-workspace-product.ts";
import {
  codingSessionIdForProfile,
  EMPTY_LAUNCH_RUNTIME,
  type LaunchRuntimeState,
} from "../workspace/launch-model.ts";
import {
  useOnboarding,
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "../onboarding/use-onboarding.ts";

export type {
  DiffReviewRuntimeState,
  PermissionRuntimeState,
} from "../review/use-coding-safety.ts";

const REQUIRED_DURABLE_FEATURES = [
  CORE_UI_FEATURES.SESSION_HYDRATE_V1,
  CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
] as const;

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
    connected: boolean;
    connect: (input: SessionConnectionInput) => void;
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
    onboarding: OnboardingRuntimeState;
    refresh: () => Promise<void>;
    switchSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => Promise<void>;
    chooseLaunchProfile: (profileId: string) => Promise<void>;
    retryOnboarding: () => Promise<void>;
    submitOnboarding: (submission: OnboardingSubmission) => Promise<void>;
  };
  diagnostics: { events: ObservedEvent[]; omittedEvents: number };
}

export function useOctosSession(): OctosSessionRuntime {
  const clientRef = useRef<OctosUiClient | null>(null);
  const eventId = useRef(0);
  const sessionIdRef = useRef("");
  const capabilitiesRef = useRef<UiProtocolCapabilities | undefined>(undefined);
  const durableProjectionRef = useRef(new DurableSessionProjection());
  const recoveringRef = useRef(false);
  const recoveryBufferRef = useRef<RpcNotification[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLifecycleRef = useRef(new SessionConnectionLifecycle());
  const launchOpeningRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SessionOpened | null>(null);
  const [eventLog, setEventLog] = useState<{
    events: ObservedEvent[];
    omitted: number;
  }>({ events: [], omitted: 0 });
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const interactionController = useBlockingInteractions({
    client: () => clientRef.current,
    sessionId: () => sessionIdRef.current,
    capabilities: () => capabilitiesRef.current,
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
  const [recovery, setRecovery] = useState<SessionRecoverySnapshot>(() =>
    durableProjectionRef.current.snapshot(),
  );
  const turnController = useTurnController({
    client: () => clientRef.current,
    sessionId: () => sessionIdRef.current,
    canEnqueue: () =>
      status === "connected" &&
      opened !== null &&
      durableProjectionRef.current.snapshot().phase === "healthy",
    canStart: () => durableProjectionRef.current.snapshot().phase === "healthy",
    setTimeline,
    setConnectionError,
  });
  const supervisionController = useSupervision({
    client: () => clientRef.current,
    sessionId: () => sessionIdRef.current,
    capabilities: () => capabilitiesRef.current,
  });
  const supervision = supervisionController.state;
  const codingSafetyController = useCodingSafety({
    client: () => clientRef.current,
    sessionId: () => sessionIdRef.current,
    capabilities: () => capabilitiesRef.current,
    onPermissionApplied: (client) => {
      void supervisionController.refresh(client);
    },
  });
  const permission = codingSafetyController.permission;
  const diffReview = codingSafetyController.diffReview;
  const workspaceController = useWorkspaceProduct({
    client: () => clientRef.current,
    sessionId: () => sessionIdRef.current,
    capabilities: () => capabilitiesRef.current,
    connectionConfig: () => connectionLifecycleRef.current.config,
  });
  const workspace = workspaceController.state;
  const [launch, setLaunch] =
    useState<LaunchRuntimeState>(EMPTY_LAUNCH_RUNTIME);
  const onboardingController = useOnboarding({
    client: () => clientRef.current,
    capabilities: () => capabilitiesRef.current,
    onConfigured: async (profileId, client) => {
      const config = connectionLifecycleRef.current.config;
      if (!config || clientRef.current !== client) {
        throw new Error("The server connection changed during onboarding.");
      }
      launchOpeningRef.current = true;
      setLaunch((current) => ({ ...current, phase: "opening" }));
      try {
        await openConnectedSession(
          client,
          launchProfileConfig(config, profileId),
        );
        onboardingController.reset();
      } catch (reason) {
        setLaunch((current) => ({ ...current, phase: "awaiting_choice" }));
        throw reason;
      } finally {
        launchOpeningRef.current = false;
      }
    },
  });

  useEffect(
    () => () => {
      connectionLifecycleRef.current.stopRetrying();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clientRef.current?.disconnect();
    },
    [],
  );

  const syncRecovery = () =>
    setRecovery(durableProjectionRef.current.snapshot());

  const connect = (input: SessionConnectionInput) => {
    beginConnection(input, true);
  };

  const beginConnection = (
    input: SessionConnectionInput,
    resolveWorkspaceLaunch: boolean,
  ) => {
    connectionLifecycleRef.current.suspend();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const previous = clientRef.current;
    clientRef.current = null;
    previous?.disconnect();

    const config = connectionLifecycleRef.current.begin(
      input,
      resolveWorkspaceLaunch,
    );
    setConnectionError(null);
    setOpened(null);
    setEventLog({ events: [], omitted: 0 });
    setTimeline([]);
    turnController.reset();
    interactionController.reset();
    codingSafetyController.reset();
    supervisionController.reset();
    onboardingController.reset();
    launchOpeningRef.current = false;
    workspaceController.reset();
    setLaunch(
      connectionLifecycleRef.current.shouldResolveLaunch(false)
        ? { phase: "resolving", cwd: config.cwd, decision: null }
        : EMPTY_LAUNCH_RUNTIME,
    );
    capabilitiesRef.current = undefined;
    sessionIdRef.current = config.sessionId;
    durableProjectionRef.current.reset(config.sessionId);
    syncRecovery();
    recoveringRef.current = true;
    recoveryBufferRef.current = [];
    void establishSession(config, false);
  };

  async function establishSession(
    config: SessionConnectionInput,
    reconnecting: boolean,
  ) {
    const resumeCursor = reconnecting
      ? durableProjectionRef.current.snapshot().cursor
      : undefined;
    const client = new OctosUiClient({
      endpoint: config.endpoint,
      token: config.token,
      features: DEFAULT_UI_FEATURES,
    });
    clientRef.current = client;
    client.subscribeStatus((next) => {
      if (clientRef.current !== client) return;
      setStatus(next);
      if (next === "disconnected") {
        scheduleReconnect();
      }
    });
    client.subscribeErrors((error) => {
      if (clientRef.current === client) setConnectionError(error.message);
    });
    client.subscribeNotifications(handleNotification);

    try {
      await client.connect();
      if (clientRef.current !== client) return;
      const openConfig = connectionLifecycleRef.current.shouldResolveLaunch(
        reconnecting,
      )
        ? await resolveInitialLaunch(client, config)
        : config;
      if (!openConfig || clientRef.current !== client) return;
      await openConnectedSession(client, openConfig, resumeCursor);
    } catch (reason) {
      failSessionConnection(client, reason, reconnecting);
    }
  }

  async function resolveInitialLaunch(
    client: OctosUiClient,
    config: SessionConnectionInput,
  ): Promise<SessionConnectionInput | null> {
    if (!config.cwd) return config;
    let capabilities;
    try {
      capabilities = (await client.listConfigCapabilities()).capabilities;
      assertCompatibleProtocol(capabilities);
      capabilitiesRef.current = capabilities;
    } catch (reason) {
      if (reason instanceof OctosUiProtocolError && reason.code === -32601) {
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        return config;
      }
      throw reason;
    }
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
    const decision = await client.resolveLaunch({
      cwd: config.cwd,
      ...(config.profileId ? { profile_id: config.profileId } : {}),
    });
    if (decision.decision === "resume" && decision.resolved_profile) {
      setLaunch({ phase: "opening", cwd: config.cwd, decision: null });
      return launchProfileConfig(config, decision.resolved_profile);
    }
    if (decision.decision === "no_profile") {
      void onboardingController.prepare();
    }
    setLaunch({
      phase: "awaiting_choice",
      cwd: config.cwd,
      decision,
    });
    return null;
  }

  async function openConnectedSession(
    client: OctosUiClient,
    config: SessionConnectionInput,
    resumeCursor?: SessionRecoverySnapshot["cursor"],
  ) {
    connectionLifecycleRef.current.updateConfig(config);
    sessionIdRef.current = config.sessionId;
    connectionLifecycleRef.current.markLaunchResolved();
    if (!resumeCursor) {
      durableProjectionRef.current.reset(config.sessionId);
      syncRecovery();
    }
    recoveringRef.current = true;
    const result = await client.openSession({
      session_id: config.sessionId,
      ...(config.profileId ? { profile_id: config.profileId } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      ...(resumeCursor ? { after: resumeCursor } : {}),
    });
    if (clientRef.current !== client) return;
    assertCompatibleProtocol(result.opened.capabilities);
    if (result.opened.session_id !== sessionIdRef.current) {
      durableProjectionRef.current.reset(result.opened.session_id);
    }
    sessionIdRef.current = result.opened.session_id;
    connectionLifecycleRef.current.markSessionEstablished({
      ...config,
      sessionId: result.opened.session_id,
      profileId: result.opened.active_profile_id ?? config.profileId,
    });
    capabilitiesRef.current = result.opened.capabilities;
    setOpened(result.opened);
    await hydrateSessionState(client, result.opened.capabilities);
    configureCodingSurfaces(result.opened.capabilities);
    void codingSafetyController.refreshPermission(client);
    void supervisionController.refresh(client);
    void workspaceController.refresh(client);
    setConnectionError(null);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
  }

  function failSessionConnection(
    client: OctosUiClient,
    reason: unknown,
    reconnecting: boolean,
  ) {
    if (clientRef.current !== client) return;
    const message = reason instanceof Error ? reason.message : String(reason);
    const fatalContractError = isFatalSessionContractError(message);
    if (fatalContractError) connectionLifecycleRef.current.stopRetrying();
    durableProjectionRef.current.fail(message);
    syncRecovery();
    recoveringRef.current = false;
    setConnectionError(message);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    client.disconnect();
    if (reconnecting && !fatalContractError) scheduleReconnect();
  }

  function configureCodingSurfaces(
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    codingSafetyController.configureCapabilities(capabilities);
    supervisionController.configureCapabilities(capabilities);
    workspaceController.configureCapabilities(capabilities);
  }

  async function hydrateSessionState(
    client: OctosUiClient,
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    const missingFeatures = REQUIRED_DURABLE_FEATURES.filter(
      (feature) => !supportsFeature(capabilities, feature),
    );
    if (
      missingFeatures.length ||
      !supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE)
    ) {
      throw new Error(
        `Server lacks the durable Web contract: ${[
          ...missingFeatures,
          ...(supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE)
            ? []
            : [CORE_UI_METHODS.SESSION_HYDRATE]),
        ].join(", ")}`,
      );
    }

    recoveringRef.current = true;
    durableProjectionRef.current.beginHydrate(sessionIdRef.current);
    syncRecovery();
    const hydrated = await client.hydrateSession({
      session_id: sessionIdRef.current,
      include: ["messages", "threads", "turns", "pending_approvals"],
    });
    if (clientRef.current !== client) return;

    durableProjectionRef.current.commitHydrate(hydrated);
    setTimeline(timelineFromHydrate(hydrated));
    interactionController.restore(hydrated, capabilities);
    const nextTurn = turnController.reconcileFromHydrate(hydrated);
    recoveringRef.current = false;
    syncRecovery();

    const buffered = recoveryBufferRef.current;
    recoveryBufferRef.current = [];
    for (const notification of buffered) {
      processNotification(notification);
      if (recoveringRef.current) break;
    }
    if (nextTurn && !recoveringRef.current)
      void turnController.startTurn(nextTurn);
  }

  function scheduleReconnect() {
    if (reconnectTimerRef.current || !connectionLifecycleRef.current.config) {
      return;
    }
    const plan = connectionLifecycleRef.current.nextReconnect();
    if (!plan) return;
    durableProjectionRef.current.beginReconnect(plan.attempt);
    syncRecovery();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const config = connectionLifecycleRef.current.config;
      if (config) {
        void establishSession(config, true);
      }
    }, plan.delayMs);
  }

  const disconnect = () => {
    connectionLifecycleRef.current.stopRetrying();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const client = clientRef.current;
    clientRef.current = null;
    client?.disconnect();
    setStatus("disconnected");
    connectionLifecycleRef.current.disconnect();
    recoveringRef.current = false;
    recoveryBufferRef.current = [];
    setOpened(null);
    sessionIdRef.current = "";
    capabilitiesRef.current = undefined;
    durableProjectionRef.current.reset("");
    syncRecovery();
    turnController.reset();
    interactionController.reset();
    codingSafetyController.reset();
    supervisionController.reset();
    onboardingController.reset();
    launchOpeningRef.current = false;
    workspaceController.reset();
    setLaunch(EMPTY_LAUNCH_RUNTIME);
  };

  const refreshWorkspace = async () => {
    await workspaceController.refresh();
  };

  const switchSession = (sessionId: string) => {
    const target = sessionId.trim();
    const config = connectionLifecycleRef.current.config;
    const queueState = turnController.snapshot();
    if (!target || target === sessionIdRef.current || !config) return;
    if (queueState.active || queueState.pending.length) {
      workspaceController.setError(
        "The foreground queue must settle before this Web client can switch sessions.",
      );
      return;
    }
    beginConnection({ ...config, sessionId: target }, false);
  };

  const chooseLaunchProfile = async (profileId: string) => {
    const target = profileId.trim();
    const decision = launch.decision;
    const client = clientRef.current;
    const config = connectionLifecycleRef.current.config;
    const allowed = decision
      ? [decision.resolved_profile, ...decision.existing_profiles].filter(
          (candidate): candidate is string => Boolean(candidate),
        )
      : [];
    if (
      !target ||
      !client ||
      !config ||
      !decision ||
      !allowed.includes(target) ||
      launchOpeningRef.current
    ) {
      return;
    }
    launchOpeningRef.current = true;
    setLaunch((current) => ({ ...current, phase: "opening" }));
    try {
      await openConnectedSession(client, launchProfileConfig(config, target));
    } catch (reason) {
      failSessionConnection(client, reason, false);
    } finally {
      launchOpeningRef.current = false;
    }
  };

  function handleNotification(notification: RpcNotification) {
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
    if (recoveringRef.current) {
      if (recoveryBufferRef.current.length >= 4_096) {
        const message =
          "Recovery buffer exceeded 4096 events; reconnecting from the last durable cursor";
        durableProjectionRef.current.fail(message);
        syncRecovery();
        setConnectionError(message);
        clientRef.current?.disconnect();
        return;
      }
      recoveryBufferRef.current.push(notification);
      return;
    }
    processNotification(notification);
  }

  function processNotification(notification: RpcNotification) {
    const projectionDecision =
      durableProjectionRef.current.observe(notification);
    syncRecovery();
    if (projectionDecision.kind === "recover") {
      recoveringRef.current = true;
      recoveryBufferRef.current =
        notification.method === CORE_UI_METHODS.REPLAY_LOSSY
          ? []
          : [notification];
      const client = clientRef.current;
      if (client) {
        void hydrateSessionState(client, capabilitiesRef.current).catch(
          (reason: unknown) => {
            if (clientRef.current !== client) return;
            const message =
              reason instanceof Error ? reason.message : String(reason);
            if (isFatalSessionContractError(message)) {
              connectionLifecycleRef.current.stopRetrying();
            }
            recoveringRef.current = false;
            durableProjectionRef.current.fail(message);
            syncRecovery();
            setConnectionError(message);
            client.disconnect();
          },
        );
      }
      return;
    }
    if (
      notification.method === CORE_UI_METHODS.PROJECTION_ENVELOPE &&
      projectionDecision.kind !== "apply"
    ) {
      return;
    }
    if (
      notification.method !== CORE_UI_METHODS.PROJECTION_ENVELOPE &&
      !notificationMatchesSessionScope(notification, sessionIdRef.current)
    ) {
      return;
    }

    codingSafetyController.observeNotification(notification);
    supervisionController.observeNotification(notification);
    const tokenCost = parseTokenCostUpdate(notification);
    if (tokenCost && tokenCost.sessionId === sessionIdRef.current) {
      workspaceController.observeTokenCost(tokenCost);
    }

    const canonicalProjection = supportsFeature(
      capabilitiesRef.current,
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
      status,
      error: connectionError,
      opened,
      recovery,
      connected:
        status === "connected" &&
        opened !== null &&
        recovery.phase === "healthy",
      connect,
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
      onboarding: onboardingController.state,
      refresh: refreshWorkspace,
      switchSession,
      deleteSession: workspaceController.deleteSession,
      chooseLaunchProfile,
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
    profileId,
    sessionId: codingSessionIdForProfile(profileId),
  };
}

function isFatalSessionContractError(message: string): boolean {
  return (
    message.startsWith("Server protocol contract is incompatible") ||
    message.startsWith("Server lacks the durable Web contract") ||
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
