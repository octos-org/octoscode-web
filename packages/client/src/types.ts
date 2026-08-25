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
  unsupported?: Array<{ method: string; reason: string }>;
}

export type ApprovalDecision = "approve" | "deny";
export type ApprovalScope = "request" | "turn" | "session" | "tool";

export interface ApprovalRequested {
  sessionId: string;
  topic?: string;
  approvalId: string;
  turnId: string;
  toolName: string;
  title: string;
  body: string;
  approvalKind?: string;
  risk?: string;
  typedDetails?: unknown;
  renderHints?: unknown;
}

export interface ApprovalRespondParams {
  session_id: string;
  approval_id: string;
  decision: ApprovalDecision;
  approval_scope?: ApprovalScope;
  client_note?: string;
}

export interface ApprovalRespondResult {
  approval_id: string;
  accepted: boolean;
  status: string;
  runtime_resumed: boolean;
}

export interface UserQuestionOption {
  label: string;
  description: string;
}

export interface UserQuestion {
  header: string;
  question: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
  allowFreeText: boolean;
}

export interface UserQuestionRequested {
  sessionId: string;
  topic?: string;
  questionId: string;
  turnId: string;
  title: string;
  body: string;
  questions: UserQuestion[];
}

export interface UserQuestionAnswer {
  selected_labels?: string[];
  free_text?: string;
}

export interface UserQuestionRespondParams {
  session_id: string;
  question_id: string;
  answers: UserQuestionAnswer[];
  client_note?: string;
}

export interface UserQuestionRespondResult {
  question_id: string;
  accepted: boolean;
  runtime_resumed: boolean;
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
