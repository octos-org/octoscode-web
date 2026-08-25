import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  approvalResolutionId,
  DEFAULT_UI_FEATURES,
  isPreviewId,
  isRecord,
  notificationDiffPreviewId,
  OctosUiClient,
  parseApprovalRequested,
  parseUserQuestionRequested,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type ConnectionStatus,
  type DiffPreviewGetResult,
  type PermissionProfileListResult,
  type PermissionProfileUpdate,
  type RpcNotification,
  type SessionHydrateResult,
  type SessionOpened,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
} from "@octos-org/octoscode-client";
import type { ObservedEvent } from "../inspector/EventInspector.tsx";
import {
  PromptTurnQueue,
  type PromptTurn,
  type PromptTurnQueueSnapshot,
} from "../composer/turn-queue.ts";
import {
  addOptimisticUser,
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

const REQUIRED_DURABLE_FEATURES = [
  "state.session_hydrate.v1",
  "projection.envelope.v2",
] as const;

const LEGACY_PROJECTION_METHODS = new Set([
  "message/delta",
  "message/reasoning_delta",
  "tool/started",
  "tool/progress",
  "tool/completed",
  "turn/completed",
  "turn/error",
]);

export interface SessionConnectionInput {
  endpoint: string;
  token: string;
  sessionId: string;
  profileId: string;
  cwd: string;
}

export interface OctosSessionRuntime {
  status: ConnectionStatus;
  connectionError: string | null;
  opened: SessionOpened | null;
  events: ObservedEvent[];
  timeline: TimelineEntry[];
  setTimeline: Dispatch<SetStateAction<TimelineEntry[]>>;
  queue: PromptTurnQueueSnapshot;
  interruptingTurnId: string | null;
  approval: ApprovalRequested | null;
  question: UserQuestionRequested | null;
  decisionBusy: boolean;
  decisionError: string | null;
  recovery: SessionRecoverySnapshot;
  permission: PermissionRuntimeState;
  diffReview: DiffReviewRuntimeState;
  connected: boolean;
  connect: (input: SessionConnectionInput) => void;
  disconnect: () => void;
  enqueuePrompt: (text: string) => void;
  interrupt: () => Promise<void>;
  respondApproval: (
    decision: ApprovalDecision,
    scope: ApprovalScope,
  ) => Promise<void>;
  respondQuestion: (answers: UserQuestionAnswer[]) => Promise<void>;
  refreshPermission: () => Promise<void>;
  updatePermission: (update: PermissionProfileUpdate) => Promise<void>;
  openDiffReview: (previewId?: string) => Promise<void>;
  closeDiffReview: () => void;
}

export interface PermissionRuntimeState {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  result: PermissionProfileListResult | null;
  error: string | null;
}

export interface DiffReviewRuntimeState {
  available: boolean;
  latestPreviewId: string | null;
  active: boolean;
  loading: boolean;
  result: DiffPreviewGetResult | null;
  error: string | null;
}

const EMPTY_PERMISSION: PermissionRuntimeState = {
  available: false,
  editable: false,
  loading: false,
  busy: false,
  result: null,
  error: null,
};

const EMPTY_DIFF_REVIEW: DiffReviewRuntimeState = {
  available: false,
  latestPreviewId: null,
  active: false,
  loading: false,
  result: null,
  error: null,
};

export function useOctosSession(): OctosSessionRuntime {
  const clientRef = useRef<OctosUiClient | null>(null);
  const eventId = useRef(0);
  const sessionIdRef = useRef("");
  const capabilitiesRef = useRef<UiProtocolCapabilities | undefined>(undefined);
  const queueRef = useRef(new PromptTurnQueue());
  const interruptingTurnIdRef = useRef<string | null>(null);
  const durableProjectionRef = useRef(new DurableSessionProjection());
  const recoveringRef = useRef(false);
  const recoveryBufferRef = useRef<RpcNotification[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const diffRequestRef = useRef(0);
  const permissionBusyRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const connectionConfigRef = useRef<SessionConnectionInput | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SessionOpened | null>(null);
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [queue, setQueue] = useState<PromptTurnQueueSnapshot>(() =>
    queueRef.current.snapshot(),
  );
  const [interruptingTurnId, setInterruptingTurnId] = useState<string | null>(
    null,
  );
  const [approval, setApproval] = useState<ApprovalRequested | null>(null);
  const [question, setQuestion] = useState<UserQuestionRequested | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<SessionRecoverySnapshot>(() =>
    durableProjectionRef.current.snapshot(),
  );
  const [permission, setPermission] =
    useState<PermissionRuntimeState>(EMPTY_PERMISSION);
  const [diffReview, setDiffReview] =
    useState<DiffReviewRuntimeState>(EMPTY_DIFF_REVIEW);

  useEffect(
    () => () => {
      manualDisconnectRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clientRef.current?.disconnect();
    },
    [],
  );

  const syncQueue = () => setQueue(queueRef.current.snapshot());
  const syncRecovery = () =>
    setRecovery(durableProjectionRef.current.snapshot());

  const resetQueue = () => {
    queueRef.current.clear();
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    syncQueue();
  };

  const resetBlockingInteraction = () => {
    setApproval(null);
    setQuestion(null);
    setDecisionBusy(false);
    setDecisionError(null);
  };

  const connect = (input: SessionConnectionInput) => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const previous = clientRef.current;
    clientRef.current = null;
    previous?.disconnect();

    const config = {
      endpoint: input.endpoint.trim(),
      token: input.token,
      sessionId: input.sessionId.trim(),
      profileId: input.profileId.trim(),
      cwd: input.cwd.trim(),
    };
    connectionConfigRef.current = config;
    reconnectAttemptRef.current = 0;
    manualDisconnectRef.current = false;
    setConnectionError(null);
    setOpened(null);
    setEvents([]);
    setTimeline([]);
    resetQueue();
    resetBlockingInteraction();
    setPermission(EMPTY_PERMISSION);
    permissionBusyRef.current = false;
    diffRequestRef.current += 1;
    setDiffReview(EMPTY_DIFF_REVIEW);
    capabilitiesRef.current = undefined;
    sessionIdRef.current = config.sessionId;
    durableProjectionRef.current.reset(config.sessionId);
    durableProjectionRef.current.beginHydrate();
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
      if (next === "disconnected" && !manualDisconnectRef.current) {
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
      const result = await client.openSession({
        session_id: config.sessionId,
        ...(config.profileId ? { profile_id: config.profileId } : {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(resumeCursor ? { after: resumeCursor } : {}),
      });
      if (clientRef.current !== client) return;
      if (result.opened.session_id !== sessionIdRef.current) {
        durableProjectionRef.current.reset(result.opened.session_id);
      }
      sessionIdRef.current = result.opened.session_id;
      capabilitiesRef.current = result.opened.capabilities;
      setOpened(result.opened);
      await hydrateSessionState(client, result.opened.capabilities);
      configureCodingSurfaces(result.opened.capabilities);
      if (
        supportsMethod(result.opened.capabilities, "permission/profile/list")
      ) {
        void loadPermissionProfiles(client);
      }
      reconnectAttemptRef.current = 0;
      setConnectionError(null);
    } catch (reason) {
      if (clientRef.current !== client) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      const fatalContractError = isFatalSessionContractError(message);
      if (fatalContractError) manualDisconnectRef.current = true;
      durableProjectionRef.current.fail(message);
      syncRecovery();
      recoveringRef.current = false;
      setConnectionError(message);
      client.disconnect();
      if (reconnecting && !fatalContractError) scheduleReconnect();
    }
  }

  function configureCodingSurfaces(
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    const permissionAvailable = supportsMethod(
      capabilities,
      "permission/profile/list",
    );
    setPermission((current) => ({
      ...current,
      available: permissionAvailable,
      editable:
        permissionAvailable &&
        supportsMethod(capabilities, "permission/profile/set"),
    }));
    setDiffReview((current) => ({
      ...current,
      available: supportsMethod(capabilities, "diff/preview/get"),
    }));
  }

  async function loadPermissionProfiles(client = clientRef.current) {
    const sessionId = sessionIdRef.current;
    if (
      !client ||
      !sessionId ||
      !supportsMethod(capabilitiesRef.current, "permission/profile/list")
    ) {
      return;
    }
    setPermission((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const result = await client.listPermissionProfiles({
        session_id: sessionId,
      });
      if (clientRef.current !== client || sessionIdRef.current !== sessionId) {
        return;
      }
      if (result.session_id !== sessionId) {
        throw new Error("permission/profile/list returned another session");
      }
      setPermission((current) => ({
        ...current,
        loading: false,
        result,
      }));
    } catch (reason) {
      if (clientRef.current !== client) return;
      setPermission((current) => ({
        ...current,
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
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
      !supportsMethod(capabilities, "session/hydrate")
    ) {
      throw new Error(
        `Server lacks the durable Web contract: ${[
          ...missingFeatures,
          ...(supportsMethod(capabilities, "session/hydrate")
            ? []
            : ["session/hydrate"]),
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
    restoreBlockingInteractions(hydrated, capabilities);
    const nextTurn = reconcileQueueFromHydrate(hydrated);
    recoveringRef.current = false;
    syncRecovery();

    const buffered = recoveryBufferRef.current;
    recoveryBufferRef.current = [];
    for (const notification of buffered) {
      processNotification(notification);
      if (recoveringRef.current) break;
    }
    if (nextTurn && !recoveringRef.current) void startTurn(nextTurn);
  }

  function restoreBlockingInteractions(
    hydrated: SessionHydrateResult,
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    const pendingApproval = (hydrated.pending_approvals ?? [])
      .map((params) =>
        parseApprovalRequested({
          jsonrpc: "2.0",
          method: "approval/requested",
          params,
        }),
      )
      .find(
        (request) =>
          request &&
          matchesSessionScope(
            sessionIdRef.current,
            request.sessionId,
            request.topic,
          ),
      );
    const pendingQuestion = (hydrated.pending_questions ?? [])
      .map((params) =>
        parseUserQuestionRequested({
          jsonrpc: "2.0",
          method: "user_question/requested",
          params,
        }),
      )
      .find(
        (request) =>
          request &&
          matchesSessionScope(
            sessionIdRef.current,
            request.sessionId,
            request.topic,
          ),
      );
    setApproval(
      supportsMethod(capabilities, "approval/respond")
        ? (pendingApproval ?? null)
        : null,
    );
    setQuestion(
      supportsMethod(capabilities, "user_question/respond") &&
        supportsFeature(capabilities, "user_question.v1")
        ? (pendingQuestion ?? null)
        : null,
    );
    setDecisionBusy(false);
    setDecisionError(null);
  }

  function reconcileQueueFromHydrate(hydrated: SessionHydrateResult) {
    const snapshot = queueRef.current.snapshot();
    const serverActive = hydrated.turns?.find(
      (turn) => turn.state === "active" || turn.state === "interrupting",
    );
    if (!snapshot.active && serverActive) {
      queueRef.current.restoreActive({
        turnId: serverActive.turn_id,
        text: "",
      });
      syncQueue();
      return null;
    }
    if (!snapshot.active) return null;
    const serverTurn = hydrated.turns?.find(
      (turn) => turn.turn_id === snapshot.active?.turnId,
    );
    if (
      serverTurn &&
      serverTurn.state !== "active" &&
      serverTurn.state !== "interrupting" &&
      serverTurn.state !== "unknown"
    ) {
      const transition = queueRef.current.settle(snapshot.active.turnId);
      syncQueue();
      return transition.next;
    }
    return null;
  }

  function scheduleReconnect() {
    if (
      manualDisconnectRef.current ||
      reconnectTimerRef.current ||
      !connectionConfigRef.current
    ) {
      return;
    }
    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    durableProjectionRef.current.beginReconnect(attempt);
    syncRecovery();
    const delay = Math.min(500 * 2 ** Math.min(attempt - 1, 4), 5_000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      const config = connectionConfigRef.current;
      if (config && !manualDisconnectRef.current) {
        void establishSession(config, true);
      }
    }, delay);
  }

  const disconnect = () => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const client = clientRef.current;
    clientRef.current = null;
    client?.disconnect();
    setStatus("disconnected");
    connectionConfigRef.current = null;
    recoveringRef.current = false;
    recoveryBufferRef.current = [];
    setOpened(null);
    sessionIdRef.current = "";
    capabilitiesRef.current = undefined;
    durableProjectionRef.current.reset("");
    syncRecovery();
    resetQueue();
    resetBlockingInteraction();
    setPermission(EMPTY_PERMISSION);
    permissionBusyRef.current = false;
    diffRequestRef.current += 1;
    setDiffReview(EMPTY_DIFF_REVIEW);
  };

  const enqueuePrompt = (text: string) => {
    if (
      !clientRef.current ||
      status !== "connected" ||
      recovery.phase !== "healthy" ||
      !opened ||
      !text.trim()
    ) {
      return;
    }
    const turn: PromptTurn = { turnId: crypto.randomUUID(), text: text.trim() };
    const { startNow } = queueRef.current.enqueue(turn);
    syncQueue();
    if (startNow) void startTurn(turn);
  };

  async function startTurn(turn: PromptTurn) {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (
      !client ||
      !sessionId ||
      durableProjectionRef.current.snapshot().phase !== "healthy"
    ) {
      return;
    }

    setTimeline((current) =>
      addOptimisticUser(current, turn.turnId, turn.text),
    );
    try {
      await client.startTurn({
        session_id: sessionId,
        turn_id: turn.turnId,
        input: [{ kind: "text", text: turn.text }],
      });
    } catch (reason) {
      if (clientRef.current !== client) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turn.turnId}`,
          "Turn rejected",
          message,
          "error",
        ),
      );
      settleTurn(turn.turnId);
    }
  }

  const interrupt = async () => {
    const client = clientRef.current;
    const activeTurn = queueRef.current.snapshot().active;
    if (!client || !activeTurn) {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `nothing-to-stop:${crypto.randomUUID()}`,
          "Nothing to stop",
          "There is no active foreground turn, so no server command was sent.",
        ),
      );
      return;
    }
    if (interruptingTurnIdRef.current === activeTurn.turnId) return;

    interruptingTurnIdRef.current = activeTurn.turnId;
    setInterruptingTurnId(activeTurn.turnId);
    try {
      await client.interruptTurn(sessionIdRef.current, activeTurn.turnId);
    } catch (reason) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
      setConnectionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  };

  const respondApproval = async (
    decision: ApprovalDecision,
    scope: ApprovalScope,
  ) => {
    const client = clientRef.current;
    const current = approval;
    if (!client || !current || decisionBusy) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      const result = await client.respondApproval({
        session_id: current.sessionId,
        approval_id: current.approvalId,
        decision,
        approval_scope: scope,
      });
      if (!result.accepted) throw new Error("The server rejected the decision");
      setApproval((pending) =>
        pending?.approvalId === current.approvalId ? null : pending,
      );
    } catch (reason) {
      setDecisionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setDecisionBusy(false);
    }
  };

  const respondQuestion = async (answers: UserQuestionAnswer[]) => {
    const client = clientRef.current;
    const current = question;
    if (!client || !current || decisionBusy) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      const result = await client.respondUserQuestion({
        session_id: current.sessionId,
        question_id: current.questionId,
        answers,
      });
      if (!result.accepted) throw new Error("The server rejected the answer");
      setQuestion((pending) =>
        pending?.questionId === current.questionId ? null : pending,
      );
    } catch (reason) {
      setDecisionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setDecisionBusy(false);
    }
  };

  const refreshPermission = async () => {
    await loadPermissionProfiles();
  };

  const updatePermission = async (update: PermissionProfileUpdate) => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (
      !client ||
      !sessionId ||
      !permission.available ||
      !permission.editable ||
      permissionBusyRef.current
    ) {
      return;
    }
    const current = permission.result?.current;
    const next = current
      ? {
          mode: update.mode ?? current.mode,
          network: update.network ?? current.network,
        }
      : null;
    if (
      !next ||
      !permission.result?.profiles.some(
        (profile) =>
          profile.mode === next.mode && profile.network === next.network,
      )
    ) {
      setPermission((state) => ({
        ...state,
        error:
          "The requested permission profile was not advertised for this session",
      }));
      return;
    }
    permissionBusyRef.current = true;
    setPermission((current) => ({ ...current, busy: true, error: null }));
    try {
      const result = await client.setPermissionProfile({
        session_id: sessionId,
        update,
      });
      if (clientRef.current !== client || sessionIdRef.current !== sessionId) {
        return;
      }
      if (result.session_id !== sessionId) {
        throw new Error("permission/profile/set returned another session");
      }
      if (!result.applied) {
        throw new Error("The server did not apply the permission change");
      }
      setPermission((current) => ({
        ...current,
        busy: false,
        result: current.result
          ? { ...current.result, current: result.current }
          : {
              session_id: result.session_id,
              current: result.current,
              profiles: [],
            },
      }));
      permissionBusyRef.current = false;
      await loadPermissionProfiles(client);
    } catch (reason) {
      if (clientRef.current !== client) return;
      permissionBusyRef.current = false;
      setPermission((current) => ({
        ...current,
        busy: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  };

  const openDiffReview = async (requestedPreviewId?: string) => {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    const previewId = requestedPreviewId ?? diffReview.latestPreviewId;
    if (
      !client ||
      !sessionId ||
      !previewId ||
      !isPreviewId(previewId) ||
      !supportsMethod(capabilitiesRef.current, "diff/preview/get")
    ) {
      return;
    }
    const request = diffRequestRef.current + 1;
    diffRequestRef.current = request;
    setDiffReview((current) => ({
      ...current,
      latestPreviewId: previewId,
      active: true,
      loading: true,
      result: null,
      error: null,
    }));
    try {
      const result = await client.getDiffPreview({
        session_id: sessionId,
        preview_id: previewId,
      });
      if (
        clientRef.current !== client ||
        diffRequestRef.current !== request ||
        sessionIdRef.current !== sessionId
      ) {
        return;
      }
      if (
        result.preview.session_id !== sessionId ||
        result.preview.preview_id !== previewId
      ) {
        throw new Error("diff/preview/get returned a mismatched preview");
      }
      setDiffReview((current) => ({
        ...current,
        loading: false,
        result,
      }));
    } catch (reason) {
      if (clientRef.current !== client || diffRequestRef.current !== request) {
        return;
      }
      setDiffReview((current) => ({
        ...current,
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  };

  const closeDiffReview = () => {
    diffRequestRef.current += 1;
    setDiffReview((current) => ({
      ...current,
      active: false,
      loading: false,
      result: null,
      error: null,
    }));
  };

  function handleNotification(notification: RpcNotification) {
    setEvents((current) =>
      [
        ...current,
        {
          id: eventId.current++,
          at: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          notification,
        },
      ].slice(-100),
    );
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
        notification.method === "protocol/replay_lossy" ? [] : [notification];
      const client = clientRef.current;
      if (client) {
        void hydrateSessionState(client, capabilitiesRef.current).catch(
          (reason: unknown) => {
            if (clientRef.current !== client) return;
            const message =
              reason instanceof Error ? reason.message : String(reason);
            if (isFatalSessionContractError(message)) {
              manualDisconnectRef.current = true;
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
      notification.method === "projection/envelope" &&
      projectionDecision.kind !== "apply"
    ) {
      return;
    }
    if (
      notification.method !== "projection/envelope" &&
      !notificationMatchesSessionScope(notification, sessionIdRef.current)
    ) {
      return;
    }

    const previewId = notificationDiffPreviewId(notification);
    if (previewId) {
      setDiffReview((current) => ({
        ...current,
        latestPreviewId: previewId,
      }));
    }

    const canonicalProjection = supportsFeature(
      capabilitiesRef.current,
      "projection.envelope.v2",
    );
    const foldIntoTimeline = !(
      canonicalProjection && LEGACY_PROJECTION_METHODS.has(notification.method)
    );
    if (foldIntoTimeline) {
      setTimeline((current) => foldNotification(current, notification));
    }

    if (notification.method === "approval/requested") {
      const requested = parseApprovalRequested(notification);
      if (
        requested &&
        matchesSessionScope(
          sessionIdRef.current,
          requested.sessionId,
          requested.topic,
        ) &&
        supportsMethod(capabilitiesRef.current, "approval/respond")
      ) {
        setDecisionError(null);
        setApproval(requested);
      } else {
        setTimeline((current) =>
          addSystemMessage(
            current,
            `invalid-approval:${crypto.randomUUID()}`,
            "Approval cannot be rendered",
            "The request was malformed, belonged to another session, or approval/respond was not negotiated.",
            "error",
          ),
        );
      }
    }
    const resolvedApprovalId = approvalResolutionId(notification);
    if (resolvedApprovalId) {
      setApproval((pending) =>
        pending?.approvalId === resolvedApprovalId ? null : pending,
      );
    }

    if (notification.method === "user_question/requested") {
      const requested = parseUserQuestionRequested(notification);
      if (
        requested &&
        matchesSessionScope(
          sessionIdRef.current,
          requested.sessionId,
          requested.topic,
        ) &&
        supportsMethod(capabilitiesRef.current, "user_question/respond") &&
        supportsFeature(capabilitiesRef.current, "user_question.v1")
      ) {
        setDecisionError(null);
        setQuestion(requested);
      } else {
        setTimeline((current) =>
          addSystemMessage(
            current,
            `invalid-question:${crypto.randomUUID()}`,
            "Question cannot be rendered",
            "The request was malformed, belonged to another session, or user_question.v1 was not negotiated.",
            "error",
          ),
        );
      }
    }

    const terminal = foldIntoTimeline ? terminalTurnId(notification) : null;
    if (terminal) {
      setApproval((pending) => (pending?.turnId === terminal ? null : pending));
      setQuestion((pending) => (pending?.turnId === terminal ? null : pending));
      settleTurn(terminal);
    }
  }

  function settleTurn(turnId: string) {
    const transition = queueRef.current.settle(turnId);
    if (!transition.settled) return;
    if (interruptingTurnIdRef.current === turnId) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
    }
    syncQueue();
    if (transition.next) void startTurn(transition.next);
  }

  return {
    status,
    connectionError,
    opened,
    events,
    timeline,
    setTimeline,
    queue,
    interruptingTurnId,
    approval,
    question,
    decisionBusy,
    decisionError,
    recovery,
    permission,
    diffReview,
    connected:
      status === "connected" && opened !== null && recovery.phase === "healthy",
    connect,
    disconnect,
    enqueuePrompt,
    interrupt,
    respondApproval,
    respondQuestion,
    refreshPermission,
    updatePermission,
    openDiffReview,
    closeDiffReview,
  };
}

function matchesSessionScope(
  expected: string,
  received: string,
  topic?: string,
): boolean {
  if (received === expected) {
    const expectedTopic = expected.split("#", 2)[1];
    return (
      expectedTopic === undefined ||
      topic === undefined ||
      topic === expectedTopic
    );
  }
  return Boolean(topic && `${received}#${topic}` === expected);
}

function notificationMatchesSessionScope(
  notification: RpcNotification,
  expected: string,
): boolean {
  if (!isRecord(notification.params)) return true;
  const received = notification.params.session_id;
  if (received === undefined) return true;
  if (typeof received !== "string") return false;
  const topic =
    typeof notification.params.topic === "string"
      ? notification.params.topic
      : undefined;
  return matchesSessionScope(expected, received, topic);
}

function isFatalSessionContractError(message: string): boolean {
  return (
    message.startsWith("Server lacks the durable Web contract") ||
    message === "session/hydrate returned an invalid result"
  );
}
