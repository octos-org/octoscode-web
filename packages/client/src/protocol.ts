// Transport-free public protocol surface for render-time consumers.
export type { OctosUiClient } from "./client.ts";
export { OctosUiProtocolError } from "./protocol-error.ts";
export {
  coreProtocolCompatibilityError,
  SUPPORTED_OCTOS_CONTRACT,
} from "./contract.ts";
export {
  CORE_UI_FEATURES,
  CORE_UI_KNOWN_FEATURES,
  CORE_UI_METHODS,
  CORE_UI_NOTIFICATION_METHODS,
  CORE_UI_PROTOCOL,
  CORE_UI_SERVER_METHODS,
} from "./generated/core-contract.ts";
export { isRecord } from "./rpc.ts";
export { APPUI_INVENTORY_METHODS } from "./inventory-methods.ts";
export { APPUI_SKILL_METHODS } from "./skill-methods.ts";
export { APPUI_RESEARCH_METHODS } from "./research-methods.ts";
export {
  APPUI_CONTEXT_METHODS,
  applyContextNotification,
  createContextCommands,
  parseCompactResult,
  parseContextSnapshot,
  parseContextState,
} from "./context.ts";
export type {
  ContextState,
  ContextSnapshot,
  ContextCompaction,
  ContextNormalization,
  CompactResult,
} from "./context.ts";
export type {
  WorkspaceSnapshot,
  SnapshotList,
  SnapshotRestore,
  RollbackResult,
  ForkResult,
  ReviewStartResult,
} from "./history.ts";
export type {
  IncomingFrame,
  RpcFailure,
  RpcNotification,
  RpcRequest,
  RpcSuccess,
} from "./rpc.ts";
export { parseProjectionEnvelope } from "./projection.ts";
export { parseSessionOpenResult } from "./session.ts";
export { parseReplayLossyEvent } from "./replay-events.ts";
export { parseSessionHydrateResult } from "./hydrate.ts";
export {
  isPreviewId,
  parseDiffPreviewGetResult,
  parsePermissionProfileListResult,
  parsePermissionProfileSetResult,
} from "./coding.ts";
export {
  isProtocolUuid,
  parsePlanUpdated,
  parseTaskOutputDelta,
  parseTaskUpdated,
} from "./supervision.ts";
export { parseSessionStatusReadResult } from "./session-status-result.ts";
export {
  parseTaskArtifactListResult,
  parseTaskArtifactReadResult,
  parseTaskCancelResult,
  parseTaskListResult,
  parseTaskOutputReadResult,
} from "./task-results.ts";
export {
  parseConfigCapabilitiesListResult,
  parseLaunchResolveResult,
  parseSessionDeleteResult,
  parseSessionFilesListResult,
  parseSessionListResult,
  parseTokenCostUpdate,
  parseUiProtocolCapabilities,
} from "./workspace.ts";
export {
  APPUI_ONBOARDING_FEATURES,
  APPUI_ONBOARDING_METHODS,
} from "./onboarding-methods.ts";
export {
  parseWorkspaceCreateResult,
  parseWorkspaceListResult,
  supportsWorkspaceBrowse,
  workspaceBrowseRefusal,
  WORKSPACE_BROWSE_MAX_ENTRIES,
  WORKSPACE_CREATE_REFUSAL_KINDS,
  WORKSPACE_FOLDER_NAME_MAX_BYTES,
  WORKSPACE_LIST_REFUSAL_KINDS,
} from "./workspace-browse.ts";
export type {
  WorkspaceBrowseRefusal,
  WorkspaceBrowseRefusalKind,
  WorkspaceCreateParams,
  WorkspaceCreateRefusalKind,
  WorkspaceCreateResult,
  WorkspaceFolderEntry,
  WorkspaceListParams,
  WorkspaceListRefusalKind,
  WorkspaceListResult,
} from "./workspace-browse.ts";
export {
  parseLlmCatalogResult,
  parseLlmFetchModelsResult,
  parseProfileLlmConfigResult,
  parseProfileLlmDeleteResult,
  parseProfileLlmListResult,
  parseProfileLlmSelectResult,
  parseLlmTestResult,
  parseLlmUpsertResult,
  parseLocalProfileCreateResult,
} from "./onboarding.ts";
export {
  approvalDiffPreviewId,
  approvalResolutionId,
  notificationDiffPreviewId,
  parseApprovalRequested,
  parseApprovalRespondResult,
  parseUserQuestionRequested,
  parseUserQuestionRespondResult,
  supportsFeature,
  supportsMethod,
} from "./interaction.ts";
export type {
  ApprovalDecision,
  ApprovalRequested,
  ApprovalRespondParams,
  ApprovalRespondResult,
  ApprovalScope,
  ConnectionStatus,
  ConfigCapabilitiesListResult,
  DiffPreview,
  DiffPreviewFile,
  DiffPreviewGetParams,
  DiffPreviewGetResult,
  DiffPreviewHunk,
  DiffPreviewLine,
  ProjectionEnvelopeV2,
  ProjectionPayload,
  PermissionNetworkPolicy,
  PermissionProfileListParams,
  PermissionProfileListResult,
  PermissionProfileMode,
  PermissionProfileSelection,
  PermissionProfileSetParams,
  PermissionProfileSetResult,
  PermissionProfileUpdate,
  OutputCursor,
  PlanItem,
  PlanItemStatus,
  PlanUpdated,
  SessionStatusReadResult,
  RuntimeHealthStatus,
  SessionCursorStatus,
  SessionDeleteParams,
  SessionDeleteResult,
  SessionFileInfo,
  SessionFilesListParams,
  SessionFilesListResult,
  SessionListEntry,
  SessionListParams,
  SessionListResult,
  SessionUsageStatus,
  TokenCostUpdate,
  TaskArtifactListParams,
  TaskArtifactListResult,
  TaskArtifactReadParams,
  TaskArtifactReadResult,
  TaskArtifactRecord,
  TaskCancelParams,
  TaskCancelResult,
  TaskListEntry,
  TaskListParams,
  TaskListResult,
  TaskOutputReadLimitation,
  TaskOutputDelta,
  TaskOutputReadParams,
  TaskOutputReadResult,
  TaskRuntimeState,
  TaskUpdated,
  ReplayLossyEvent,
  HydratedMessage,
  HydratedTurn,
  LaunchDecisionKind,
  LaunchResolveParams,
  LaunchResolveResult,
  SessionHydrateParams,
  SessionHydrateResult,
  SessionOpened,
  SessionOpenParams,
  SessionOpenResult,
  TurnStartParams,
  UiCursor,
  UiProtocolCapabilities,
  UiProtocolVersion,
  UserQuestion,
  UserQuestionAnswer,
  UserQuestionOption,
  UserQuestionRequested,
  UserQuestionRespondParams,
  UserQuestionRespondResult,
} from "./types.ts";
export type {
  LlmCatalogEndpoint,
  LlmCatalogFamily,
  LlmCatalogModel,
  LlmCatalogResult,
  LlmFetchModelsParams,
  LlmFetchModelsResult,
  LlmModelFetchSelection,
  LlmProvisionParams,
  LlmRouteSelection,
  LlmSelection,
  LlmTestResult,
  LlmUpsertResult,
  ProfileLlmConfigReadParams,
  ProfileLlmConfigResult,
  ProfileLlmConfiguredModel,
  ProfileLlmConfiguredRoute,
  ProfileLlmDeleteParams,
  ProfileLlmDeleteResult,
  ProfileLlmListParams,
  ProfileLlmListResult,
  ProfileLlmModel,
  ProfileLlmSelectParams,
  ProfileLlmSelectResult,
  LocalProfileCreateParams,
  LocalProfileCreateResult,
} from "./onboarding.ts";
export { buildUiProtocolUrl, UI_PROTOCOL_PATH } from "./url.ts";
export type { TurnMedia } from "./media.ts";
