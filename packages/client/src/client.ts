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
  UserQuestionRespondParams,
  UserQuestionRespondResult,
} from "./types.ts";
import { buildUiProtocolUrl } from "./url.ts";
import { parseSessionHydrateResult } from "./hydrate.ts";
import { parseSessionOpenResult } from "./session.ts";
import {
  parseApprovalRespondResult,
  parseUserQuestionRespondResult,
} from "./interaction.ts";
import {
  parseDiffPreviewGetResult,
  parsePermissionProfileListResult,
  parsePermissionProfileSetResult,
} from "./coding.ts";
import {
  parseSessionStatusReadResult,
  parseTaskArtifactListResult,
  parseTaskArtifactReadResult,
  parseTaskCancelResult,
  parseTaskListResult,
  parseTaskOutputReadResult,
} from "./supervision.ts";
import {
  parseConfigCapabilitiesListResult,
  parseLaunchResolveResult,
  parseSessionDeleteResult,
  parseSessionFilesListResult,
  parseSessionListResult,
} from "./workspace.ts";
import {
  APPUI_ONBOARDING_METHODS,
  parseLlmFetchModelsResult,
  parseLlmCatalogResult,
  parseProfileLlmConfigResult,
  parseProfileLlmDeleteResult,
  parseProfileLlmListResult,
  parseProfileLlmSelectResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
  type LlmCatalogResult,
  type LlmFetchModelsParams,
  type LlmFetchModelsResult,
  type LlmProvisionParams,
  type ProfileLlmConfigReadParams,
  type ProfileLlmConfigResult,
  type ProfileLlmDeleteParams,
  type ProfileLlmDeleteResult,
  type ProfileLlmListParams,
  type ProfileLlmListResult,
  type ProfileLlmSelectParams,
  type ProfileLlmSelectResult,
  type LlmTestResult,
  type LlmUpsertResult,
  type LocalProfileCreateParams,
  type LocalProfileCreateResult,
} from "./onboarding.ts";

export const DEFAULT_UI_FEATURES = [
  CORE_UI_FEATURES.APPROVAL_TYPED_V1,
  CORE_UI_FEATURES.PANE_SNAPSHOTS_V1,
  CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1,
  CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1,
  CORE_UI_FEATURES.SESSION_HYDRATE_V1,
  CORE_UI_FEATURES.USER_QUESTION_V1,
  CORE_UI_FEATURES.PLAN_TODOS_V1,
  CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
  CORE_UI_FEATURES.HARNESS_TASK_CONTROL_V1,
  CORE_UI_FEATURES.HARNESS_TASK_ARTIFACTS_V1,
] as const;

export type WebSocketFactory = (url: string) => WebSocket;

export interface OctosUiClientOptions {
  endpoint: string;
  token?: string;
  features?: readonly string[];
  requestTimeoutMs?: number;
  webSocketFactory?: WebSocketFactory;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class OctosUiProtocolError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "OctosUiProtocolError";
    this.code = code;
    this.data = data;
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

  constructor(options: OctosUiClientOptions) {
    this.options = { requestTimeoutMs: 30_000, ...options };
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  subscribeStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
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

    socket.onmessage = (event) => this.handleMessage(event.data);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      socket.onopen = () => {
        settled = true;
        this.setStatus("connected");
        resolve();
      };
      socket.onerror = () => {
        const error = new Error(
          "Could not open the Octos UI Protocol connection",
        );
        this.emitError(error);
        this.setStatus("error");
        if (!settled) reject(error);
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        const error = new Error("Octos UI Protocol connection closed");
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

  private request(method: string, params: unknown): Promise<unknown> {
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
        reject(new Error(`${method} timed out`));
      }, this.options.requestTimeoutMs);

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
      parseSessionOpenResult,
    );
  }

  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_HYDRATE,
      params,
      parseSessionHydrateResult,
    );
  }

  startTurn(params: TurnStartParams): Promise<unknown> {
    return this.request(CORE_UI_METHODS.TURN_START, params);
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
      parseApprovalRespondResult,
    );
  }

  respondUserQuestion(
    params: UserQuestionRespondParams,
  ): Promise<UserQuestionRespondResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.USER_QUESTION_RESPOND,
      params,
      parseUserQuestionRespondResult,
    );
  }

  async listPermissionProfiles(
    params: PermissionProfileListParams,
  ): Promise<PermissionProfileListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.PERMISSION_PROFILE_LIST,
      params,
      parsePermissionProfileListResult,
    );
  }

  async setPermissionProfile(
    params: PermissionProfileSetParams,
  ): Promise<PermissionProfileSetResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.PERMISSION_PROFILE_SET,
      params,
      parsePermissionProfileSetResult,
    );
  }

  async getDiffPreview(
    params: DiffPreviewGetParams,
  ): Promise<DiffPreviewGetResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.DIFF_PREVIEW_GET,
      params,
      parseDiffPreviewGetResult,
    );
  }

  async listTasks(params: TaskListParams): Promise<TaskListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_LIST,
      params,
      parseTaskListResult,
    );
  }

  async cancelTask(params: TaskCancelParams): Promise<TaskCancelResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_CANCEL,
      params,
      parseTaskCancelResult,
    );
  }

  async readTaskOutput(
    params: TaskOutputReadParams,
  ): Promise<TaskOutputReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_OUTPUT_READ,
      params,
      parseTaskOutputReadResult,
    );
  }

  async listTaskArtifacts(
    params: TaskArtifactListParams,
  ): Promise<TaskArtifactListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_ARTIFACT_LIST,
      params,
      parseTaskArtifactListResult,
    );
  }

  async readTaskArtifact(
    params: TaskArtifactReadParams,
  ): Promise<TaskArtifactReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.TASK_ARTIFACT_READ,
      params,
      parseTaskArtifactReadResult,
    );
  }

  async readSessionStatus(sessionId: string): Promise<SessionStatusReadResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_STATUS_READ,
      { session_id: sessionId },
      parseSessionStatusReadResult,
    );
  }

  async listSessions(
    params: SessionListParams = {},
  ): Promise<SessionListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_LIST,
      params,
      parseSessionListResult,
    );
  }

  async listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.CONFIG_CAPABILITIES_LIST,
      {},
      parseConfigCapabilitiesListResult,
    );
  }

  async createLocalProfile(
    params: LocalProfileCreateParams,
  ): Promise<LocalProfileCreateResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LOCAL_CREATE,
      params,
      parseLocalProfileCreateResult,
    );
  }

  async getLlmCatalog(): Promise<LlmCatalogResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
      {},
      parseLlmCatalogResult,
    );
  }

  async listProfileModels(
    params: ProfileLlmListParams,
  ): Promise<ProfileLlmListResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      params,
      parseProfileLlmListResult,
    );
  }

  async readProfileLlmConfig(
    params: ProfileLlmConfigReadParams = {},
  ): Promise<ProfileLlmConfigResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      params,
      parseProfileLlmConfigResult,
    );
  }

  async selectProfileModel(
    params: ProfileLlmSelectParams,
  ): Promise<ProfileLlmSelectResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_SELECT,
      params,
      parseProfileLlmSelectResult,
    );
  }

  async deleteProfileModel(
    params: ProfileLlmDeleteParams,
  ): Promise<ProfileLlmDeleteResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_DELETE,
      params,
      parseProfileLlmDeleteResult,
    );
  }

  async fetchLlmModels(
    params: LlmFetchModelsParams,
  ): Promise<LlmFetchModelsResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_FETCH_MODELS,
      params,
      parseLlmFetchModelsResult,
    );
  }

  async testLlmProfile(params: LlmProvisionParams): Promise<LlmTestResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_TEST,
      params,
      parseLlmTestResult,
    );
  }

  async upsertLlmProfile(params: LlmProvisionParams): Promise<LlmUpsertResult> {
    return this.validatedRequest(
      APPUI_ONBOARDING_METHODS.PROFILE_LLM_UPSERT,
      params,
      parseLlmUpsertResult,
    );
  }

  async resolveLaunch(
    params: LaunchResolveParams,
  ): Promise<LaunchResolveResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.LAUNCH_RESOLVE,
      params,
      parseLaunchResolveResult,
    );
  }

  async deleteSession(
    params: SessionDeleteParams,
  ): Promise<SessionDeleteResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_DELETE,
      params,
      parseSessionDeleteResult,
    );
  }

  async listSessionFiles(
    params: SessionFilesListParams,
  ): Promise<SessionFilesListResult> {
    return this.validatedRequest(
      CORE_UI_METHODS.SESSION_FILES_LIST,
      params,
      parseSessionFilesListResult,
    );
  }

  private async validatedRequest<Result>(
    method: string,
    params: unknown,
    parse: (value: unknown) => Result | null,
  ): Promise<Result> {
    const result = await this.request(method, params);
    const parsed = parse(result);
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
