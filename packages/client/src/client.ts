import { createRequest, parseIncomingFrame } from "./rpc.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import type { RpcNotification } from "./rpc.ts";
import type {
  ApprovalRespondParams,
  ApprovalRespondResult,
  ConnectionStatus,
  DiffPreviewGetParams,
  DiffPreviewGetResult,
  ConfigCapabilitiesListResult,
  LaunchResolveParams,
  LaunchResolveResult,
  PermissionProfileListParams,
  PermissionProfileListResult,
  PermissionProfileSetParams,
  PermissionProfileSetResult,
  SessionHydrateParams,
  SessionHydrateResult,
  SessionOpenParams,
  SessionOpenResult,
  SessionDeleteParams,
  SessionDeleteResult,
  SessionFilesListParams,
  SessionFilesListResult,
  SessionListParams,
  SessionListResult,
  SessionStatusReadResult,
  TaskArtifactListParams,
  TaskArtifactListResult,
  TaskArtifactReadParams,
  TaskArtifactReadResult,
  TaskCancelParams,
  TaskCancelResult,
  TaskListParams,
  TaskListResult,
  TaskOutputReadParams,
  TaskOutputReadResult,
  TurnStartParams,
  TurnStateGetParams,
  TurnStateGetResult,
  UserQuestionRespondParams,
  UserQuestionRespondResult,
  UiProtocolCapabilities,
} from "./types.ts";
import { buildUiProtocolUrl } from "./url.ts";
import {
  APPUI_ONBOARDING_METHODS,
  APPUI_WORKSPACE_BROWSE_METHODS,
} from "./onboarding-methods.ts";
import type {
  LlmCatalogResult,
  LlmFetchModelsParams,
  LlmFetchModelsResult,
  LlmProvisionParams,
  ProfileLlmConfigReadParams,
  ProfileLlmConfigResult,
  ProfileLlmDeleteParams,
  ProfileLlmDeleteResult,
  ProfileLlmListParams,
  ProfileLlmListResult,
  ProfileLlmSelectParams,
  ProfileLlmSelectResult,
  LlmTestResult,
  LlmUpsertResult,
  LocalProfileCreateParams,
  LocalProfileCreateResult,
} from "./onboarding.ts";
import type {
  WorkspaceCreateParams,
  WorkspaceCreateResult,
  WorkspaceListParams,
  WorkspaceListResult,
} from "./workspace-browse.ts";

// Reuse each loader so production builds emit one preload closure per family.
const loadCodingResponses = () => import("./coding.ts");
const loadTaskResults = () => import("./task-results.ts");
const loadSessionStatus = () => import("./session-status-result.ts");
const loadOnboardingResponses = () => import("./onboarding.ts");
const loadWorkspaceResponses = () => import("./workspace.ts");
const loadWorkspaceBrowseResponses = () => import("./workspace-browse.ts");
const loadWorkspaceResults = () => import("./workspace-results.ts");
const loadInteractionResponses = () => import("./interaction-responses.ts");

/**
 * Core feature that OPTS a connection into the whole external-driver family
 * (`session/driver/*`, `peer/dispatch`, `peer/control`). The Core gate is a
 * STRICT opt-in (contract 2800 §1): nothing in that family is advertised to the
 * web until client_hello negotiates this feature, so a real Core stayed
 * unreachable while every mock run passed (the mock advertises regardless).
 *
 * Narrow vertical-slice guard: the PINNED Core contract revision
 * (`generated/core-contract.ts`) predates this feature, so it is deliberately
 * NOT part of the generated `CORE_UI_FEATURES` index. The identical wire string
 * is owned by `external-driver.ts` (`EXTERNAL_DRIVER_V1_FEATURE`); it is
 * duplicated here as a literal ONLY to keep `client.ts` free of a static import
 * cycle into that module (which imports `OctosUiProtocolError` from here).
 * Delete this constant once `contract:update` carries the feature.
 */
export const EXTERNAL_DRIVER_V1_UI_FEATURE = "external_driver_v1";

export const DEFAULT_UI_FEATURES = [
  CORE_UI_FEATURES.APPROVAL_TYPED_V1,
  CORE_UI_FEATURES.PANE_SNAPSHOTS_V1,
  CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1,
  CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1,
  CORE_UI_FEATURES.SESSION_HYDRATE_V1,
  CORE_UI_FEATURES.THREAD_GRAPH_V1,
  CORE_UI_FEATURES.TURN_STATE_GET_V1,
  CORE_UI_FEATURES.TURN_STEER_DROPPED_V1,
  CORE_UI_FEATURES.USER_QUESTION_V1,
  CORE_UI_FEATURES.PLAN_TODOS_V1,
  CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
  CORE_UI_FEATURES.HARNESS_TASK_CONTROL_V1,
  CORE_UI_FEATURES.HARNESS_TASK_ARTIFACTS_V1,
  CORE_UI_FEATURES.CONTEXT_LIFECYCLE_V1,
  CORE_UI_FEATURES.REVIEW_START_V1,
  CORE_UI_FEATURES.CODING_AUTONOMY_V1,
  CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
  CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
  CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
  CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
  EXTERNAL_DRIVER_V1_UI_FEATURE,
] as const;

export type WebSocketFactory = (url: string) => WebSocket;

/**
 * LLM probes round-trip a live provider (list models, run a test completion);
 * a slow provider needs far more headroom than an in-process Core call.
 */
const LLM_PROBE_TIMEOUT_MS = 120_000;

export interface OctosUiClientOptions {
  endpoint: string;
  token?: string;
  features?: readonly string[];
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  webSocketFactory?: WebSocketFactory;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * A request that received no response within its timeout. Distinct from a
 * server-side rejection: the server may still have accepted the request, so
 * callers must not report it as a failure or invite a retry blindly.
 */
export class OctosUiRequestTimeoutError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`${method} timed out`);
    this.name = "OctosUiRequestTimeoutError";
    this.method = method;
  }
}

export class OctosUiClient {
  private readonly options: Required<
    Pick<OctosUiClientOptions, "requestTimeoutMs">
  > &
    OctosUiClientOptions;
  private readonly statusListeners = new Set<
    (status: ConnectionStatus) => void
  >();
  private readonly notificationListeners = new Set<
    (event: RpcNotification) => void
  >();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly settledRequestIds = new Set<string>();
  private readonly settledRequestOrder: string[] = [];
  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private currentStatus: ConnectionStatus = "idle";

  /**
   * Shared command adapter. Command factories receive this ONE adapter instead
   * of each allocating its own identical closure; it is bound to this client's
   * live transport authority (it defers to `this.request` per call) and is
   * never shared across clients.
   */
  private readonly invoke = {
    request: (method: string, params: unknown) => this.request(method, params),
  };

  constructor(options: OctosUiClientOptions) {
    this.options = { requestTimeoutMs: 30_000, ...options };
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  async contextCommands(
    sessionId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createContextCommands } = await import("./context-commands.ts");
    return createContextCommands(this.invoke, sessionId, capabilities);
  }

  async historyCommands(
    sessionId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createHistoryCommands } = await import("./history.ts");
    return createHistoryCommands(this.invoke, sessionId, capabilities);
  }

  async inspectionCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object = this,
  ) {
    const { createInspectionCommands } = await import("./inspection.ts");
    return createInspectionCommands(
      this.invoke,
      { sessionId, profileId, authority },
      capabilities,
    );
  }

  async btwCommands(sessionId: string, capabilities: UiProtocolCapabilities) {
    const { createBtwCommands } = await import("./btw.ts");
    return createBtwCommands(this.invoke, sessionId, capabilities);
  }

  async steerCommands(sessionId: string, capabilities: UiProtocolCapabilities) {
    const { createSteerCommands } = await import("./steer.ts");
    return createSteerCommands(this.invoke, sessionId, capabilities);
  }

  async autonomyCommands(
    sessionId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createSessionAutonomyCommands } = await import("./autonomy.ts");
    return createSessionAutonomyCommands(this.invoke, sessionId, capabilities);
  }

  async externalDriverCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    topic?: string,
  ) {
    const { createExternalDriverCommands } =
      await import("./external-driver.ts");
    return createExternalDriverCommands(this.invoke, sessionId, capabilities, {
      profileId,
      ...(topic === undefined ? {} : { topic }),
    });
  }

  async skillCommands(profileId: string, capabilities: UiProtocolCapabilities) {
    const { createSkillCommands } = await import("./skills.ts");
    return createSkillCommands(this.invoke, profileId, capabilities);
  }

  async researchCommands(
    profileId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createResearchCommands } = await import("./research.ts");
    return createResearchCommands(this.invoke, profileId, capabilities);
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  async inventoryCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createInventoryCommands } = await import("./inventory.ts");
    return createInventoryCommands(
      this.invoke,
      sessionId,
      profileId,
      capabilities,
    );
  }

  subscribeNotifications(
    listener: (event: RpcNotification) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  subscribeErrors(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.socket !== null)
      throw new Error("Octos UI client is already connected");
    this.setStatus("connecting");

    const url = buildUiProtocolUrl({
      endpoint: this.options.endpoint,
      ...(this.options.token === undefined
        ? {}
        : { token: this.options.token }),
      features: this.options.features ?? DEFAULT_UI_FEATURES,
    });
    const factory =
      this.options.webSocketFactory ??
      ((target: string) => new WebSocket(target));
    let socket: WebSocket;
    try {
      socket = factory(url);
    } catch (reason) {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      this.setStatus("error");
      this.emitError(error);
      throw error;
    }
    this.socket = socket;

    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(
          "Connection timed out. Check that Octos is running and the server address is reachable.",
        );
        reject(error);
        if (this.socket !== socket) return;
        this.socket = null;
        this.emitError(error);
        this.setStatus("error");
        try {
          socket.close(1000, "connection timeout");
        } catch {
          /* Already closed. */
        }
      }, this.options.connectTimeoutMs ?? 15_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        if (settled) return;
        if (this.socket !== socket) {
          if (!settled)
            reject(new Error("Octos UI Protocol connection replaced"));
          settled = true;
          return;
        }
        settled = true;
        this.setStatus("connected");
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        const error = new Error(
          "Could not open the Octos UI Protocol connection",
        );
        if (this.socket !== socket) {
          if (!settled) reject(error);
          settled = true;
          return;
        }
        this.emitError(error);
        this.setStatus("error");
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        const error = new Error("Octos UI Protocol connection closed");
        // disconnect() may already have started another connection on this
        // client. The old close still rejects its own pending connect, but
        // cannot reject RPCs or change state on the replacement transport.
        if (this.socket !== socket) {
          if (!settled) reject(error);
          settled = true;
          return;
        }
        this.socket = null;
        this.rejectPending(error);
        if (!settled) {
          settled = true;
          this.setStatus("error");
          reject(error);
        } else if (this.currentStatus !== "error") {
          this.setStatus("disconnected");
        }
      };
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.rejectPending(new Error("Octos UI Protocol client disconnected"));
    if (socket && socket.readyState < 2)
      socket.close(1000, "client disconnect");
    this.setStatus("disconnected");
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<unknown> {
    const socket = this.socket;
    if (
      this.currentStatus !== "connected" ||
      socket === null ||
      socket.readyState !== 1
    ) {
      return Promise.reject(
        new Error("Octos UI Protocol connection is not ready"),
      );
    }

    const id = String(this.nextRequestId++);
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.markRequestSettled(id);
        reject(new OctosUiRequestTimeoutError(method));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });

      try {
        socket.send(JSON.stringify(createRequest(id, method, params)));
      } catch (reason) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      }
    });
  }

  openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_OPEN,
      params,
      async (value) =>
        (await import("./session.ts")).parseSessionOpenResult(value),
    );
  }

  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_HYDRATE,
      params,
      async (value) =>
        (await import("./hydrate.ts")).parseSessionHydrateResult(value),
    );
  }

  startTurn(params: TurnStartParams): Promise<unknown> {
    return this.request(CORE_UI_METHODS.TURN_START, params);
  }

  getTurnState(params: TurnStateGetParams): Promise<TurnStateGetResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TURN_STATE_GET,
      params,
      async (value) => {
        const result = (
          await import("./turn-state.ts")
        ).parseTurnStateGetResult(value);
        return result?.session_id === params.session_id &&
          result.turn_id === params.turn_id
          ? result
          : null;
      },
    );
  }

  /** Narrow, captured-owner peer commands; no public raw RPC surface. */
  async peerCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
    authority: object = this,
  ) {
    const { createPeerCommands } = await import("./peer-commands.ts");
    return createPeerCommands(
      this.invoke,
      { sessionId, profileId, authority },
      capabilities,
    );
  }

  /** Authenticated blob transfer stays separate from the WebSocket RPC wire. */
  async mediaCommands(
    sessionId: string,
    profileId: string,
    capabilities: UiProtocolCapabilities,
  ) {
    const { createMediaCommands } = await import("./media.ts");
    return createMediaCommands({
      endpoint: this.options.endpoint,
      ...(this.options.token === undefined
        ? {}
        : { token: this.options.token }),
      sessionId,
      profileId,
      capabilities,
    });
  }

  interruptTurn(sessionId: string, turnId: string): Promise<unknown> {
    return this.request(CORE_UI_METHODS.TURN_INTERRUPT, {
      session_id: sessionId,
      turn_id: turnId,
    });
  }

  respondApproval(
    params: ApprovalRespondParams,
  ): Promise<ApprovalRespondResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.APPROVAL_RESPOND,
      params,
      async (value) =>
        (await loadInteractionResponses()).parseApprovalRespondResult(value),
    );
  }

  respondUserQuestion(
    params: UserQuestionRespondParams,
  ): Promise<UserQuestionRespondResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.USER_QUESTION_RESPOND,
      params,
      async (value) =>
        (await loadInteractionResponses()).parseUserQuestionRespondResult(
          value,
        ),
    );
  }

  async listPermissionProfiles(
    params: PermissionProfileListParams,
  ): Promise<PermissionProfileListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.PERMISSION_PROFILE_LIST,
      params,
      async (value) =>
        (await loadCodingResponses()).parsePermissionProfileListResult(value),
    );
  }

  async setPermissionProfile(
    params: PermissionProfileSetParams,
  ): Promise<PermissionProfileSetResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.PERMISSION_PROFILE_SET,
      params,
      async (value) =>
        (await loadCodingResponses()).parsePermissionProfileSetResult(value),
    );
  }

  async getDiffPreview(
    params: DiffPreviewGetParams,
  ): Promise<DiffPreviewGetResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.DIFF_PREVIEW_GET,
      params,
      async (value) =>
        (await loadCodingResponses()).parseDiffPreviewGetResult(value),
    );
  }

  async listTasks(params: TaskListParams): Promise<TaskListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_LIST,
      params,
      async (value) => (await loadTaskResults()).parseTaskListResult(value),
    );
  }

  async cancelTask(params: TaskCancelParams): Promise<TaskCancelResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_CANCEL,
      params,
      async (value) => (await loadTaskResults()).parseTaskCancelResult(value),
    );
  }

  async readTaskOutput(
    params: TaskOutputReadParams,
  ): Promise<TaskOutputReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_OUTPUT_READ,
      params,
      async (value) =>
        (await loadTaskResults()).parseTaskOutputReadResult(value),
    );
  }

  async listTaskArtifacts(
    params: TaskArtifactListParams,
  ): Promise<TaskArtifactListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_ARTIFACT_LIST,
      params,
      async (value) =>
        (await loadTaskResults()).parseTaskArtifactListResult(value),
    );
  }

  async readTaskArtifact(
    params: TaskArtifactReadParams,
  ): Promise<TaskArtifactReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_ARTIFACT_READ,
      params,
      async (value) =>
        (await loadTaskResults()).parseTaskArtifactReadResult(value),
    );
  }

  async readSessionStatus(sessionId: string): Promise<SessionStatusReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_STATUS_READ,
      { session_id: sessionId },
      async (value) =>
        (await loadSessionStatus()).parseSessionStatusReadResult(value),
    );
  }

  async listSessions(
    params: SessionListParams = {},
  ): Promise<SessionListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_LIST,
      params,
      async (value) =>
        (await loadWorkspaceResults()).parseSessionListResult(value),
    );
  }

  async listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.CONFIG_CAPABILITIES_LIST,
      {},
      async (value) =>
        (await loadWorkspaceResponses()).parseConfigCapabilitiesListResult(
          value,
        ),
    );
  }

  async createLocalProfile(
    params: LocalProfileCreateParams,
  ): Promise<LocalProfileCreateResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LOCAL_CREATE,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseLocalProfileCreateResult(value),
    );
  }

  async getLlmCatalog(): Promise<LlmCatalogResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
      {},
      async (value) =>
        (await loadOnboardingResponses()).parseLlmCatalogResult(value),
    );
  }

  async listProfileModels(
    params: ProfileLlmListParams,
  ): Promise<ProfileLlmListResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseProfileLlmListResult(value),
    );
  }

  async readProfileLlmConfig(
    params: ProfileLlmConfigReadParams = {},
  ): Promise<ProfileLlmConfigResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseProfileLlmConfigResult(value),
    );
  }

  async selectProfileModel(
    params: ProfileLlmSelectParams,
  ): Promise<ProfileLlmSelectResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_SELECT,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseProfileLlmSelectResult(value),
    );
  }

  async deleteProfileModel(
    params: ProfileLlmDeleteParams,
  ): Promise<ProfileLlmDeleteResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_DELETE,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseProfileLlmDeleteResult(value),
    );
  }

  async fetchLlmModels(
    params: LlmFetchModelsParams,
  ): Promise<LlmFetchModelsResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_FETCH_MODELS,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseLlmFetchModelsResult(value),
      LLM_PROBE_TIMEOUT_MS,
    );
  }

  async testLlmProfile(params: LlmProvisionParams): Promise<LlmTestResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_TEST,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseLlmTestResult(value),
      LLM_PROBE_TIMEOUT_MS,
    );
  }

  async upsertLlmProfile(params: LlmProvisionParams): Promise<LlmUpsertResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_UPSERT,
      params,
      async (value) =>
        (await loadOnboardingResponses()).parseLlmUpsertResult(value),
    );
  }

  /**
   * WEB-WORKSPACE-BROWSER-CONTRACT-5000 §1. `path: null` (or an empty path)
   * asks about the server's own working directory.
   */
  async listWorkspaceFolders(
    params: WorkspaceListParams,
  ): Promise<WorkspaceListResult> {
    return this.validatedRequest(
      APPUI_WORKSPACE_BROWSE_METHODS.WORKSPACE_LIST,
      params,
      async (value) =>
        (await loadWorkspaceBrowseResponses()).parseWorkspaceListResult(value),
    );
  }

  /**
   * WEB-WORKSPACE-BROWSER-CONTRACT-5000 §2. `created: false` is an idempotent
   * success — a directory of that name already existed.
   */
  async createWorkspaceFolder(
    params: WorkspaceCreateParams,
  ): Promise<WorkspaceCreateResult> {
    return this.validatedRequest(
      APPUI_WORKSPACE_BROWSE_METHODS.WORKSPACE_CREATE,
      params,
      async (value) =>
        (await loadWorkspaceBrowseResponses()).parseWorkspaceCreateResult(
          value,
        ),
    );
  }

  async resolveLaunch(
    params: LaunchResolveParams,
  ): Promise<LaunchResolveResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.LAUNCH_RESOLVE,
      params,
      async (value) =>
        (await loadWorkspaceResults()).parseLaunchResolveResult(value),
    );
  }

  async deleteSession(
    params: SessionDeleteParams,
  ): Promise<SessionDeleteResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_DELETE,
      params,
      async (value) =>
        (await loadWorkspaceResults()).parseSessionDeleteResult(value),
    );
  }

  async listSessionFiles(
    params: SessionFilesListParams,
  ): Promise<SessionFilesListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_FILES_LIST,
      params,
      async (value) =>
        (await loadWorkspaceResults()).parseSessionFilesListResult(value),
    );
  }

  private async validatedRequest<Result>(
    method: string,
    params: unknown,
    parse: (value: unknown) => Result | null | Promise<Result | null>,
    timeoutMs?: number,
  ): Promise<Result> {
    // Dispatch NOW, before any decoder import resolves: request() sends
    // synchronously, so a mutation is never deferred across a module await
    // onto a later transport authority. The decoder loads after dispatch.
    const result = await this.request(method, params, timeoutMs);
    const parsed = await parse(result);
    if (!parsed) throw new Error(`${method} returned an invalid result`);
    return parsed;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      this.emitError(new Error("Octos UI Protocol sent a non-text frame"));
      return;
    }

    const frame = parseIncomingFrame(data);
    if (frame.kind === "invalid") {
      this.emitError(new Error(`Rejected protocol frame: ${frame.reason}`));
      return;
    }
    if (frame.kind === "notification") {
      for (const listener of this.notificationListeners) listener(frame.value);
      return;
    }

    const id = frame.value.id;
    if (typeof id !== "string") {
      const message =
        frame.kind === "failure"
          ? frame.value.error.message
          : "Protocol response is missing a request id";
      this.emitError(new Error(message));
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      if (this.settledRequestIds.delete(id)) return;
      this.emitError(new Error(`Received response for unknown request ${id}`));
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (frame.kind === "success") pending.resolve(frame.value.result);
    else {
      pending.reject(
        new OctosUiProtocolError(
          frame.value.error.code,
          frame.value.error.message,
          frame.value.error.data,
        ),
      );
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.markRequestSettled(id);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private markRequestSettled(id: string): void {
    this.settledRequestIds.add(id);
    this.settledRequestOrder.push(id);
    while (this.settledRequestOrder.length > 128) {
      const expired = this.settledRequestOrder.shift();
      if (expired) this.settledRequestIds.delete(expired);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}
import { OctosUiProtocolError } from "./protocol-error.ts";
export { OctosUiProtocolError } from "./protocol-error.ts";
