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

export type PermissionProfileMode =
  "read_only" | "workspace_write" | "danger_full_access";
export type PermissionNetworkPolicy = "allow" | "deny";

export interface PermissionProfileSelection {
  mode: PermissionProfileMode;
  network: PermissionNetworkPolicy;
}

export interface PermissionProfileUpdate {
  mode?: PermissionProfileMode;
  network?: PermissionNetworkPolicy;
  approval_policy?: "on-request" | "never";
}

export interface PermissionProfileListParams {
  session_id: string;
}

export interface PermissionProfileSetParams {
  session_id: string;
  update: PermissionProfileUpdate;
  runtime_mode?: string;
}

export interface PermissionProfileListResult {
  session_id: string;
  current: PermissionProfileSelection;
  profiles: PermissionProfileSelection[];
}

export interface PermissionProfileSetResult {
  session_id: string;
  current: PermissionProfileSelection;
  applied: boolean;
}

export interface DiffPreviewGetParams {
  session_id: string;
  preview_id: string;
}

export interface DiffPreviewLine {
  kind: string;
  content: string;
  old_line?: number;
  new_line?: number;
}

export interface DiffPreviewHunk {
  header: string;
  lines: DiffPreviewLine[];
}

export interface DiffPreviewFile {
  path: string;
  old_path?: string;
  status: string;
  hunks: DiffPreviewHunk[];
}

export interface DiffPreview {
  session_id: string;
  preview_id: string;
  title?: string;
  files: DiffPreviewFile[];
}

export interface DiffPreviewGetResult {
  status: string;
  source: string;
  preview: DiffPreview;
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

export interface SessionHydrateParams {
  session_id: string;
  after?: UiCursor;
  include?: Array<"messages" | "threads" | "turns" | "pending_approvals">;
}

export interface HydratedMessage {
  seq: number;
  role: string;
  content: string;
  turn_id?: string;
  thread_id?: string;
  client_message_id?: string;
  persisted_at: string;
  reasoning_content?: string;
  message_id?: string;
  source?: string;
  media: string[];
}

export interface HydratedTurn {
  turn_id: string;
  state:
    | "active"
    | "interrupting"
    | "completed"
    | "errored"
    | "interrupted"
    | "unknown"
    | string;
  started_at?: string;
  completed_at?: string;
  thread_id?: string;
}

export interface SessionHydrateResult {
  session_id: string;
  cursor: UiCursor;
  context?: unknown;
  context_state?: unknown;
  messages?: HydratedMessage[];
  threads?: unknown[];
  turns?: HydratedTurn[];
  pending_approvals?: unknown[];
  pending_questions?: unknown[];
  replayed_envelopes?: ProjectionEnvelopeV2[];
  replayed_tool_envelopes?: ProjectionEnvelopeV2[];
}

export interface ReplayLossyEvent {
  session_id: string;
  dropped_count: number;
  last_durable_cursor?: UiCursor;
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
