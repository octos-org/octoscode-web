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

export type TaskRuntimeState =
  "pending" | "running" | "completed" | "failed" | "cancelled" | string;

export interface OutputCursor {
  offset: number;
}

export interface TaskListParams {
  session_id: string;
  topic?: string;
}

export interface TaskListEntry {
  id: string;
  tool_name: string;
  tool_call_id: string;
  state: TaskRuntimeState;
  status: string;
  lifecycle_state: string;
  runtime_state: string;
  source?: string;
  role?: string;
  summary?: string;
  artifact_count?: number;
  runtime_policy_stamp?: unknown;
  parent_session_key?: string;
  child_session_key?: string;
  child_terminal_state?: string;
  child_join_state?: string;
  child_joined_at?: string;
  child_failure_action?: string;
  runtime_detail?: unknown;
  workflow_kind?: string;
  current_phase?: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  output_files: string[];
  error?: string;
  session_key?: string;
}

export interface TaskListResult {
  session_id: string;
  topic?: string;
  tasks: TaskListEntry[];
}

export interface TaskCancelParams {
  task_id: string;
  session_id?: string;
  profile_id?: string;
}

export interface TaskCancelResult {
  task_id: string;
  status: TaskRuntimeState;
}

export interface TaskOutputReadParams {
  session_id: string;
  task_id: string;
  cursor?: OutputCursor;
  limit_bytes?: number;
}

export interface TaskOutputReadLimitation {
  code: string;
  message: string;
}

export interface TaskOutputReadResult {
  session_id: string;
  task_id: string;
  source: string;
  cursor: OutputCursor;
  next_cursor: OutputCursor;
  text: string;
  bytes_read: number;
  total_bytes: number;
  truncated: boolean;
  complete: boolean;
  live_tail_supported: boolean;
  is_snapshot_projection: boolean;
  task_status: string;
  runtime_state: string;
  lifecycle_state: string;
  runtime_detail?: unknown;
  output_files: string[];
  limitations: TaskOutputReadLimitation[];
}

export interface TaskArtifactRecord {
  id: string;
  title: string;
  kind: string;
  status: string;
  path?: string;
  content?: string;
}

export interface TaskArtifactListParams {
  session_id: string;
  task_id: string;
  profile_id?: string;
  agent_id?: string;
}

export interface TaskArtifactListResult {
  session_id: string;
  task_id: string;
  agent_id?: string;
  artifacts: TaskArtifactRecord[];
}

export interface TaskArtifactReadParams extends TaskArtifactListParams {
  artifact_id?: string;
  path?: string;
  cursor?: OutputCursor;
  limit_bytes?: number;
}

export interface TaskArtifactReadResult {
  session_id: string;
  task_id: string;
  agent_id?: string;
  artifact: TaskArtifactRecord;
  content?: string;
  cursor?: OutputCursor;
  next_cursor?: OutputCursor;
  has_more: boolean;
}

export interface TaskUpdated {
  sessionId: string;
  topic?: string;
  taskId: string;
  toolCallId?: string;
  turnId?: string;
  title: string;
  state: TaskRuntimeState;
  runtimeDetail?: string;
  source?: string;
  role?: string;
  summary?: string;
  artifactCount?: number;
  runtimePolicyStamp?: unknown;
}

export interface TaskOutputDelta {
  sessionId: string;
  topic?: string;
  taskId: string;
  cursor: OutputCursor;
  text: string;
}

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  id: string;
  title: string;
  status: PlanItemStatus;
  priority?: string;
}

export interface PlanUpdated {
  sessionId: string;
  topic?: string;
  turnId?: string;
  title?: string;
  updatedAtMs: number;
  items: PlanItem[];
}

export interface SessionStatusReadResult {
  session_id: string;
  runtime_mode?: string;
  profile_id?: string;
  cwd?: string;
  workspace_root?: string;
  active_turn_id?: string;
  runtime_policy_stamp?: Record<string, unknown>;
  model?: { model: string; provider: string; title?: string };
  permission_profile?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  sandbox?: string;
  filesystem_scope?: string;
  network?: string;
  tool_policy_id?: string;
  mcp_servers: string[];
  memory_scope?: string;
  health?: RuntimeHealthStatus;
  usage?: SessionUsageStatus;
  cursor?: SessionCursorStatus;
}

export interface RuntimeHealthStatus {
  status: string;
  message?: string;
}

export interface SessionUsageStatus {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  cached_output_tokens?: number;
  estimated_cost_micros_usd?: number;
}

export interface SessionCursorStatus {
  cursor?: UiCursor;
  healthy: boolean;
  replay_supported: boolean;
  detail?: string;
}

export interface TokenCostUpdate {
  sessionId: string;
  turnId?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  responseCost?: number;
  sessionCost?: number;
  currency?: string;
  model?: string;
  contextWindow?: number;
}

export interface SessionListParams {
  cwd?: string;
}

export interface SessionListEntry {
  id: string;
  message_count: number;
  title?: string;
  updated_at?: string;
  last_prompt?: string;
}

export interface SessionListResult {
  sessions: SessionListEntry[];
}

export interface SessionDeleteParams {
  session_id: string;
}

export type SessionDeleteResult = Record<string, never>;

export interface SessionFileInfo {
  filename: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface SessionFilesListParams {
  session_id: string;
}

export interface SessionFilesListResult {
  files: SessionFileInfo[];
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
