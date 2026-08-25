export interface UiCursor {
  stream: string;
  seq: number;
}

export interface UiProtocolVersion {
  protocol: string;
  schema_version: number;
  jsonrpc: string;
}

export interface UiProtocolCapabilities {
  version: UiProtocolVersion;
  capabilities_schema_version: number;
  supported_methods: string[];
  supported_notifications: string[];
  supported_features?: string[];
}

export interface SessionOpenParams {
  session_id: string;
  topic?: string;
  profile_id?: string;
  cwd?: string;
  after?: UiCursor;
}

export interface SessionOpened {
  session_id: string;
  active_profile_id?: string;
  cursor?: UiCursor;
  capabilities?: UiProtocolCapabilities;
  workspace_root?: string;
  panes?: unknown;
  reasoning_effort?: string | null;
}

export interface SessionOpenResult {
  opened: SessionOpened;
}

export interface TurnStartParams {
  session_id: string;
  turn_id: string;
  input: Array<{ kind: "text"; text: string }>;
  topic?: string;
  reasoning_effort?: string;
}

export interface ProjectionPayload {
  type: string;
  data: unknown;
}

export interface ProjectionEnvelopeV2 {
  session_id: string;
  topic?: string;
  thread_id: string;
  seq: number;
  cursor?: UiCursor;
  turn_id: string;
  client_message_id?: string;
  payload: ProjectionPayload;
}

export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "error";
