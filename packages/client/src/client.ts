import { createRequest, parseIncomingFrame } from "./rpc.ts";
import type { RpcNotification } from "./rpc.ts";
import type {
  ApprovalRespondParams,
  ApprovalRespondResult,
  ConnectionStatus,
  DiffPreviewGetParams,
  DiffPreviewGetResult,
  PermissionProfileListParams,
  PermissionProfileListResult,
  PermissionProfileSetParams,
  PermissionProfileSetResult,
  SessionHydrateParams,
  SessionHydrateResult,
  SessionOpenParams,
  SessionOpenResult,
  TurnStartParams,
  UserQuestionRespondParams,
  UserQuestionRespondResult,
} from "./types.ts";
import { buildUiProtocolUrl } from "./url.ts";
import { parseSessionHydrateResult } from "./hydrate.ts";
import {
  parseDiffPreviewGetResult,
  parsePermissionProfileListResult,
  parsePermissionProfileSetResult,
} from "./coding.ts";

export const DEFAULT_UI_FEATURES = [
  "approval.typed.v1",
  "pane.snapshots.v1",
  "session.workspace_cwd.v1",
  "state.session_hydrate.v1",
  "user_question.v1",
  "plan.todos.v1",
  "projection.envelope.v2",
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

  request<Result>(method: string, params: unknown): Promise<Result> {
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
    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        method,
        resolve: (result) => resolve(result as Result),
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
    return this.request("session/open", params);
  }

  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    const result = await this.request<unknown>("session/hydrate", params);
    const parsed = parseSessionHydrateResult(result);
    if (!parsed) {
      throw new Error("session/hydrate returned an invalid result");
    }
    return parsed;
  }

  startTurn(params: TurnStartParams): Promise<unknown> {
    return this.request("turn/start", params);
  }

  interruptTurn(sessionId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", {
      session_id: sessionId,
      turn_id: turnId,
    });
  }

  respondApproval(
    params: ApprovalRespondParams,
  ): Promise<ApprovalRespondResult> {
    return this.request("approval/respond", params);
  }

  respondUserQuestion(
    params: UserQuestionRespondParams,
  ): Promise<UserQuestionRespondResult> {
    return this.request("user_question/respond", params);
  }

  async listPermissionProfiles(
    params: PermissionProfileListParams,
  ): Promise<PermissionProfileListResult> {
    const result = await this.request<unknown>(
      "permission/profile/list",
      params,
    );
    const parsed = parsePermissionProfileListResult(result);
    if (!parsed) {
      throw new Error("permission/profile/list returned an invalid result");
    }
    return parsed;
  }

  async setPermissionProfile(
    params: PermissionProfileSetParams,
  ): Promise<PermissionProfileSetResult> {
    const result = await this.request<unknown>(
      "permission/profile/set",
      params,
    );
    const parsed = parsePermissionProfileSetResult(result);
    if (!parsed) {
      throw new Error("permission/profile/set returned an invalid result");
    }
    return parsed;
  }

  async getDiffPreview(
    params: DiffPreviewGetParams,
  ): Promise<DiffPreviewGetResult> {
    const result = await this.request<unknown>("diff/preview/get", params);
    const parsed = parseDiffPreviewGetResult(result);
    if (!parsed) throw new Error("diff/preview/get returned an invalid result");
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
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
