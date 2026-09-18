import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import { type SessionConnectionInput } from "./connection-lifecycle.ts";
import { missingCodingSessionRequirements } from "./coding-capabilities.ts";
import {
  LaunchTransitionCoordinator,
  type LaunchTransitionLease,
} from "./launch-transition.ts";
import { bindWebSessionIdToProfile } from "./session-identity.ts";
import type {
  ActiveSessionAuthority,
  ActiveSessionDiagnostic,
  ActiveSessionRuntimeEvent,
} from "./active-session-runtime.ts";
import type { BackgroundTurnSnapshot } from "./background-turn-manager.ts";
import { foregroundAttentionTurns } from "../attention/model.ts";
import type {
  SessionRecordManager,
  SessionRecord,
} from "./session-record-manager.ts";
import { LazySessionRecordManager } from "./lazy-session-record-manager.ts";
import { SessionPeerCoordinator } from "./session-peer-coordinator.ts";
import {
  backgroundSessionState,
  type BackgroundSessionState,
} from "./background-session-status.ts";
import type { LazyPeerManager } from "../peers/lazy-peer-manager.ts";
import type { PeerRosterEntry } from "../peers/peer-manager.ts";
import type { GatherOutcome } from "../peers/gather.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "./session-scope.ts";
import type { DriverInventoryState } from "./driver-discovery.ts";
import {
  createDriverInventorySnapshot,
  UNAVAILABLE_DRIVER_INVENTORY,
} from "./driver-inventory-snapshot.ts";
import { deriveControlReadiness } from "./control-readiness.ts";
import type { PeerControlSeat } from "../product-controls/SessionControlBar.tsx";
import type { PeerControlPanelState } from "../control/PeerControlPanel.tsx";
import type { SessionControlReadiness } from "./session-record-manager.ts";
import type { DriverInventoryDisclosureBinding } from "./driver-discovery.ts";
import type {
  PeerControlCommand,
  PeerControlFence,
  PeerControlLeaf,
  PeerControlTarget,
} from "../control/peer-control-commands.ts";
import { performPeerControl } from "../control/peer-control-activation.ts";
import {
  buildPeerDispatchParams,
  type PeerDispatchParams,
  type PeerDispatchSeed,
} from "../control/peer-dispatch-commands.ts";
import {
  choosePeerLane,
  peerLaneKeys,
  peerLanePickerState,
  peerLaneSourceAdmitted,
  type PeerLaneChoice,
} from "../control/peer-lane-source.ts";
import {
  buildPeerRowControlTarget,
  peerControllerPanelState,
  peerControllerRosterRows,
  type PeerControllerStagingSubmit,
  type PeerDispatchSinkState,
} from "../control/peer-controller-staging.ts";
import type {
  PeerControllerPanelProps,
  PeerControllerPanelState,
  PeerControllerRosterRow,
  PeerRowControlState,
} from "../control/PeerControllerPanel.tsx";
import {
  ExternalDriverRefusalError,
  type DriverAcquireParams,
  type DriverAcquireView,
  type DriverReleaseParams,
  type DriverRenewParams,
  type ExternalDriverCommands,
  type ExternalDriverRefusalKind,
  type PeerDispatchReceiptView,
} from "@octos-org/octoscode-client/external-driver-meta";
import type { SessionInteractionSnapshot } from "./session-interaction-ledger.ts";
import {
  SessionComposerDrafts,
  type ComposerRestore,
} from "./session-composer-drafts.ts";
import { peerControlRefusalLabel } from "../control/peer-control-commands.ts";
import { EXTERNAL_DRIVER_REFUSAL_KINDS } from "@octos-org/octoscode-client/external-driver-meta";
import {
  HANDING_BACK_CONTROL_STATUS,
  planComposerSeatHandover,
  foreignLeaseBusyCopy,
  RELEASE_FAILED_MESSAGE,
} from "../composer/composer-seat-handover.ts";
import type { AttachmentDraftStore } from "../media/attachment-drafts.ts";
import type { ReasoningEffort } from "../reasoning/model.ts";
import type {
  HistoryBinding,
  HistoryBindingOptions,
} from "../history/history-binding.ts";
import type { NativeReviewBinding } from "../review/native-review.ts";
import type { InspectionBinding } from "../inspection/inspection-binding.ts";
import type { ResumeBinding } from "../resume/resume-binding.ts";
import { admitAgentSpawn } from "../autonomy/agent-spawn-admission.ts";
import {
  LazyBtwController,
  type BtwAdmission,
} from "../btw/lazy-btw-controller.ts";
import { useServerConnection } from "./use-server-connection.ts";
import {
  coreProtocolCompatibilityError,
  APPUI_ONBOARDING_METHODS,
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type OctosUiClient,
  parseTokenCostUpdate,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type ConnectionStatus,
  type LaunchResolveResult,
  type PermissionProfileUpdate,
  type ProfileLlmModel,
  type RpcNotification,
  type SessionOpened,
  type SessionListEntry,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
  type TaskArtifactRecord,
  isProtocolUuid,
} from "@octos-org/octoscode-client/protocol";
import type { ObservedEvent } from "../inspector/EventInspector.tsx";
import {
  useCodingSafety,
  type DiffReviewRuntimeState,
  type PermissionRuntimeState,
} from "../review/use-coding-safety.ts";
import type { TurnRecoveryState } from "../composer/use-turn-controller.ts";
import type { PromptTurnQueueSnapshot } from "../composer/turn-queue.ts";
import type { TimelineEntry } from "../timeline/model.ts";
import type { SessionRecoverySnapshot } from "./durable-session.ts";
import type { SessionRecordRecoveryResult } from "./session-record-manager.ts";
import { type SupervisionRuntimeState } from "../supervision/model.ts";
import { useSupervision } from "../supervision/use-supervision.ts";
import { type WorkspaceProductState } from "../workspace/model.ts";
import { useWorkspaceProduct } from "../workspace/use-workspace-product.ts";
import {
  EMPTY_LAUNCH_RUNTIME,
  type LaunchRuntimeState,
} from "../workspace/launch-model.ts";
import {
  useOnboarding,
  type OnboardingRuntimeState,
  type OnboardingSubmission,
} from "../onboarding/use-onboarding.ts";
import {
  useModelSelection,
  type ModelSelectionRuntimeState,
} from "../models/use-model-selection.ts";
import type { ModelSettingsClient } from "../models/model-settings.ts";

export type {
  DiffReviewRuntimeState,
  PermissionRuntimeState,
} from "../review/use-coding-safety.ts";

const TURN_RECOVERY_NAVIGATION_MESSAGE =
  "Check the current turn status before switching Sessions, or disconnect in Settings.";

export type { SessionConnectionInput } from "./connection-lifecycle.ts";

export interface WorkspaceSessionOpenInput {
  sessionId: string;
  cwd: string;
  profileId?: string;
  resolveLaunch?: boolean;
  requireExactWorkspace?: boolean;
}

export interface PendingWorkspaceNavigation {
  kind: "new-session" | "session";
  cwd: string;
  phase: "starting" | "restoring";
}

/**
 * A persistent background Session's visible state: its own queue is still
 * executable (a terminal event advances its FIFO while another Session is
 * selected) and it may hold an unread terminal/waiting signal.
 */
export interface BackgroundSessionSnapshot {
  sessionId: string;
  profileId: string;
  workspaceRoot: string;
  /** Background work state derived from the record's own live queue. */
  state: BackgroundSessionState;
  activeTurnId: string | null;
  queuedCount: number;
  unread: boolean;
  waiting: boolean;
}

export interface OctosSessionRuntime {
  peers: {
    manager: LazyPeerManager | null;
    error: string | null;
    /**
     * `/peer clear` (TUI parity 2500 §2): prune the ACTIVE record's FINISHED
     * roster rows via the peer coordinator. Returns the number pruned; a foreign
     * or unbound record is a fail-closed 0.
     */
    clearFinished(): number;
    /**
     * P1 (grant 2810 §2): stage ONE peer through `peer/dispatch` on the operator's
     * chosen MODEL LANE (`laneKey` — an advertised sub_provider key, never a
     * literal). The coordinator mints the operationId once and reuses it on
     * retry; an unknown/unread lane refuses typed and sends NO frame.
     */
    dispatch(laneKey: string, brief: string, title: string): void;
    /**
     * P1 (grant 2810 §2): RELEASE the held control seat, parking the binding
     * (`next:"external"`) so the dispatched peer keeps running. No fence held ⇒
     * no frame.
     */
    releaseSeat(): void;
    gather(
      slugs: readonly string[] | undefined,
      canSubmit: () => boolean,
    ): Promise<GatherOutcome>;
    /**
     * Gap 6b approval sink: answer ONE blocked roster row's pending approval.
     * Present ONLY when a control capability is acquired — the dock renders its
     * row actions only when this is threaded, so an unacquired seat offers no
     * action at all (fail-closed). Never throws; a row that cannot form a
     * target sends no frame.
     */
    approvalRespond?:
      | ((entry: PeerRosterEntry, decision: ApprovalDecision) => void)
      | undefined;
  };
  connection: {
    status: ConnectionStatus;
    error: string | null;
    opened: SessionOpened | null;
    recovery: SessionRecoverySnapshot;
    diagnostics: readonly ActiveSessionDiagnostic[];
    capabilities: UiProtocolCapabilities | undefined;
    /**
     * Read-only external-driver disclosure for the SELECTED record, re-gated
     * against the CURRENT authority/capabilities on every read. Never an
     * execution/control channel and never a stale owner after cap loss.
     */
    driverInventory: DriverInventoryState;
    /**
     * The external-master CONTROL seat for the SELECTED record (grant 0840).
     * Null unless the caps admit `peer/control` + `external_driver_v1`, an
     * external binding is observed, a controller lease was ACQUIRED, and a
     * target identity is held. Fail-closed: null ⇒ no seat, no frames.
     */
    peerControl: PeerControlSeat | null;
    /**
     * The peer CONTROLLER console for the SELECTED record (P2b, grant 2855).
     * Null unless the record's control readiness gates the mount. The console
     * OWNS its lane/brief/title staging; this value supplies only the advertised
     * lanes (a DISABLED picker while the read is unadmitted/unread), the seat
     * state, the roster rows and the sinks.
     */
    peerController:
      | (PeerControllerPanelProps & {
          readonly readiness: SessionControlReadiness;
        })
      | null;
    authenticated: boolean;
    restoreRejected: boolean;
    connected: boolean;
    closed: boolean;
    /**
     * Non-fatal recovery notice for Sessions that failed while the live
     * Session survived. Null once dismissed or when nothing failed.
     */
    recoveryNotice: { message: string; failedSessionIds: string[] } | null;
    dismissRecoveryNotice: () => void;
    connect: (input: SessionConnectionInput) => void;
    restore: (input: SessionConnectionInput) => void;
    disconnect: () => void;
  };
  conversation: {
    timeline: TimelineEntry[];
    setTimeline: Dispatch<SetStateAction<TimelineEntry[]>>;
    queue: PromptTurnQueueSnapshot;
    dispatchingTurnId: string | null;
    turnRecovery: TurnRecoveryState | null;
    retryTurnRecovery: () => Promise<void>;
    interruptible: boolean;
    interruptingTurnId: string | null;
    enqueuePrompt: (text: string) => boolean;
    cancelQueuedPrompt: (turnId: string) => boolean;
    btw: LazyBtwController | null;
    askBtw(question: string): BtwAdmission;
    steeringEnabled: boolean;
    setSteeringEnabled(value: boolean | "toggle"): void;
    inputError: string | null;
    reasoningEffort: ReasoningEffort | undefined;
    setReasoningEffort(value: ReasoningEffort | undefined): void;
    showReasoning: boolean;
    setShowReasoning(value: boolean): void;
    attachments: AttachmentDraftStore | null;
    prepareAttachments(): Promise<AttachmentDraftStore | null>;
    /** An interrupted or unsent input for the selected Session. */
    interruptedPrompt: ComposerRestore | null;
    /** Drain it exactly once; null when nothing is pending. */
    takeInterruptedPrompt(): string | null;
    /**
     * §5.2 (brief 4010 clause b): the seat-handover state for the status
     * strip — "Handing back control…" / "Resuming chat…" while a handover is
     * in flight, null otherwise. App (ux-strip-01) renders it; this hook owns
     * the transitions.
     */
    seatHandover: string | null;
    /**
     * §5.2 Resume chat: acquire → release(internal) → confirm → send the
     * parked prompt once. Wired to the strip's "Resume chat" button.
     */
    resumeChatSend(prompt: string): Promise<{
      readonly sent: boolean;
      readonly message: string | null;
      readonly prompt: string | null;
    }>;
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
  models: {
    state: ModelSelectionRuntimeState;
    refresh: () => Promise<void>;
    select: (model: ProfileLlmModel) => Promise<void>;
    management: {
      client: ModelSettingsClient | null;
      profileId: string;
      authorityKey: string;
      capabilities: UiProtocolCapabilities | undefined;
      available: boolean;
    };
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
    transitioning: boolean;
    openingSession: Pick<
      SessionConnectionInput,
      "cwd" | "profileId" | "sessionId"
    > | null;
    /**
     * Always null: selecting a persistent Session record never defers
     * navigation behind another Session's in-flight dispatch.
     */
    pendingNavigation: PendingWorkspaceNavigation | null;
    /** No-op: navigation is never deferred (see pendingNavigation). */
    cancelPendingNavigation: () => void;
    backgroundTurns: readonly BackgroundSessionSnapshot[];
    /**
     * Background (non-selected) records' live and last-terminal turns in the
     * attention tracker's shape; a turn whose outcome recovery could not
     * prove is reported failed.
     */
    attentionTurns: readonly BackgroundTurnSnapshot[];
    onboarding: OnboardingRuntimeState;
    refresh: () => Promise<void>;
    listWorkspaceSessions: (cwd: string) => Promise<SessionListEntry[]>;
    switchSession: (sessionId: string) => Promise<WorkspaceOpenOutcome>;
    openSession: (
      input: WorkspaceSessionOpenInput,
    ) => Promise<WorkspaceOpenOutcome>;
    deleteSession: (sessionId: string) => Promise<void>;
    chooseLaunchProfile: (profileId: string) => Promise<void>;
    cancelLaunch: () => void;
    retryOnboarding: () => Promise<void>;
    submitOnboarding: (submission: OnboardingSubmission) => Promise<void>;
  };
  diagnostics: { events: ObservedEvent[]; omittedEvents: number };
  /**
   * Scoped protocol access for feature modules (Context/Autonomy consume this
   * instead of `models.management.client`). The client is the CURRENT shared
   * transport; `authorityKey` pins the owning transport generation plus the
   * confirmed session/profile identity so async consumers can detect a
   * reconnect before acting.
   */
  protocol: {
    client: OctosUiClient | null;
    authorityKey: string;
    sessionId: string;
    profileId: string;
    isCurrent(): boolean;
    historyBinding(
      applyPrefill?: HistoryBindingOptions["applyPrefill"],
    ): Promise<HistoryBinding>;
    reviewBinding(): Promise<NativeReviewBinding>;
    inspectionBinding(): Promise<InspectionBinding>;
    resumeBinding(): Promise<ResumeBinding>;
    selectResumed(record: SessionRecord<OctosUiClient>): boolean;
    spawnAgents(text: string): boolean;
  };
}

export type WorkspaceOpenOutcome = "opened" | "awaiting_choice" | "failed";

/** Empty FIFO mirror shown before any Session record is selected. */
const EMPTY_QUEUE: PromptTurnQueueSnapshot = {
  active: null,
  pending: [],
};
const EMPTY_INTERACTIONS: SessionInteractionSnapshot = {
  approval: null,
  question: null,
  busy: false,
  error: null,
};
const subscribeNone = () => () => undefined;

// ---------------------------------------------------------------------------
// External-master CONTROL seat (grant 0840)
// ---------------------------------------------------------------------------

/** The CAS input for ONE control acquire, as disclosed by the binding. */
export interface PeerControlAcquireInput {
  readonly driverId: string;
  readonly revision: number;
}

/**
 * Bounded controller lease for a foreground control seat (server-clamped).
 * 120s (grant 2930): long enough that an operator can hold the seat across a
 * dispatch + several controls without a re-acquire, short enough that an
 * abandoned tab hands the seat back promptly.
 */
export const PEER_CONTROL_LEASE_SECONDS = 120;

/**
 * Renewal cadence. MUST sit well INSIDE the lease (contract 2800 §1: the proof
 * is minted once and never re-sent, so a lapsed lease silently loses the seat).
 * 45s puts THREE ticks inside one 120s lease, so a single missed tick — a
 * throttled background tab, one slow round trip — can never let it lapse.
 */
export const PEER_CONTROL_RENEW_INTERVAL_MS = 45_000;

/**
 * The seat's driver identity is STABLE PER BROWSER PROFILE (grant 2930): the
 * server binds the lease to `driver_id`, so a re-acquire from the same browser
 * after a reload/release must present the SAME id or it would look like a
 * foreign driver fighting for the seat. It is a LOCAL identifier only — never a
 * proof, never a token, never sent anywhere but as the acquire/renew driver id.
 */
export const PEER_DRIVER_ID_PREFIX = "octoscode-web:";
export const PEER_DRIVER_ID_STORAGE_KEY = "octoscode-web.driver-id";

/** The narrow storage surface the stable id needs (a `Storage`, or a stub). */
export interface PeerDriverIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The persisted driver id, or null when nothing valid is stored. A malformed
 * value (hand-edited, or written by an older build) is NOT reused — it would
 * fail the Core's identity validation and permanently wedge the seat.
 */
function readStoredPeerDriverId(
  storage: PeerDriverIdStorage | null,
): string | null {
  if (storage === null) return null;
  let stored: string | null;
  try {
    stored = storage.getItem(PEER_DRIVER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
  if (stored === null || !stored.startsWith(PEER_DRIVER_ID_PREFIX)) return null;
  const uuid = stored.slice(PEER_DRIVER_ID_PREFIX.length);
  return isProtocolUuid(uuid) ? stored : null;
}

/**
 * `octoscode-web:<uuid>` — minted ONCE per browser profile and persisted, so
 * every later acquire from this browser presents the same driver id. Fails OPEN:
 * unavailable/blocked storage (private mode, disabled cookies) still yields a
 * usable id for THIS session rather than blocking the seat entirely.
 */
export function stablePeerDriverId(
  storage: PeerDriverIdStorage | null,
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  const stored = readStoredPeerDriverId(storage);
  if (stored !== null) return stored;
  const minted = `${PEER_DRIVER_ID_PREFIX}${randomUuid()}`;
  try {
    storage?.setItem(PEER_DRIVER_ID_STORAGE_KEY, minted);
  } catch {
    // Persisting is best-effort; the minted id still works for this Session.
  }
  return minted;
}

/** The browser's own storage, or null when unavailable/blocked (never throws). */
function peerDriverIdStorage(): PeerDriverIdStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** CAS params for `session/driver/acquire` from the observed disclosure. */
export function peerControlAcquireParams(
  input: PeerControlAcquireInput,
): DriverAcquireParams {
  return {
    driverId: input.driverId,
    expectedRevision: input.revision,
    leaseSeconds: PEER_CONTROL_LEASE_SECONDS,
  };
}

/**
 * CAS input for ONE acquire, from the browser's STABLE driver id plus the
 * OBSERVED revision (grant 2930). The driver id is OURS — a cold Core reports
 * mode `internal` with no binding at all, so sourcing it from the disclosure
 * (the pre-P2e rule) left a cold session with no acquire, ever. The revision is
 * the disclosure's: the observed binding's public CAS revision, or 0 when the
 * session is unbound. Anything short of a KNOWN inventory (or an empty driver
 * id) is NULL — fail-closed, no acquire is attempted at all.
 */
export function peerControlAcquireInput(input: {
  readonly driverId: string;
  readonly driverInventory: DriverInventoryState;
}): PeerControlAcquireInput | null {
  if (input.driverId === "") return null;
  const { driverInventory } = input;
  if (driverInventory.kind !== "complete") return null;
  const { disclosure } = driverInventory;
  const revision = disclosure.binding?.revision ?? 0;
  if (!Number.isSafeInteger(revision)) return null;
  return { driverId: input.driverId, revision };
}

/**
 * Plan ONE `session/driver/renew` against the caller-held fence: the proof
 * (`reveal()` — its single read) plus the same bounded lease. No fence held ⇒
 * NULL ⇒ no frame at all.
 */
export function peerControlRenewParams(
  acquire: DriverAcquireView | null,
): DriverRenewParams | null {
  if (acquire === null) return null;
  return {
    driverId: acquire.capability.driverId,
    epoch: acquire.capability.epoch,
    controlToken: acquire.capability.reveal(),
    leaseSeconds: PEER_CONTROL_LEASE_SECONDS,
  };
}

/**
 * Is THIS control outcome the Core's typed `driver_fence_stale`? The lease was
 * revoked (a second tab acquired, or it expired), so the held proof is dead: the
 * caller must DROP the seat — never retry with the same fence — and show the
 * bounded label, after which the console re-offers Acquire. Any other refusal
 * keeps the seat (its fence is still live).
 */
export function peerControlFenceStaleIn(state: PeerControlPanelState): boolean {
  return state.kind === "refused" && state.refusalKind === "driver_fence_stale";
}

/**
 * Builds the caller-held target identity for ONE acquire's pending work: the
 * target is the operation the acquired binding reports as PENDING (dispatching
 * holds none; a fresh acquire has exactly one), the turn is the SELECTED
 * record's live turn — REQUIRED to be a protocol UUID, since the receipt echoes
 * it back and the client re-validates it — and the idempotency key is minted
 * per call by the caller. A missing pending operation or a non-UUID turn
 * yields NULL: targetless control is never dispatched.
 */
export function peerControlTargetFor(input: {
  readonly acquire: DriverAcquireView | null;
  readonly turnId: string | null;
  readonly newOperationId: () => string;
}): PeerControlTarget | null {
  if (input.acquire === null || input.turnId === null) return null;
  if (!isProtocolUuid(input.turnId)) return null;
  const targetOperationId = input.acquire.pendingWork[0];
  if (targetOperationId === undefined || targetOperationId === "") return null;
  return {
    controlOperationId: input.newOperationId(),
    targetOperationId,
    expectedTurnId: input.turnId,
  };
}

/** The roster facts one approval row action needs; absent ids fail closed. */
export interface PeerApprovalSeed {
  readonly operationId?: string | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly turnId: string;
}

export interface PeerApprovalActivation {
  readonly target: PeerControlTarget;
  readonly command: PeerControlCommand;
}

/**
 * Build the target + command for ONE roster approval answer (web gap 6). Unlike
 * `peerControlTargetFor` — which reads the ACQUIRED binding — this reads the
 * ROW: `targetOperationId` is the accepted dispatch id the manager retained
 * (`PeerRosterEntry.operationId`, plan 0940's GAP now closed) and
 * `expectedTurnId` is the row's live turn. Every required id is validated;
 * a missing/blank one is NULL, so the caller disables the action rather than
 * minting a frame the encoder would reject offline.
 */
export function buildPeerApprovalActivation(input: {
  readonly entry: PeerApprovalSeed;
  readonly decision: ApprovalDecision;
  readonly newOperationId: () => string;
}): PeerApprovalActivation | null {
  const { operationId, requestId, turnId } = input.entry;
  if (typeof operationId !== "string" || operationId === "") return null;
  if (typeof requestId !== "string" || requestId === "") return null;
  if (!isProtocolUuid(turnId)) return null;
  return {
    target: {
      controlOperationId: input.newOperationId(),
      targetOperationId: operationId,
      expectedTurnId: turnId,
    },
    command: {
      kind: "approval_respond",
      approvalId: requestId,
      decision: input.decision,
    },
  };
}

/**
 * Answer ONE roster approval through the seat: exactly ONE `peer/control`
 * frame, or NULL (no frame at all) when the seat has no leaf or the row cannot
 * form a target — the fail-closed half of the contract. The refusal state is
 * the SAME bounded presentation state the control panel uses, so the caller
 * can render the typed kind without a try/catch.
 */
export async function performPeerApproval(input: {
  readonly leaf: PeerControlLeaf | null;
  readonly acquire: DriverAcquireView;
  readonly entry: PeerApprovalSeed;
  readonly decision: ApprovalDecision;
  readonly newOperationId: () => string;
}): Promise<PeerControlPanelState | null> {
  const activation = buildPeerApprovalActivation(input);
  if (activation === null || input.leaf === null) return null;
  return performPeerControl({
    leaf: input.leaf,
    fence: peerControlFenceFor(input.acquire),
    target: activation.target,
    command: activation.command,
  });
}

export interface PeerControlSeatSources {
  readonly capabilities: UiProtocolCapabilities | undefined;
  readonly driverInventory: DriverInventoryState;
  readonly acquire: DriverAcquireView | null;
  readonly commands: ExternalDriverCommands | null;
  readonly target: PeerControlTarget | null;
  /** Caller-owned presentation state; absent ⇒ the inert `idle` seat. */
  readonly state?: PeerControlPanelState | undefined;
  readonly onSend?: ((command: PeerControlCommand) => void) | undefined;
}

/**
 * ONE fenced controller acquire. Resolves the decoded view ONLY while
 * `isCurrent()` still holds after the await AND the reply's capability belongs
 * to the SAME driver we asked for; every other outcome (caps withdrawn, stale
 * authority, protocol refusal) resolves NULL. The seat is fail-closed, so a
 * failed acquire is "no seat", never a stale or foreign fence.
 */
export async function acquirePeerControlFence(input: {
  readonly commands: Pick<ExternalDriverCommands, "driverAcquire">;
  readonly acquire: PeerControlAcquireInput;
  isCurrent(): boolean;
}): Promise<DriverAcquireView | null> {
  if (!input.isCurrent()) return null;
  try {
    const view = await input.commands.driverAcquire(
      peerControlAcquireParams(input.acquire),
    );
    if (!input.isCurrent()) return null;
    return view.capability.driverId === input.acquire.driverId ? view : null;
  } catch {
    return null;
  }
}

/**
 * Build the caller-held fence from ONE acquired capability. Single source: the
 * seat derivation and the activation sink must present the SAME fence, or the
 * seat would disclose one token while dispatching another.
 */
export function peerControlFenceFor(
  acquire: DriverAcquireView,
): PeerControlFence {
  return {
    driverId: acquire.capability.driverId,
    epoch: acquire.capability.epoch,
    controlToken: acquire.capability.reveal(),
  };
}

// ---------------------------------------------------------------------------
// P1: peer/dispatch SUPPLIER (grant 2810 §2)
// ---------------------------------------------------------------------------

/**
 * The typed refusal kinds the dispatch SUPPLIER can raise locally, both
 * byte-equal to the Core's own (contract §1): an unknown/unread lane refuses
 * BEFORE any staging (`driver_model_unavailable`), and a missing control fence
 * refuses as `driver_fence_stale` — the same kind a revoked lease returns.
 */
export type PeerDispatchRefusalKind =
  "driver_model_unavailable" | "driver_fence_stale";

/** The supplier's per-frame decision: exactly ONE way to reach the wire. */
export type PeerDispatchPlan =
  | { readonly kind: "dispatch"; readonly params: PeerDispatchParams }
  | { readonly kind: "refused"; readonly refusalKind: PeerDispatchRefusalKind };

/**
 * Plan EXACTLY ONE `peer/dispatch` frame (pure; no I/O, no frame). The lane is
 * admitted ONLY by exact membership of the profile's advertised keys — never a
 * literal, never a fallback — and a missing fence refuses typed. A refused plan
 * carries NO params, so the caller sends nothing at all.
 */
export function planPeerDispatch(input: {
  readonly acquire: DriverAcquireView | null;
  readonly laneKeys: readonly string[] | null;
  readonly laneKey: string;
  readonly operationId: string;
  readonly seed: PeerDispatchSeed;
}): PeerDispatchPlan {
  if (input.acquire === null)
    return { kind: "refused", refusalKind: "driver_fence_stale" };
  const choice: PeerLaneChoice = choosePeerLane(input.laneKeys, input.laneKey);
  if (choice.kind === "refused")
    return { kind: "refused", refusalKind: choice.refusalKind };
  return {
    kind: "dispatch",
    params: buildPeerDispatchParams(
      peerControlFenceFor(input.acquire),
      input.operationId,
      input.seed,
      choice.laneKey,
    ),
  };
}

/** The receipt facts ONE adoption installs; ids come from the SERVER receipt. */
export interface PeerAdoptReceipt {
  readonly adoptedSessionId: string;
  readonly adoptedTurnId: string;
  readonly scope: SessionRuntimeScope;
}

/**
 * The `recordManager.adoptOnRecord` seam (contract line: the adopt half is
 * landed IN PARALLEL by the record-manager owner). Until it lands, this is NULL
 * and the caller FAILS CLOSED — it must never fabricate a record for a
 * server-adopted identity. Wiring is by name, so the real method binds the
 * moment it appears, with no second edit here.
 */
export interface PeerAdoptRecordManager<Record> {
  adoptOnRecord?(input: PeerAdoptReceipt): Promise<Record>;
}

/**
 * Resolve the adoption seam by NAME off any record-manager facade. `manager` is
 * typed `object` on purpose: the method does not exist yet, so narrowing the
 * parameter to its future shape would make every present-day call site fail to
 * typecheck. When `adoptOnRecord` lands, this binds the real method with no
 * second edit — and until then it is NULL, never a fabricated record.
 */
export function peerAdoptSeam<Record = unknown>(
  manager: object,
): ((input: PeerAdoptReceipt) => Promise<Record>) | null {
  const adopt = (manager as PeerAdoptRecordManager<Record>).adoptOnRecord;
  if (typeof adopt !== "function") return null;
  return (input) => adopt.call(manager, input);
}

/**
 * Resolve the adopt seam for ONE master record through the LAZY facade the hook
 * actually holds. `peerAdoptSeam` reads `adoptOnRecord` BY NAME, and that method
 * lands on the inner ENGINE (`SessionRecordManager:594`) — the facade exposes
 * only the bridge `engineFor(record)`, so handing it the facade itself resolves
 * NULL. P2j (grant 3120, run-13 triage 3110): the null seam made
 * `performPeerDispatch` settle `unknown` BEFORE it ever reached
 * `commands.peerDispatch`, so an enabled console sent ZERO frames and surfaced
 * only the generic "could not be confirmed" copy.
 *
 * P2L (grant 3220 §2): the bridge must ENSURE the lazy engine, not merely probe
 * it. In the LIVE flow (connect -> start workspace -> acquire -> dispatch, with
 * no prior `/peer` staging) the engine is still UNLOADED at click time, so
 * `engineFor` answered null and the seam failed closed on a perfectly valid
 * dispatch. This now awaits `ensureEngineFor` when the facade offers it, so a
 * merely-unloaded engine LOADS and the seam resolves; NULL survives ONLY for a
 * record the facade genuinely no longer retains — a truly FOREIGN record, which
 * must still never be adopted (never fabricate a record).
 */
export async function peerAdoptSeamForRecord<Record = unknown, Scope = unknown>(
  manager: {
    engineFor(record: Scope): object | null;
    ensureEngineFor?(record: Scope): Promise<object | null>;
  },
  record: Scope,
): Promise<((input: PeerAdoptReceipt) => Promise<Record>) | null> {
  const engine =
    typeof manager.ensureEngineFor === "function"
      ? await manager.ensureEngineFor(record)
      : manager.engineFor(record);
  return engine === null ? null : peerAdoptSeam<Record>(engine);
}

/**
 * Plan ONE `session/driver/release`: park the seat with the caller-held fence,
 * the binding's public CAS revision and `next:"external"` (the peer keeps
 * running; the next owner takes over only via an explicit acquire). No fence
 * held ⇒ NULL ⇒ no frame at all.
 */
export function planPeerSeatRelease(
  acquire: DriverAcquireView | null,
): DriverReleaseParams | null {
  if (acquire === null) return null;
  return {
    driverId: acquire.capability.driverId,
    epoch: acquire.capability.epoch,
    controlToken: acquire.capability.reveal(),
    expectedRevision: acquire.binding.revision,
    next: "external",
  };
}

/** The bounded outcome of ONE supplier dispatch; raw server copy never escapes. */
export type PeerDispatchOutcome<Record> =
  | {
      readonly kind: "accepted";
      readonly receipt: PeerDispatchReceiptView;
      readonly record: Record;
    }
  | {
      readonly kind: "refused";
      readonly refusalKind: ExternalDriverRefusalKind;
    }
  | { readonly kind: "unknown" };

/**
 * Run EXACTLY ONE `peer/dispatch` staging: plan the frame (pure, fail-closed),
 * send it through the caller-held leaf, then install the SERVER-adopted identity
 * through the caller's adopt seam. Never throws: a typed refusal keeps its kind
 * and anything else settles `unknown`, so the caller renders bounded copy.
 *
 * The adopt seam is checked BEFORE the frame: a server-adopted identity with no
 * way to install a record would stage a peer nothing can observe, so nothing is
 * sent at all (fail closed; never a fabricated record).
 */
export async function performPeerDispatch<Record>(input: {
  readonly commands: Pick<ExternalDriverCommands, "peerDispatch"> | null;
  readonly acquire: DriverAcquireView | null;
  readonly laneKeys: readonly string[] | null;
  readonly laneKey: string;
  readonly operationId: string;
  readonly seed: PeerDispatchSeed;
  readonly adopt: ((receipt: PeerAdoptReceipt) => Promise<Record>) | null;
  readonly scope: (
    adoptedSessionId: string,
    workspaceRoot: string,
  ) => SessionRuntimeScope;
}): Promise<PeerDispatchOutcome<Record>> {
  const plan = planPeerDispatch({
    acquire: input.acquire,
    laneKeys: input.laneKeys,
    laneKey: input.laneKey,
    operationId: input.operationId,
    seed: input.seed,
  });
  if (plan.kind === "refused")
    return { kind: "refused", refusalKind: plan.refusalKind };
  if (input.commands === null)
    return { kind: "refused", refusalKind: "driver_fence_stale" };
  if (input.adopt === null) return { kind: "unknown" };
  try {
    const receipt = await input.commands.peerDispatch(plan.params);
    const record = await input.adopt({
      adoptedSessionId: receipt.adoptedSessionId,
      adoptedTurnId: receipt.adoptedTurnId,
      scope: input.scope(receipt.adoptedSessionId, receipt.workspaceRoot),
    });
    return { kind: "accepted", receipt, record };
  } catch (error) {
    if (error instanceof ExternalDriverRefusalError)
      return { kind: "refused", refusalKind: error.refusalKind };
    return { kind: "unknown" };
  }
}

/**
 * The minimal staging surface the console's dispatch sink needs. Structural on
 * purpose: `LazyPeerManager.kickoff` already answers `Promise<… | null>`, so the
 * sink must read a `null` settle as an outcome rather than a void.
 */
export interface PeerStagingSinkManager {
  kickoff(params: {
    readonly brief: string;
    readonly title?: string;
  }): Promise<unknown>;
  /**
   * P2N (grant 3320 §3): the manager's OWN bounded local-validation error, or
   * null. The sink reads it ONLY to name the branch honestly: a `null` settle is
   * the same VALUE for two DIFFERENT causes — the lazy manager's `#load`/
   * `#current` mismatch, and the shared prepare encoder refusing the staged
   * values BEFORE any frame. Run 2850g reported the mismatch reason for a LOCAL
   * rejection, so the instrument pointed the hunt at a record-identity bug that
   * did not exist. Optional: a manager that cannot answer keeps the older
   * (mismatch) reading rather than inventing a branch.
   *
   * P2o (grant 3410): the SAME snapshot also carries the roster rows. A
   * confirmed start stamps the receipt's OWN adopted `slug` + `operationId` onto
   * the row (peer-manager.ts:672-698), so the sink reads them here to key the
   * console's accepted row — without them an acceptance renders as silence.
   */
  getSnapshot?():
    | {
        readonly prepareError?: string | null;
        readonly peers?: readonly {
          readonly slug?: string;
          readonly status?: string;
          readonly operationId?: string | null;
        }[];
      }
    | undefined;
}

/**
 * P2g (grant 3030): the console's ONE NEVER-SILENT staged-dispatch sink. Run-12
 * triage (evidence native-deepseek-web-pc-p3e-run12-triage-3010) found a ready,
 * seat-held console with an admitted lane dispatching ZERO frames and surfacing
 * NOTHING: the sink returned early on a null manager and `void`-swallowed a
 * `null` settle. Fail-closed means VISIBLE, so this settles a typed outcome the
 * panel renders for EVERY path — exactly one kickoff, or a bounded
 * refusal/`unknown`. The lane is recorded FIRST (the coordinator's supplier
 * reads it at call time), mirroring the seat's own ordering.
 *
 * Raw server copy never escapes: a typed `ExternalDriverRefusalError` keeps its
 * allowlisted kind, anything else degrades to `unknown`.
 */
export async function performStagedDispatch(input: {
  readonly manager: PeerStagingSinkManager | null;
  readonly laneKey: string;
  readonly brief: string;
  readonly title: string;
  readonly selectLane: (laneKey: string) => void;
}): Promise<PeerDispatchSinkState> {
  // No manager ⇒ the console cannot reach a supplier at all. That is an
  // operator-visible `unknown`, never a silent early return.
  if (input.manager === null) return { kind: "unknown", reason: "no-manager" };
  input.selectLane(input.laneKey);
  // P2N (grant 3320 §3): the protocol's `title` is OPTIONAL, but the shared
  // prepare encoder REJECTS a present-but-blank one (`buildPeerPrepareParams`
  // peer-prepare.ts:14). The console's gate admits a blank Title (only the brief
  // is required), so the live flow offered an enabled Dispatch whose click the
  // encoder then refused BEFORE any frame — run 2850g's zero-frame
  // `kickoff-mismatch`. An empty staged Title means NOT PRESENT: omit it, so the
  // gate and the encoder agree on exactly the same admission.
  const title = input.title.trim() === "" ? undefined : input.title;
  try {
    const staged = await input.manager.kickoff({
      brief: input.brief,
      ...(title === undefined ? {} : { title }),
    });
    if (staged !== null) {
      // P2o (grant 3410): a CONFIRMED staging is an ACCEPTED outcome and must
      // carry the identity the console renders. On the console's OWN path the
      // manager stamps the receipt's OWN adopted slug + accepted operationId
      // onto the row (peer-manager.ts:672-698, the `#openByDispatch` arm); read
      // them back HERE rather than returning a bare `dispatched`, which folded
      // into `idle` and made run 2850h's real acceptance indistinguishable from
      // silence. The operationId is the discriminator: only a `peer/dispatch`
      // acceptance stamps one, so the legacy `session/open` arm (which reports
      // `{status:"started"}` with no id) keeps the plain identity-less settle.
      // Raw server copy never rides this carrier — only the two bounded facts.
      const row = input.manager
        .getSnapshot?.()
        ?.peers?.find((peer) => peer.status === "started");
      const slug = row?.slug;
      const operationId = row?.operationId ?? undefined;
      return {
        kind: "dispatched",
        ...(typeof operationId === "string" &&
        operationId !== "" &&
        typeof slug === "string" &&
        slug !== ""
          ? { slug, operationId }
          : {}),
      };
    }
    // A `null` settle is NOT confirmed — but the same VALUE has TWO causes and
    // they are NOT interchangeable. The lazy manager's local prepare encoder
    // refuses INVALID STAGED VALUES first (and publishes its own bounded
    // `prepareError`), while `#load`/`#current` answers a bare null with no
    // error at all. Reading them as one reason made run 2850g name the
    // authority-mismatch branch for what was in fact a local rejection; the
    // hunt then chased a record-identity bug that did not exist.
    const locallyRefused =
      (input.manager.getSnapshot?.()?.prepareError ?? null) !== null;
    return locallyRefused
      ? { kind: "unknown", reason: "invalid-staging" }
      : { kind: "unknown", reason: "kickoff-mismatch" };
  } catch (error) {
    if (error instanceof ExternalDriverRefusalError)
      return { kind: "refused", refusalKind: error.refusalKind };
    return { kind: "unknown", reason: "leaf-refused" };
  }
}

/**
 * Fail-closed derivation of ONE record's control seat. `ready` requires the SAME
 * pair `deriveControlReadiness` demands (peer/control + external_driver_v1 AND an
 * observed external binding) PLUS an acquired capability and a caller-held
 * target. The proof is passed through `reveal()` — never minted here, never
 * rendered — and every missing input yields NULL (no seat ⇒ no frames).
 */
export function derivePeerControlSeat(
  sources: PeerControlSeatSources,
): PeerControlSeat | null {
  const { capabilities, driverInventory, acquire, commands, target } = sources;
  if (acquire === null || commands === null || target === null) return null;
  if (deriveControlReadiness({ capabilities, driverInventory }) !== "ready")
    return null;
  return {
    readiness: "ready",
    capabilities,
    leaf: commands,
    fence: peerControlFenceFor(acquire),
    target,
    state: sources.state ?? { kind: "idle" },
    ...(sources.onSend ? { onSend: sources.onSend } : {}),
  };
}

/** ONE held control seat: the acquire's decoded view, its leaf, and the
 * per-action target identity when a live turn + pending work can carry one. A
 * COLD acquire (P2i, grant 3050) has NEITHER — the Core omits `pending_work`
 * for an empty vector — so `target` is NULL and the seat is STILL held; the
 * target is required at the per-action site, never to hold the lease. */
export interface PeerControlHeld {
  readonly view: DriverAcquireView;
  readonly commands: ExternalDriverCommands;
  readonly target: PeerControlTarget | null;
}

/**
 * Hold ONE seat from a decoded acquire (P2i, grant 3050). The ONLY requirement
 * is a valid acquire result plus the leaf it was built from: a cold master
 * session has no live turn and no pending work, and demanding either discarded
 * the valid decode and left the seat unheld forever. The target is derived here
 * when the caller CAN carry one and is otherwise NULL — a targetless seat is
 * held, but can dispatch nothing until an action site supplies its own target.
 */
export function peerControlSeatFromAcquire(input: {
  readonly view: DriverAcquireView | null;
  readonly commands: ExternalDriverCommands | null;
  readonly turnId: string | null;
  readonly newOperationId: () => string;
}): PeerControlHeld | null {
  if (input.view === null || input.commands === null) return null;
  return {
    view: input.view,
    commands: input.commands,
    target: peerControlTargetFor({
      acquire: input.view,
      turnId: input.turnId,
      newOperationId: input.newOperationId,
    }),
  };
}

/**
 * The binding the console BADGES (P2i, grant 3050). The HELD acquire's own
 * binding wins — it is the lease WE just acquired, so a cold Core (whose
 * observed `session/driver/get` discloses `internal` with no binding) still
 * renders the real driver/epoch/revision. Only with no seat held does this fall
 * back to the OBSERVED disclosure; with neither, NULL (never a fabrication).
 */
export function peerControlBindingFor(input: {
  readonly seat: PeerControlHeld | null;
  readonly driverInventory: DriverInventoryState;
}): DriverInventoryDisclosureBinding | null {
  if (input.seat !== null) {
    const binding = input.seat.view.binding;
    return {
      driverId: binding.driverId,
      epoch: binding.epoch,
      revision: binding.revision,
      leaseExpiresAtMs: binding.leaseExpiresAtMs,
    };
  }
  return input.driverInventory.kind === "complete"
    ? input.driverInventory.disclosure.binding
    : null;
}

/** The caller-supplied facts ONE peer CONTROLLER console is derived from. */
export interface PeerControllerConsoleSources {
  readonly readiness: SessionControlReadiness;
  readonly capabilities: UiProtocolCapabilities | undefined;
  /** The advertised lane keys, or null while the read is unadmitted/unread. */
  readonly laneKeys: readonly string[] | null;
  readonly seatHeld: boolean;
  readonly binding: DriverInventoryDisclosureBinding | null;
  readonly roster: readonly PeerControllerRosterRow[];
  readonly state: PeerControllerPanelState;
  readonly onDispatch?: PeerControllerStagingSubmitSink | undefined;
  readonly onReleaseSeat?: (() => void) | undefined;
  readonly onRowAction?: PeerControllerRowActionSink | undefined;
  /** P3 (grant 3120 §b): the operator parked the seat; it STAYS released. */
  readonly seatReleased?: boolean | undefined;
  /** Explicit re-acquire sink, offered only while the seat is latched. */
  readonly onAcquireSeat?: (() => void) | undefined;
}

/** The console's ONE staging sink: the operator's own typed/chosen values. */
export type PeerControllerStagingSubmitSink = (
  submit: PeerControllerStagingSubmit,
) => void;

export type PeerControllerRowActionSink = (
  row: PeerControllerRosterRow,
  command: PeerControlCommand,
) => void;

/**
 * Fail-closed derivation of the peer CONTROLLER console (P2b, grant 2855). The
 * console OWNS its staging inputs, so this derivation supplies NO lane/brief/
 * title — only the advertised lanes, the seat state, the roster and the sinks.
 *
 * The lane picker is DISABLED whenever the lane source is unadmitted/unread
 * (null), so an unread profile can never present a fabricated option. Every
 * other fact is passed through verbatim; nothing is minted here.
 */
export function derivePeerControllerConsole(
  sources: PeerControllerConsoleSources,
): (PeerControllerPanelProps & { readiness: SessionControlReadiness }) | null {
  // An unread/unadmitted lane source (null) leaves the picker DISABLED: no key,
  // no fallback. The console still mounts — the operator may hold a seat and
  // read the binding — but it can dispatch nothing.
  const laneKeys = sources.laneKeys;
  return {
    readiness: sources.readiness,
    capabilities: sources.capabilities,
    lanePicker: peerLanePickerState(laneKeys !== null, laneKeys ?? []),
    seatHeld: sources.seatHeld,
    binding: sources.binding,
    roster: sources.roster,
    state: sources.state,
    ...(sources.seatReleased ? { seatReleased: true } : {}),
    ...(sources.onDispatch ? { onDispatch: sources.onDispatch } : {}),
    ...(sources.onReleaseSeat ? { onReleaseSeat: sources.onReleaseSeat } : {}),
    ...(sources.onAcquireSeat ? { onAcquireSeat: sources.onAcquireSeat } : {}),
    ...(sources.onRowAction ? { onRowAction: sources.onRowAction } : {}),
  };
}

function noopCancelPendingNavigation(): void {}

export function useOctosSession(): OctosSessionRuntime {
  const runtimeEventSinkRef = useRef<
    (event: ActiveSessionRuntimeEvent<OctosUiClient>) => void
  >(() => undefined);
  const serverConnection = useServerConnection({
    loadClientFactory: async () => {
      const { OctosUiClient } =
        await import("@octos-org/octoscode-client/transport");
      return (config) =>
        new OctosUiClient({
          endpoint: config.endpoint,
          token: config.token,
        });
    },
    validateServerCapabilities: assertCompatibleProtocol,
    validateSessionCapabilities: (capabilities) => {
      assertCompatibleProtocol(capabilities);
      assertCodingSessionContract(capabilities);
    },
    isFatalSessionError: (reason) =>
      isFatalSessionContractError(errorMessage(reason)),
    onEvent: (event) => runtimeEventSinkRef.current(event),
  });
  const activeRuntime = serverConnection.runtime;
  const eventId = useRef(0);
  const candidateAbortRef = useRef<AbortController | null>(null);
  const recoveryAbortRef = useRef<AbortController | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<{
    message: string;
    failedSessionIds: string[];
  } | null>(null);
  // The ownership authority: one persistent record per Session scope (managed
  // runtime + its own live queue + executable controller). Switching selects a
  // record; the previous record keeps running in the background. The pool
  // (useServerConnection's runtime) owns the single physical socket.
  const recordManagerRef =
    useRef<LazySessionRecordManager<OctosUiClient> | null>(null);
  const btwControllersRef = useRef(
    new Map<SessionRecord<OctosUiClient>, LazyBtwController>(),
  );
  const [, setBtwRevision] = useState(0);
  // Stable AUTHENTICATED-scope epoch: bumped ONLY when the endpoint or auth
  // identity changes, NOT on a transport reconnect. Records keep this epoch so
  // an ordinary socket reconnect never invalidates their recovery.
  const authEpochRef = useRef(0);
  const launchTransitionRef = useRef(
    new LaunchTransitionCoordinator<
      SessionConnectionInput,
      LaunchResolveResult
    >(),
  );
  const pendingRestoreConfigRef = useRef<SessionConnectionInput | null>(null);
  const [restoreRejected, setRestoreRejected] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [backgroundTurns, setBackgroundTurns] = useState<
    readonly BackgroundSessionSnapshot[]
  >([]);
  const [attentionTurns, setAttentionTurns] = useState<
    readonly BackgroundTurnSnapshot[]
  >([]);
  const [eventLog, setEventLog] = useState<{
    events: ObservedEvent[];
    omitted: number;
  }>({ events: [], omitted: 0 });
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  // The POOL is the single physical socket (useServerConnection's runtime).
  // The SELECTED record supplies the product identity (Session id + workspace).
  // Before any Session is opened the pool's own authority is the fallback.
  const selectedRecord = () => recordManagerRef.current?.selected() ?? null;
  const currentAuthority = () => {
    const record = selectedRecord();
    return record
      ? record.runtime.currentAuthority()
      : activeRuntime.currentAuthority();
  };
  const currentClient = () => activeRuntime.currentAuthority()?.client ?? null;
  const currentSessionId = () =>
    selectedRecord()?.scope.sessionId ?? currentAuthority()?.sessionId ?? "";
  const currentCapabilities = () => currentAuthority()?.capabilities;

  // Lazily built once. The record manager owns every Session record; the pool
  // (useServerConnection's runtime) owns the one physical socket it shares.
  if (!recordManagerRef.current) {
    recordManagerRef.current = new LazySessionRecordManager<OctosUiClient>({
      pooledClient: () => activeRuntime.currentAuthority()?.client ?? null,
      authorityEpoch: () => authEpochRef.current,
      onSelectedEvent: (event) => runtimeEventSinkRef.current(event),
      onSelectedSnapshot: () => publishBackgroundTurns(),
      onBackgroundActivity: () => publishBackgroundTurns(),
      onRecordNotification: (record, authority, notification) => {
        if (
          recordManagerRef.current?.get(record.scope) !== record ||
          record.closed ||
          (notification.method !== CORE_UI_METHODS.PEER_STAGED &&
            notification.method !== CORE_UI_METHODS.PEER_CLOSED)
        )
          return;
        // First-open replay was buffered before the confirmed record existed.
        // Re-admit it through this record's installed authority, never a guessed
        // master scope. Normal pooled duplicates are deduped by the peer owner.
        const peers = peerCoordinatorRef.current;
        peers?.bind(record);
        peers?.notificationObserver(authority.client)(notification);
      },
      cursorFor: (scope) =>
        recordManagerRef.current?.get(scope)?.runtime.getSnapshot().recovery
          .cursor,
      validateServerCapabilities: assertCompatibleProtocol,
      validateSessionCapabilities: (capabilities) => {
        assertCompatibleProtocol(capabilities);
        assertCodingSessionContract(capabilities);
      },
      isFatalSessionError: (reason) =>
        isFatalSessionContractError(errorMessage(reason)),
      controllerDependencies: (scope, recordClient) => ({
        steer: async (request) => {
          const record = recordManagerRef.current?.get(scope);
          const authority = record?.runtime.currentAuthority();
          const epoch = authEpochRef.current;
          const current = () =>
            Boolean(
              record &&
              authority &&
              authEpochRef.current === epoch &&
              recordManagerRef.current?.get(scope) === record &&
              !record.closed &&
              record.runtime.isCurrent(authority) &&
              record.runtime.currentAuthority()?.capabilities ===
                authority.capabilities &&
              authority.sessionId === scope.sessionId &&
              authority.profileId === scope.profileId &&
              authority.cwd === scope.workspaceRoot &&
              authority.config.endpoint === scope.endpoint &&
              authority.client === request.client &&
              activeRuntime.currentAuthority()?.client === request.client &&
              request.isCurrent(),
            );
          if (!authority?.capabilities || !current())
            throw new Error("Steering authority changed before dispatch.");
          const commands = await authority.client.steerCommands(
            scope.sessionId,
            authority.capabilities,
          );
          if (!current())
            throw new Error("Steering authority changed before dispatch.");
          request.markSent();
          return commands.steer(request.expectedTurnId, request.text);
        },
        startReview: async (request) => {
          const record = recordManagerRef.current?.get(scope);
          const authority = record?.runtime.currentAuthority();
          const current = () =>
            Boolean(
              record &&
              authority &&
              recordManagerRef.current?.get(scope) === record &&
              record.runtime.isCurrent(authority) &&
              record.runtime.currentAuthority()?.capabilities ===
                authority.capabilities &&
              authority.sessionId === scope.sessionId &&
              authority.profileId === scope.profileId &&
              authority.cwd === scope.workspaceRoot &&
              authority.config.endpoint === scope.endpoint &&
              authority.client === request.client &&
              request.isCurrent(),
            );
          if (!authority?.capabilities || !current())
            throw new Error("Native review authority changed before dispatch.");
          const commands = await authority.client.historyCommands(
            scope.sessionId,
            authority.capabilities,
          );
          if (!current())
            throw new Error("Native review authority changed before dispatch.");
          request.markSent();
          return commands.startReview(request.turnId, request.prompt);
        },
        client: () => recordClient(),
        sessionId: () => scope.sessionId,
        // §5.2 (brief 4010 clause b): the composer's handover gate. Only the
        // record whose seat THIS tab actually holds crosses the driver seam;
        // every other record sends directly (no seat ⇒ no frame).
        releaseSeatBeforeTurn: () => releaseControlSeatForUserTurn(scope),
        // §6 kept-column: park a gate-refused prompt back on the OWNING record.
        onTurnNotSentRestore: (turn) => {
          const owner = recordManagerRef.current?.get(scope);
          if (owner) composerDraftsRef.current?.restoreUnsentTurn(owner, turn);
        },
        // Gate on the RECORD's own runtime snapshot, never the pool's: the pool
        // only authenticates (idle) while the record owns opened/healthy.
        canEnqueue: () => {
          const snapshot = recordManagerRef.current
            ?.get(scope)
            ?.runtime.getSnapshot();
          if (!snapshot || snapshot.session === null) return false;
          return (
            snapshot.status === "connected" &&
            snapshot.recovery.phase === "healthy" &&
            supportsMethod(
              snapshot.session.capabilities,
              CORE_UI_METHODS.TURN_START,
            )
          );
        },
        canStart: () => {
          const snapshot = recordManagerRef.current
            ?.get(scope)
            ?.runtime.getSnapshot();
          if (!snapshot || snapshot.session === null) return false;
          // recovery.phase becomes healthy in commitHydrate BEFORE the runtime
          // is ready, and a managed socket close keeps projection healthy — so
          // dispatch authority requires BOTH runtime ready AND a live socket.
          return (
            snapshot.phase === "ready" &&
            snapshot.status === "connected" &&
            supportsMethod(
              snapshot.session.capabilities,
              CORE_UI_METHODS.TURN_START,
            )
          );
        },
        canInterrupt: () => {
          const record = recordManagerRef.current?.get(scope);
          return supportsMethod(
            record?.runtime.getSnapshot().session?.capabilities,
            CORE_UI_METHODS.TURN_INTERRUPT,
          );
        },
        canGetTurnState: () => {
          const capabilities = recordManagerRef.current
            ?.get(scope)
            ?.runtime.getSnapshot().session?.capabilities;
          return (
            supportsMethod(capabilities, CORE_UI_METHODS.TURN_STATE_GET) &&
            supportsFeature(capabilities, CORE_UI_FEATURES.TURN_STATE_GET_V1)
          );
        },
        // A lifecycle lookup proved the turn terminal: settle the record's own
        // pending approvals/questions for it, as a terminal notification would.
        onRecoveredTerminal: (turnId) => {
          const record = recordManagerRef.current?.get(scope);
          record?.interactions.settleTurn(record.scope, turnId);
        },
        setConnectionError: (message) =>
          recordManagerRef.current?.get(scope)?.runtime.reportError(message),
        // Gap 9: the controller reports an interrupted turn's stashed prompt
        // back when ITS terminal lands. Park it on the OWNING record (resolved
        // by session id, not by current selection) for the composer to pick up.
        onInterruptPromptRestore: (prompt) => {
          const owner = recordManagerRef.current?.get(scope);
          if (owner)
            composerDraftsRef.current?.restoreInterruptPrompt(owner, prompt);
        },
      }),
    });
  }
  const recordManager = recordManagerRef.current;
  useEffect(() => {
    const prune = () => {
      let changed = false;
      for (const [record, controller] of btwControllersRef.current) {
        if (record.closed || recordManager.get(record.scope) !== record) {
          controller.dispose();
          btwControllersRef.current.delete(record);
          changed = true;
        }
      }
      if (changed) setBtwRevision((revision) => revision + 1);
    };
    const unsubscribe = recordManager.subscribe(prune);
    return () => {
      unsubscribe();
      for (const controller of btwControllersRef.current.values())
        controller.dispose();
      btwControllersRef.current.clear();
    };
  }, [recordManager]);
  const [, setDraftRevision] = useState(0);
  const composerDraftsRef = useRef<SessionComposerDrafts | null>(null);
  if (!composerDraftsRef.current)
    composerDraftsRef.current = new SessionComposerDrafts({
      isRetained: (record) => recordManager.get(record.scope) === record,
      changed: () => setDraftRevision((revision) => revision + 1),
    });
  const composerDrafts = composerDraftsRef.current;
  const [, setPeerRevision] = useState(0);
  // P1 (grant 2810 §2): the held control fence, mirrored into a ref so the
  // coordinator's `dispatchPeer` supplier reads the CURRENT acquire at call
  // time (never a stale closure capture). Null ⇒ the supplier refuses typed and
  // sends no frame.
  const controlAcquireRef = useRef<PeerControlHeld | null>(null);
  // The advertised lane keys for the ACTIVE profile (null = not read yet) and
  // the operator's chosen lane. Both are refs: the supplier is constructed once
  // and must observe the latest values.
  const peerLaneKeysRef = useRef<string[] | null>(null);
  const peerLaneChoiceRef = useRef<string>("");
  // P2b (grant 2855): the lane keys MIRRORED into state for presentation. The
  // ref above is what the one-shot supplier reads at call time; this state is
  // what re-renders the console's controlled picker when the read lands.
  const [peerLaneKeysState, setPeerLaneKeysState] = useState<string[] | null>(
    null,
  );
  // P2g (grant 3030): the console's OWN staged-dispatch SINK outcome. Run-12
  // triage found a ready console dispatching nothing and surfacing nothing, so
  // this carriers the typed sink result (a null manager / load mismatch /
  // kind-less rejection) into the panel axis — never silence.
  const [stagedDispatchState, setStagedDispatchState] =
    useState<PeerDispatchSinkState | null>(null);
  // P2p (task 3530 §1b): the ADOPTED native turn per row slug, recorded from the
  // `peer/dispatch` receipt. Root's P4C wire capture (evidence
  // native-glm-web-pc-p4c-row-wire-3530) caught the row's control addressing the
  // MASTER session's turn (`b86a3059-…`) while the Core expects the peer's
  // adopted turn (`01a09a29-…`), so the control landed on the wrong turn.
  const adoptedTurnsRef = useRef<
    Map<string, { sessionId: string; turnId: string }>
  >(new Map());
  // P2p (task 3530 §1c): the LAST control outcome per row slug, so an accepted
  // (or refused) row Steer/Interrupt renders ON its own row. The capture found
  // NEITHER rendered, which made a landed control indistinguishable from silence.
  const [rowControl, setRowControl] = useState<
    Record<string, PeerRowControlState>
  >({});
  const peerCoordinatorRef = useRef<SessionPeerCoordinator<
    OctosUiClient,
    SessionRecord<OctosUiClient>
  > | null>(null);
  if (!peerCoordinatorRef.current)
    peerCoordinatorRef.current = new SessionPeerCoordinator({
      isRetained: (record) =>
        recordManager.get(record.scope) === record && !record.closed,
      subscribeRecords: recordManager.subscribe,
      openPeer: async (request, client) => {
        const master = recordManager
          .records()
          .find((record) => record === request.scope.authority);
        const authority = master?.runtime.currentAuthority();
        if (!request.isCurrent() || !authority || authority.client !== client)
          throw new Error("Peer master authority changed.");
        // Native full identity and workspace, using the master's live transport.
        // Opening a background peer NEVER selects it or changes the composer.
        return recordManager.openOnRecord(
          {
            ...authority.config,
            sessionId: request.sessionId,
            profileId: request.profileId,
            cwd: request.cwd,
          },
          client,
          request.signal,
          request.isCurrent,
        );
      },
      closePeer: (record) => {
        if (recordManager.get(record.scope) !== record) return;
        peerCoordinatorRef.current?.retire(record);
        composerDrafts.retire(record);
        if (record.selected) recordManager.closeRetainedRecord(record);
        else recordManager.evict(record.scope);
        publishBackgroundTurns();
      },
      // P1 (grant 2810 §2): the ONE `peer/dispatch` supplier. The coordinator
      // owns mint-once/reuse of `operationId`; this reads the CURRENT held fence
      // and the operator's lane at call time, plans the single frame (fail-closed
      // on an unknown lane / missing fence) and installs the SERVER-adopted
      // identity through `recordManager.adoptOnRecord`. Until that lands the seam
      // is NULL, so nothing is staged — never a fabricated record.
      dispatchPeer: async (request, operationId, client) => {
        const master = recordManager
          .records()
          .find((record) => record === request.scope.authority);
        const authority = master?.runtime.currentAuthority();
        if (!request.isCurrent() || !master || authority?.client !== client)
          throw new Error("Peer master authority changed.");
        const acquired = controlAcquireRef.current;
        // P2L (grant 3220 §2): the adopt seam now ENSURES the lazy engine, so it
        // is awaited ONCE before the frame is planned. A merely-unloaded engine
        // loads here; only a genuinely foreign record still yields null and
        // fails closed (never a fabricated record).
        const adopt = await peerAdoptSeamForRecord<
          SessionRecord<OctosUiClient>,
          SessionRecord<OctosUiClient>
        >(recordManager, master);
        const outcome = await performPeerDispatch<SessionRecord<OctosUiClient>>(
          {
            commands: acquired?.commands ?? null,
            acquire: acquired?.view ?? null,
            laneKeys: peerLaneKeysRef.current,
            laneKey: peerLaneChoiceRef.current,
            operationId,
            seed: {
              brief: request.brief,
              slug: request.slug,
              prompt: request.prompt,
            },
            adopt,
            scope: (adoptedSessionId, workspaceRoot) => ({
              endpoint: master.scope.endpoint,
              workspaceRoot: workspaceRoot || master.scope.workspaceRoot,
              profileId: request.profileId,
              sessionId: adoptedSessionId,
              authorityEpoch: master.scope.authorityEpoch,
            }),
          },
        );
        if (outcome.kind === "refused")
          throw new ExternalDriverRefusalError(
            "peer/dispatch",
            outcome.refusalKind,
          );
        if (outcome.kind === "unknown")
          throw new Error("Peer dispatch could not be confirmed.");
        // P2p (task 3530 §1b): record the receipt's ADOPTED turn per row slug.
        // Root's P4C capture caught the row's control addressing the MASTER
        // session's turn while the Core expects the peer's adopted turn, so the
        // command landed on the wrong turn. This ref is the row's turn source.
        adoptedTurnsRef.current.set(outcome.receipt.slug, {
          sessionId: outcome.receipt.adoptedSessionId,
          turnId: outcome.receipt.adoptedTurnId,
        });
        return {
          record: outcome.record,
          operationId: outcome.receipt.operationId,
          adoptedSessionId: outcome.receipt.adoptedSessionId,
          adoptedTurnId: outcome.receipt.adoptedTurnId,
          // The receipt's OWN adopted slug is authoritative for the row (b).
          slug: outcome.receipt.slug,
          duplicate: outcome.receipt.duplicate,
        };
      },
    });
  const peerCoordinator = peerCoordinatorRef.current;
  useEffect(() => {
    const unsubscribePeers = peerCoordinator.subscribe(() =>
      setPeerRevision((revision) => revision + 1),
    );
    let source: OctosUiClient | null = null;
    let unsubscribeFrames = () => {};
    const bindRecords = () => {
      for (const record of recordManager.records())
        peerCoordinator.bind(record);
    };
    const syncTransport = () => {
      const authority = activeRuntime.currentAuthority();
      const client =
        authority?.client.status === "connected" ? authority.client : null;
      if (client === source) return;
      unsubscribeFrames();
      source = client;
      peerCoordinator.setTransport(client);
      if (client) {
        const observer = peerCoordinator.notificationObserver(client);
        unsubscribeFrames = client.subscribeNotifications((notification) => {
          observer(notification);
        });
        bindRecords();
      } else {
        unsubscribeFrames = () => {};
        composerDrafts.suspendTransfers();
        recordManager.suspendRecords();
      }
    };
    const unsubscribePool = activeRuntime.subscribe(syncTransport);
    const unsubscribeRecords = recordManager.subscribe(bindRecords);
    syncTransport();
    return () => {
      unsubscribeFrames();
      unsubscribePool();
      unsubscribeRecords();
      unsubscribePeers();
      peerCoordinator.clear();
    };
  }, [activeRuntime, recordManager, peerCoordinator, composerDrafts]);
  // P1: the ACTIVE UI reads the SELECTED RECORD's runtime snapshot (opened /
  // healthy / capabilities), never the pool's — the pool only authenticates
  // (its session projection stays null). Subscribe to the selected record's
  // runtime; the subscription target changes when the selection changes.
  // Capture the rendered owner. Interaction callbacks and draft edits must not
  // look up a newly selected Session after the user's original click.
  const viewRecord = recordManager.selected();
  const viewAuthority = viewRecord?.runtime.currentAuthority();
  const viewEpoch = authEpochRef.current;
  const viewDraft = viewRecord ? composerDrafts.get(viewRecord) : null;
  const selectedRuntime = viewRecord?.runtime ?? null;
  const selectedSnapshot = useSyncExternalStore(
    selectedRuntime ? selectedRuntime.subscribe : subscribeNone,
    () => selectedRuntime?.getSnapshot() ?? null,
    () => null,
  );
  const connectionSnapshot = selectedSnapshot ?? serverConnection.snapshot;
  const interactionLedger = viewRecord?.interactions ?? null;
  const interactionSnapshot = useSyncExternalStore(
    interactionLedger?.subscribe ?? subscribeNone,
    interactionLedger?.getSnapshot ?? (() => EMPTY_INTERACTIONS),
    () => EMPTY_INTERACTIONS,
  );
  // Read-only driver disclosure for the SELECTED record. The manager is the
  // only writer of a record's inventory; this getter re-gates the CURRENT
  // authority/caps on every read and never trusts a stale `complete`.
  const driverInventorySnapshot = useSyncExternalStore(
    recordManager.subscribe,
    createDriverInventorySnapshot({
      viewRecord,
      viewAuthority,
      viewEpoch,
      manager: recordManager,
      currentAuthorityEpoch: () => authEpochRef.current,
      pooledClient: () => activeRuntime.currentAuthority()?.client ?? null,
    }),
    () => UNAVAILABLE_DRIVER_INVENTORY,
  );
  // External-master CONTROL seat (grant 1030). SessionControlBar's own contract
  // is that `leaf`/`fence`/`target` are CALLER-held — this hook is that caller,
  // and routes the seat through the SAME readiness pair the bar gates on.
  //
  // The fence is minted by ONE fenced acquire against the OBSERVED external
  // binding. `authority.client` is the concrete `OctosUiClient`, whose
  // `externalDriverCommands` returns the FULL command factory — the
  // `ExternalDriverReadCommands` narrowing is on the `ActiveSessionClient`
  // INTERFACE only — so `driverAcquire`, the ONLY source of `controlToken`
  // (external-driver.ts:711), is reachable here WITHOUT widening any shared
  // type. Everything is fail-closed: no admission, no observed binding, no
  // acquire, or no target ⇒ a NULL seat ⇒ no panel and no frames.
  const controlCapabilities = viewAuthority?.capabilities;
  // The seat's driver identity is OURS and STABLE PER BROWSER PROFILE (2930):
  // a cold Core reports `internal` with no binding, so there is nothing to
  // source an id from. Minted once, persisted, and re-read on every render so a
  // re-acquire after release/reload presents the SAME driver id.
  const controlDriverId = stablePeerDriverId(peerDriverIdStorage());
  const controlAcquireInput =
    deriveControlReadiness({
      capabilities: controlCapabilities,
      driverInventory: driverInventorySnapshot,
    }) === "ready"
      ? peerControlAcquireInput({
          driverId: controlDriverId,
          driverInventory: driverInventorySnapshot,
        })
      : null;
  const controlRevision = controlAcquireInput?.revision ?? null;
  const controlGeneration = viewAuthority?.generation ?? null;
  // The controlled turn is the SELECTED record's live turn; a turn that starts
  // later re-runs the acquire so the target identity tracks it.
  const controlTurnId =
    viewRecord?.controller.queueSnapshot().active?.turnId ?? null;
  const [controlAcquire, setControlAcquire] = useState<PeerControlHeld | null>(
    null,
  );
  // The Session RECORD a seat is CURRENTLY held under. The acquire effect uses
  // it to tell "our own walk reported the lease we just took" (never
  // re-acquire — the Core bumps the revision on acquire, so re-acquiring on it
  // would loop) apart from "a different Session is selected now" (drop and
  // re-acquire). Keyed on the RECORD, not the authority: a same-generation
  // capability swap REPLACES the frozen authority object but does not end the
  // lease we hold, and dropping a live lease there would be a regression.
  const controlHoldRef = useRef<{
    readonly record: SessionRecord<OctosUiClient>;
    readonly driverId: string;
  } | null>(null);
  // P3 (grant 3120 §b): the RELEASE LATCH. An operator Release parks the binding
  // (`next:"external"`) and must STAY released: the post-release inventory walk
  // (P2i) re-fires the acquire effect, and with the hold refs cleared it took a
  // NEW lease — so Release silently re-acquired and was a visible no-op (run-13
  // :535 trace: release -> walk -> re-acquire -> walk). This ref records the
  // RECORD whose seat the operator parked; while it names the current record the
  // acquire effect refuses to run. A record switch clears it (the new Session
  // re-acquires normally) and ONLY an explicit `Acquire seat` clears it for the
  // SAME record. The mirrored state re-renders the console's re-offer.
  const controlReleasedRef = useRef<SessionRecord<OctosUiClient> | null>(null);
  const [controlSeatReleased, setControlSeatReleased] = useState(false);
  // P2q (grant 3800 §1, root hunk): the seat is OPT-IN. Only the record the
  // operator explicitly asked to drive (Acquire seat) is ever acquired; every
  // other record renders the console released, so a plain chat session never
  // trips ExternalMasterHeld on its own composer.
  const controlOptInRef = useRef<SessionRecord<OctosUiClient> | null>(null);
  // Bumped ONLY by the explicit `Acquire seat`: the acquire effect's inputs are
  // otherwise unchanged after a release (same record, same observed revision),
  // so this is the dep that re-runs it once the latch is cleared.
  const [controlAcquireEpoch, setControlAcquireEpoch] = useState(0);

  // P2i (grant 3050 §2): re-walk THIS record's driver inventory so the OBSERVED
  // disclosure catches up with the lease we just took or parked. Routed through
  // the ENGINE: `recordManager` is the Lazy facade, which exposes
  // `refreshDriverInventory` only on the real record manager. Best-effort — the
  // manager owns admission and latest-wins, and an unadmitted/stale record
  // resolves without touching the wire.
  const refreshControlInventory = () => {
    if (viewRecord === null) return;
    const engine = recordManager.engineFor(viewRecord);
    if (engine === null) return;
    void engine.refreshDriverInventory(viewRecord.scope).catch(() => undefined);
  };

  useEffect(() => {
    const record = viewRecord;
    const authority = record?.runtime.currentAuthority() ?? null;
    const client = authority?.client ?? null;
    const sessionId = authority?.sessionId ?? null;
    const profileId = authority?.profileId ?? null;
    const capabilities = authority?.capabilities ?? null;
    if (
      record === null ||
      authority === null ||
      controlDriverId === "" ||
      client === null ||
      sessionId === null ||
      profileId === null ||
      capabilities === null
    ) {
      controlHoldRef.current = null;
      setControlAcquire(null);
      return;
    }
    // P2q (grant 3800 §1, root hunk): no automatic acquire. Until the operator
    // presses Acquire seat for THIS record, behave exactly like a parked seat.
    if (controlOptInRef.current !== record) {
      controlReleasedRef.current = record;
      setControlSeatReleased(true);
      controlHoldRef.current = null;
      setControlAcquire(null);
      return;
    }
    // P3 (grant 3120 §b): the RELEASE LATCH, checked BEFORE any acquire. While
    // the latch names THIS record the operator has parked the seat on purpose,
    // so this effect refuses to take a new lease — the post-release inventory
    // walk re-fires it (loading -> ready) and MUST NOT silently re-acquire. A
    // DIFFERENT record clears the latch: selecting another Session acquires
    // normally. Only an explicit `Acquire seat` clears it for the same record.
    if (
      controlReleasedRef.current !== null &&
      controlReleasedRef.current !== record
    ) {
      controlReleasedRef.current = null;
      setControlSeatReleased(false);
    }
    if (controlReleasedRef.current === record) {
      controlHoldRef.current = null;
      setControlAcquire(null);
      return;
    }
    if (
      controlHoldRef.current !== null &&
      controlHoldRef.current.record !== record
    ) {
      // A DIFFERENT Session is selected: the held lease belongs to the old one.
      controlHoldRef.current = null;
      setControlAcquire(null);
    }
    const held = controlAcquireRef.current;
    if (
      held !== null &&
      controlHoldRef.current !== null &&
      controlHoldRef.current.driverId === controlDriverId
    ) {
      // We already own the lease for THIS Session: only the target identity
      // can go stale (a turn that started later). Never a second acquire.
      const tracked = peerControlTargetFor({
        acquire: held.view,
        turnId: controlTurnId,
        newOperationId: () => crypto.randomUUID(),
      });
      if (
        tracked !== null &&
        tracked.controlOperationId !== held.target?.controlOperationId
      )
        setControlAcquire({ ...held, target: tracked });
      return;
    }
    if (controlRevision === null) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && activeRuntime.isCurrent(authority);
    void (async () => {
      let commands: ExternalDriverCommands;
      try {
        commands = await client.externalDriverCommands(
          sessionId,
          profileId,
          capabilities,
        );
      } catch {
        if (!cancelled) setControlAcquire(null);
        return;
      }
      const view = await acquirePeerControlFence({
        commands,
        acquire: { driverId: controlDriverId, revision: controlRevision },
        isCurrent,
      });
      if (!isCurrent()) return;
      // P2i (grant 3050 §1): a VALID acquire HOLDS the seat on its own. A cold
      // master session carries neither a live turn nor pending work, and the
      // old rule demanded both — so the valid decode was discarded and the
      // console never enabled Dispatch/Release. Only "no acquire result" or
      // "no leaf" is a no-seat outcome now.
      const seat = peerControlSeatFromAcquire({
        view,
        commands,
        turnId: controlTurnId,
        newOperationId: () => crypto.randomUUID(),
      });
      if (seat === null) {
        controlHoldRef.current = null;
        setControlAcquire(null);
        return;
      }
      controlHoldRef.current = { record, driverId: controlDriverId };
      setControlAcquire(seat);
      refreshControlInventory();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    controlDriverId,
    controlRevision,
    controlGeneration,
    controlTurnId,
    // P3 (grant 3120 §b): the explicit re-acquire signal. Cleared latch + a new
    // epoch is the ONLY way this effect runs again for the SAME record.
    controlAcquireEpoch,
    viewRecord,
    activeRuntime,
  ]);

  // Caller-owned presentation state for the ONE activation sink below. A new
  // acquire (new turn / new fence / new target) invalidates any receipt or
  // refusal describing the PREVIOUS operation, so a stale outcome never
  // outlives the operation it names. While `sending` the panel disables its own
  // buttons, so a double submit cannot reach the leaf — the leaf itself has no
  // dedupe (the target's stable `controlOperationId` is the replay key).
  const [controlState, setControlState] = useState<PeerControlPanelState>({
    kind: "idle",
  });
  const controlTargetId = controlAcquire?.target?.controlOperationId ?? null;
  useEffect(() => {
    // P2e: a stale fence DROPS the seat, which clears the target id — but the
    // bounded refusal label is the ONLY operator-visible signal for that drop
    // and must survive it (the console then re-offers Acquire). Every other
    // target change still invalidates the previous operation's outcome.
    setControlState((current) =>
      controlTargetId === null && peerControlFenceStaleIn(current)
        ? current
        : { kind: "idle" },
    );
  }, [controlTargetId]);

  // P1 (grant 2810 §2): mirror the held fence into the ref the `dispatchPeer`
  // supplier reads. The supplier is constructed ONCE, so it must observe the
  // CURRENT acquire rather than a stale closure capture; a cleared acquire makes
  // the supplier refuse typed and send no frame.
  useEffect(() => {
    controlAcquireRef.current = controlAcquire;
  }, [controlAcquire]);

  // P1 (grant 2810 §1): read the profile's REAL lane keys for the peer picker.
  // Admitted ONLY when the authority advertises `profile/sub_providers/list`; an
  // unadmitted/unread/empty result leaves the ref NULL, so `choosePeerLane`
  // refuses every candidate rather than falling back to a literal lane.
  useEffect(() => {
    const authority = viewRecord?.runtime.currentAuthority() ?? null;
    const client = authority?.client ?? null;
    const profileId = authority?.profileId ?? null;
    const capabilities = authority?.capabilities ?? null;
    if (client === null || profileId === null || capabilities === null) {
      peerLaneKeysRef.current = null;
      setPeerLaneKeysState(null);
      return;
    }
    if (!peerLaneSourceAdmitted(capabilities, profileId)) {
      peerLaneKeysRef.current = null;
      setPeerLaneKeysState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const commands = await client.researchCommands(profileId, capabilities);
        const lanes = await commands.list();
        if (cancelled || !activeRuntime.isCurrent(authority!)) return;
        peerLaneKeysRef.current = peerLaneKeys(lanes.lanes);
        // P2b: mirror the advertised set into state so the console's CONTROLLED
        // picker re-renders with the real keys (the ref alone cannot).
        setPeerLaneKeysState(peerLaneKeysRef.current);
        // Drop an operator choice that the profile no longer advertises, so a
        // stale pick can never survive a lane-set change as an implicit default.
        if (!peerLaneKeysRef.current.includes(peerLaneChoiceRef.current))
          peerLaneChoiceRef.current = "";
      } catch {
        if (!cancelled) {
          peerLaneKeysRef.current = null;
          setPeerLaneKeysState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewRecord, activeRuntime]);

  // P2e (grant 2930): drop the held seat WITHOUT a frame. A stale fence means
  // the proof is dead (a second tab acquired, or the lease lapsed), so the
  // local acquire is cleared and the console re-offers Acquire; a bounded
  // refusal state is left behind so the label survives the drop.
  const dropControlSeat = () => {
    controlAcquireRef.current = null;
    controlHoldRef.current = null;
    setControlAcquire(null);
  };

  // P3 (grant 3120 §b): park the seat AND LATCH it. Clears the hold (so the
  // supplier refuses typed) and records the RECORD the operator released, which
  // is what the acquire effect checks before taking a new lease.
  const parkControlSeat = (record: SessionRecord<OctosUiClient> | null) => {
    controlAcquireRef.current = null;
    controlHoldRef.current = null;
    controlReleasedRef.current = record;
    setControlSeatReleased(record !== null);
    setControlAcquire(null);
  };

  // Settle ONE control outcome. A typed `driver_fence_stale` from ANY op must
  // never leave a dead fence mounted: drop the seat and show the bounded label.
  const settleControlState = (state: PeerControlPanelState) => {
    setControlState(state);
    if (peerControlFenceStaleIn(state)) dropControlSeat();
  };

  const controlSend = (command: PeerControlCommand) => {
    const acquired = controlAcquire;
    // P2i (grant 3050 §1): the target moved to the PER-ACTION site. A held seat
    // with no target (a cold acquire carried no pending work / live turn) has
    // nothing to address, so no frame is sent — but the seat itself stays held.
    if (acquired === null || acquired.target === null) return;
    setControlState({ kind: "sending", command: command.kind });
    void performPeerControl({
      leaf: acquired.commands,
      fence: peerControlFenceFor(acquired.view),
      target: acquired.target,
      command,
    }).then(settleControlState);
  };

  // P1 (grant 2810 §2): RELEASE the held control seat. Parks the binding with
  // `next:"external"` (the dispatched peer keeps running) and clears the local
  // acquire, so the supplier immediately refuses typed until a new acquire.
  // No fence held ⇒ no frame at all. Shared by the console and `peers.releaseSeat`.
  const releaseControlSeat = () => {
    const acquired = controlAcquireRef.current;
    const params = planPeerSeatRelease(acquired?.view ?? null);
    if (acquired === null || params === null) return;
    // The latch names the RECORD whose seat we park, captured BEFORE the frame:
    // the acquire effect compares it to the CURRENT record and refuses while it
    // matches, so the post-release walk below cannot re-take the lease.
    const record = controlHoldRef.current?.record ?? viewRecord ?? null;
    void acquired.commands.driverRelease(params).finally(() => {
      parkControlSeat(record);
      // P2i (grant 3050 §2): the parked lease is now the SERVER's truth, so
      // re-walk the inventory and let the badge follow the observation.
      refreshControlInventory();
    });
  };

  // P3 (grant 3120 §b): the ONE explicit re-acquire. An operator who parked the
  // seat gets an "Acquire seat" affordance; this clears the latch for THIS
  // record and bumps the acquire epoch so the effect (whose other deps are
  // unchanged after a release) runs again and takes a fresh lease.
  const acquireControlSeat = () => {
    controlOptInRef.current = viewRecord;
    controlReleasedRef.current = null;
    setControlSeatReleased(false);
    setControlAcquireEpoch((epoch) => epoch + 1);
  };

  // Queued background turns use their owning record, never the selected UI.
  // A confirmed handback must precede the turn/start frame.
  const releaseControlSeatForUserTurn = async (
    scope: SessionRuntimeScope,
  ): Promise<
    { readonly sent: true } | { readonly sent: false; readonly message: string }
  > => {
    const record = recordManagerRef.current?.get(scope);
    if (!record || record.closed)
      return { sent: false, message: RELEASE_FAILED_MESSAGE };
    const inventory = record.driverInventory;
    const acquired = controlAcquireRef.current;
    const holdRecord = controlHoldRef.current?.record ?? null;
    const thisTabHoldsSeat =
      acquired !== null &&
      holdRecord !== null &&
      holdRecord === record &&
      acquired.view.capability.driverId === controlDriverId;
    const disclosure =
      inventory.kind === "complete" ? inventory.disclosure : null;
    const foreignLease =
      disclosure?.mode === "external" &&
      disclosure.binding !== null &&
      disclosure.binding.driverId !== controlDriverId &&
      disclosure.binding.leaseExpiresAtMs > Date.now()
        ? disclosure.binding.leaseExpiresAtMs
        : null;
    // §5.2/20 "lost acquire reply": a LIVE lease under OUR OWN driver id
    // while we hold NO proof. Nothing may be sent with the unproven binding;
    // the operator waits for the disclosed expiry, then a fresh acquire.
    const ownUnprovenLease =
      disclosure?.mode === "external" &&
      disclosure.binding !== null &&
      disclosure.binding.driverId === controlDriverId &&
      disclosure.binding.leaseExpiresAtMs > Date.now()
        ? disclosure.binding.leaseExpiresAtMs
        : null;
    const plan = planComposerSeatHandover({
      seatHeld: thisTabHoldsSeat,
      thisTabHoldsSeat,
      acquireView: thisTabHoldsSeat ? acquired!.view : null,
      observedRevision:
        inventory.kind === "complete" && disclosure?.mode === "external"
          ? inventory.observedRevision
          : null,
      observedForeignLeaseExpiresAtMs: foreignLease,
      observedOwnLeaseExpiresAtMs: ownUnprovenLease,
    });
    switch (plan.kind) {
      case "send":
        return { sent: true };
      case "release-then-send": {
        const params = plan.releaseParams;
        // §5.2 case 2: the strip shows "Handing back control…" during the
        // wait; cleared on every exit of this branch.
        setSeatHandoverStatus(HANDING_BACK_CONTROL_STATUS);
        try {
          await acquired!.commands.driverRelease(params);
        } catch (reason) {
          // 20b/20c: a timeout may mean the release LANDED. Reconcile from
          // the OBSERVED disclosure — never infer success from a kept id.
          const observed = await reconcileReleaseForUserTurn(record);
          if (observed === "internal") {
            if (controlHoldRef.current?.record === record)
              parkControlSeat(record);
            return { sent: true };
          }
          return {
            sent: false,
            message: releaseRefusalMessage(reason, RELEASE_FAILED_MESSAGE),
          };
        } finally {
          setSeatHandoverStatus(null);
        }
        if (controlHoldRef.current?.record === record) parkControlSeat(record);
        await recordManager.engineFor(record)?.refreshDriverInventory(scope);
        return { sent: true };
      }
      case "wait-for-expiry":
        return {
          sent: false,
          message:
            "Couldn't confirm — waiting for the previous attempt to expire",
        };
      case "resume-chat":
        // Acceptance 4: a live foreign lease keeps the human message and
        // names the disclosed expiry (Resume chat itself will be refused
        // busy by the acquire until that lease ends).
        if (foreignLease !== null) {
          return {
            sent: false,
            message: `turn admission refused for this session: ExternalMasterHeld (${foreignLeaseBusyCopy(foreignLease)})`,
          };
        }
        // The operator has NOT pressed Resume chat; a plain send stays refused.
        return {
          sent: false,
          message:
            "turn admission refused for this session: ExternalMasterHeld",
        };
    }
  };

  // A lost release reply can be resolved by the owning record's disclosure.
  const reconcileReleaseForUserTurn = async (
    record: SessionRecord<OctosUiClient>,
  ): Promise<"internal" | "ours" | "foreign"> => {
    const engine = recordManager.engineFor(record);
    if (engine === null) return "foreign";
    let state: Awaited<ReturnType<typeof engine.refreshDriverInventory>>;
    try {
      state = await engine.refreshDriverInventory(record.scope);
    } catch {
      return "foreign";
    }
    if (state.kind !== "complete") return "foreign";
    if (state.disclosure.mode === "internal") return "internal";
    return state.disclosure.binding?.driverId === controlDriverId
      ? "ours"
      : "foreign";
  };

  // Bounded §6 copy for a release refusal: a typed refusal keeps its label;
  // anything else degrades to the row-8 message (never raw error text).
  const releaseRefusalMessage = (reason: unknown, fallback: string): string => {
    if (
      reason instanceof ExternalDriverRefusalError &&
      (EXTERNAL_DRIVER_REFUSAL_KINDS as readonly string[]).includes(
        reason.refusalKind,
      )
    )
      return peerControlRefusalLabel(reason.refusalKind);
    return fallback;
  };

  // §5.2 Resume chat (brief 4010 clause b): the ONE operator-initiated path
  // from a foreign/parked holder back to chat. Sequence is FIXED by the design:
  // acquire (CAS on the OBSERVED revision) → release(`next:"internal"`) →
  // confirm the release result → the caller sends the parked prompt ONCE.
  // Nothing is sent on any refused step; the strip shows "Resuming chat…"
  // while it runs (the carrier is this seam's public `status`).
  const [seatHandoverStatus, setSeatHandoverStatus] = useState<string | null>(
    null,
  );
  const resumeChatSend = async (
    prompt: string,
  ): Promise<{
    readonly sent: boolean;
    readonly message: string | null;
    readonly prompt: string | null;
  }> => {
    const record = viewRecord;
    const authority = record?.runtime.currentAuthority() ?? null;
    const client = authority?.client ?? null;
    const sessionId = authority?.sessionId ?? null;
    const profileId = authority?.profileId ?? null;
    const capabilities = authority?.capabilities ?? null;
    const isCurrent = () =>
      Boolean(
        record &&
        authority &&
        !record.closed &&
        recordManager.get(record.scope) === record &&
        record.runtime.isCurrent(authority) &&
        record.scope.authorityEpoch === authEpochRef.current &&
        activeRuntime.currentAuthority()?.client === client,
      );
    if (
      record === null ||
      client === null ||
      sessionId === null ||
      profileId === null ||
      capabilities === null ||
      controlDriverId === ""
    )
      return { sent: false, message: null, prompt: null };
    const plan = planComposerSeatHandover({
      seatHeld: false,
      thisTabHoldsSeat: false,
      acquireView: null,
      observedRevision:
        driverInventorySnapshot.kind === "complete"
          ? driverInventorySnapshot.observedRevision
          : null,
    });
    if (plan.kind !== "resume-chat")
      return { sent: false, message: null, prompt: null };
    setSeatHandoverStatus("Resuming chat…");
    let commands: ExternalDriverCommands;
    try {
      commands = await client.externalDriverCommands(
        sessionId,
        profileId,
        capabilities,
      );
    } catch {
      setSeatHandoverStatus(null);
      return { sent: false, message: null, prompt: null };
    }
    if (!isCurrent()) {
      setSeatHandoverStatus(null);
      return { sent: false, message: null, prompt: null };
    }
    let view: DriverAcquireView | null = null;
    try {
      view = await commands.driverAcquire({
        driverId: controlDriverId,
        expectedRevision: plan.expectedRevision,
        leaseSeconds: PEER_CONTROL_LEASE_SECONDS,
      });
    } catch (reason) {
      setSeatHandoverStatus(null);
      return {
        sent: false,
        message: releaseRefusalMessage(reason, RELEASE_FAILED_MESSAGE),
        prompt: null,
      };
    }
    if (!isCurrent() || view.capability.driverId !== controlDriverId) {
      setSeatHandoverStatus(null);
      return { sent: false, message: null, prompt: null };
    }
    // Release with the JUST-acquired proof — the single valid use of it.
    try {
      await commands.driverRelease({
        driverId: view.capability.driverId,
        epoch: view.capability.epoch,
        controlToken: view.capability.reveal(),
        expectedRevision: view.binding.revision,
        next: "internal",
      });
    } catch (reason) {
      // The unproven-binding rule (§5.2 lost acquire): the token traveled in
      // the acquire reply we DID observe, so reconciliation is allowed here.
      const observed = await reconcileReleaseForUserTurn(record);
      setSeatHandoverStatus(null);
      if (observed !== "internal") {
        return {
          sent: false,
          message: releaseRefusalMessage(reason, RELEASE_FAILED_MESSAGE),
          prompt: null,
        };
      }
    }
    setSeatHandoverStatus(null);
    if (!isCurrent()) return { sent: false, message: null, prompt: null };
    await recordManager.engineFor(record)?.refreshDriverInventory(record.scope);
    if (!isCurrent()) return { sent: false, message: null, prompt: null };
    if (!prompt.trim()) return { sent: true, message: null, prompt: null };
    const accepted = composerDrafts.enqueue(record, prompt);
    return { sent: accepted, message: null, prompt };
  };

  // P2e (grant 2930): hold the lease for as long as THIS seat owns it. The
  // proof is minted ONCE at acquire and never re-sent, so a lapsed lease
  // silently loses the seat — renew on an interval WELL INSIDE it (three ticks
  // per lease). A typed `driver_fence_stale` means the lease is already gone
  // (another tab acquired, or the server rotated the epoch): the seat is
  // dropped, never retried with the same dead proof. Everything is read from
  // the acquire view captured by this effect, so a re-acquire (new fence)
  // tears the old timer down and starts a fresh one.
  useEffect(() => {
    if (controlAcquire === null) return;
    const params = peerControlRenewParams(controlAcquire.view);
    if (params === null) return;
    const commands = controlAcquire.commands;
    let cancelled = false;
    const timer = setInterval(() => {
      void commands
        .driverRenew(params)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (cancelled) return;
          // Drop ONLY on the allowed stale kind; a transient transport/protocol
          // failure keeps the seat (the next tick retries the same proof).
          if (
            error instanceof ExternalDriverRefusalError &&
            error.refusalKind === "driver_fence_stale"
          ) {
            dropControlSeat();
            setControlState({
              kind: "refused",
              refusalKind: "driver_fence_stale",
            });
          }
        });
    }, PEER_CONTROL_RENEW_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [controlAcquire]);

  const peerControlSeat = derivePeerControlSeat({
    capabilities: controlCapabilities,
    driverInventory: driverInventorySnapshot,
    acquire: controlAcquire?.view ?? null,
    commands: controlAcquire?.commands ?? null,
    target: controlAcquire?.target ?? null,
    state: controlState,
    onSend: controlSend,
  });

  // P2b (grant 2855) + P2g (grant 3030): the ONE dispatch sink for the console.
  // The console OWNS its staging values, so this forwards exactly the
  // lane/brief/title the operator chose into the SAME staging path P1
  // established: the lane is recorded FIRST (the coordinator's supplier reads it
  // at call time), then the peer is staged through kickoff — whose
  // `#openByDispatch` arm takes over whenever the record's control readiness is
  // `ready`. An unadvertised/unread lane refuses typed inside the supplier and
  // stages nothing.
  //
  // Run-12 triage found this sink INERT: a failed manager lookup returned early
  // and a bare `void` slew the null settle, so a ready console dispatched
  // NOTHING and surfaced NOTHING. It now routes through the NEVER-SILENT sink,
  // which settles a typed outcome the panel renders for every path.
  const dispatchStagedPeer = (
    laneKey: string,
    brief: string,
    title: string,
  ) => {
    const manager = viewRecord ? peerCoordinator.get(viewRecord) : null;
    // A NEW activation supersedes the previous sink outcome. In-flight is
    // reported by the manager's own `prepareBusy`; this carrier holds only the
    // SETTLED typed outcome, so a stale refusal never outlives its dispatch.
    setStagedDispatchState(null);
    void performStagedDispatch({
      manager,
      laneKey,
      brief,
      title,
      selectLane: (chosen) => {
        peerLaneChoiceRef.current = chosen;
      },
    }).then(setStagedDispatchState);
  };

  // The console's per-row control sink: ONE `peer/control` frame through the
  // SAME held acquire, targeting the row's server-reported identity.
  //
  // P2p (task 3530 §1): the target is built from the ROW — `targetOperationId`
  // is the accepted dispatch id and `expectedTurnId` is the row's ADOPTED turn
  // (via `buildPeerRowControlTarget`, which fails closed on a missing id). Root's
  // P4C wire capture (evidence native-glm-web-pc-p4c-row-wire-3530) caught the
  // row addressing the MASTER session's turn and its Steer text hardcoded to
  // `synthetic-steer`; both are fixed at their sources. The outcome is recorded
  // per ROW so an accepted or refused control renders on that row (§1c).
  const sendPeerRowControl = (
    row: PeerControllerRosterRow,
    command: PeerControlCommand,
  ) => {
    const acquired = controlAcquire;
    if (acquired === null) return;
    const target = buildPeerRowControlTarget({
      row,
      newOperationId: () => crypto.randomUUID(),
    });
    // No accepted operation id / adopted turn ⇒ NO frame at all (fail closed);
    // the encoder would reject it offline and the operator would see nothing.
    if (target === null) return;
    setRowControl((current) => ({
      ...current,
      [row.slug]: { kind: "sending" },
    }));
    void performPeerControl({
      leaf: acquired.commands,
      fence: peerControlFenceFor(acquired.view),
      target,
      command,
    }).then((state) => {
      setRowControl((current) => ({
        ...current,
        [row.slug]:
          state.kind === "receipt"
            ? { kind: "receipt", duplicate: state.receipt.duplicate }
            : {
                kind: "refused",
                refusalKind:
                  state.kind === "refused"
                    ? state.refusalKind
                    : "peer_control_refused",
              },
      }));
      settleControlState(state);
    });
  };

  // P2p (task 3530 §1b): the ADOPTED turn per row slug. The dispatch receipt's
  // `adopted_turn_id` is the SEED; when the peer later starts a NEW turn, the
  // ADOPTED record's OWN controller reports it, so the row stays current WITHOUT
  // a second tracker — the same `backgroundHandoffTurn` the coordinator reads.
  function adoptedTurnMap(): Map<string, string> {
    const turns = new Map<string, string>();
    for (const [slug, adopted] of adoptedTurnsRef.current) {
      const record = recordManager
        .records()
        .find((entry) => entry.scope.sessionId === adopted.sessionId);
      const live = record?.controller.backgroundHandoffTurn()?.turnId;
      turns.set(
        slug,
        typeof live === "string" && live !== "" ? live : adopted.turnId,
      );
    }
    return turns;
  }

  const peerManager = viewRecord ? peerCoordinator.get(viewRecord) : null;
  const peerSnapshot = peerManager?.snapshot() ?? null;
  // P2b: the console mounts under the SAME readiness gate as the seat, but is
  // HANDED no staging inputs — it owns those. An unread lane source leaves the
  // picker DISABLED (no key, no fallback).
  const peerController = derivePeerControllerConsole({
    readiness: deriveControlReadiness({
      capabilities: controlCapabilities,
      driverInventory: driverInventorySnapshot,
    }),
    capabilities: controlCapabilities,
    laneKeys: peerLaneKeysState,
    seatHeld: controlAcquire !== null,
    // P2i (grant 3050 §1): the badge reads the HELD ACQUIRE's OWN binding — the
    // lease we just took — so a cold Core (observed `internal`, no binding at
    // all) still renders the real driver/epoch/revision. The observed
    // disclosure is only a fallback while NO seat is held.
    binding: peerControlBindingFor({
      seat: controlAcquire,
      driverInventory: driverInventorySnapshot,
    }),
    // P2p (task 3530 §1b-§1c): each row carries its ADOPTED turn (the receipt's
    // `adopted_turn_id`, kept CURRENT from the adopted record's own live turn
    // when the peer starts a new one) plus that row's OWN last control outcome.
    roster: peerControllerRosterRows(
      peerSnapshot?.peers ?? [],
      adoptedTurnMap(),
    ).map((row) => ({
      ...row,
      control: rowControl[row.slug] ?? null,
    })),
    state: peerControllerPanelState({
      control: controlState,
      dispatchBusy: peerSnapshot?.prepareBusy ?? false,
      dispatchFailed: peerSnapshot?.prepareError != null,
      // The typed dispatch-refusal kind from the manager's settle (2920 (a)): a
      // refused dispatch arrives as a JSON-RPC error carrying `data.kind` and
      // never sets `prepareError`, so this is the ONLY operator-visible signal.
      dispatchRefusalKind: peerSnapshot?.dispatchRefusalKind ?? null,
      // P2g (grant 3030): the console's OWN sink outcome. A failed manager
      // lookup / load mismatch / kind-less rejection renders the bounded
      // `unknown` row instead of silence.
      dispatchSink: stagedDispatchState,
    }),
    // P3 (grant 3120 §b): the operator's PARKED seat. While latched, Dispatch and
    // Release stay closed and ONLY this sink can re-take the lease.
    seatReleased: controlSeatReleased,
    onDispatch: (submit) =>
      dispatchStagedPeer(submit.laneKey, submit.brief, submit.title),
    onReleaseSeat: () => releaseControlSeat(),
    onAcquireSeat: () => acquireControlSeat(),
    onRowAction: (row, command) => sendPeerRowControl(row, command),
  });

  // Gap 6b: answer a BLOCKED peer's pending approval straight from its roster
  // row. Fail-closed exactly like the seat: no acquired control capability (or
  // no leaf) ⇒ no action is offered at all; a row that cannot form a target
  // (missing accepted `operationId` or live turn) ⇒ `performPeerApproval`
  // returns NULL and NO frame is sent. A sent answer reuses the panel's bounded
  // presentation state, so a typed refusal kind surfaces without a try/catch.
  const approvalRespond = (
    entry: PeerRosterEntry,
    decision: ApprovalDecision,
  ) => {
    const acquired = controlAcquire;
    if (acquired === null) return;
    void performPeerApproval({
      leaf: acquired.commands,
      acquire: acquired.view,
      entry,
      decision,
      newOperationId: () => crypto.randomUUID(),
    }).then((state) => {
      if (state !== null) settleControlState(state);
    });
  };

  // ONE controller per Session record (record.controller). The product does
  // NOT hold a second controller that shares the FIFO; the UI delegates
  // submit/interrupt to the SELECTED record's own controller, which owns that
  // Session's start-pending request/acceptedOwner leases. A rejected A start
  // unsticks A even while B is selected because A's controller owns A's gate.
  const [selectedQueue, setSelectedQueue] = useState<PromptTurnQueueSnapshot>(
    () => recordManager.selected()?.controller.queueSnapshot() ?? EMPTY_QUEUE,
  );
  const [selectedDispatching, setSelectedDispatching] = useState<string | null>(
    null,
  );
  const [selectedInterrupting, setSelectedInterrupting] = useState<
    string | null
  >(null);
  const [selectedRecovery, setSelectedRecovery] =
    useState<TurnRecoveryState | null>(null);
  // Re-publish the selected record's controller state whenever the selection or
  // the record's queue changes. The controller is the source of truth; this is
  // only a React mirror. The manager notifies on selection change and on any
  // record's queue/terminal/background activity.
  useEffect(() => {
    const publish = () => {
      const record = recordManager.selected();
      setTimeline(record?.timeline ?? []);
      setSelectedQueue(record?.controller.queueSnapshot() ?? EMPTY_QUEUE);
      setSelectedDispatching(record?.controller.dispatchingTurnIdNow() ?? null);
      setSelectedInterrupting(
        record?.controller.interruptingTurnIdNow() ?? null,
      );
      setSelectedRecovery(record?.controller.turnRecoveryNow() ?? null);
    };
    publish();
    return recordManager.subscribe(publish);
  }, [recordManager]);
  const turnController = {
    queue: selectedQueue,
    dispatchingTurnId: selectedDispatching,
    interruptingTurnId: selectedInterrupting,
    turnRecovery: selectedRecovery,
    retryTurnRecovery: () =>
      viewRecord?.controller.retryTurnRecovery() ?? Promise.resolve(),
    cancelQueuedPrompt: (turnId: string) =>
      viewRecord?.controller.cancelQueuedPrompt(turnId) ?? false,
    interruptible: Boolean(
      selectedQueue.active &&
      !selectedRecovery &&
      selectedDispatching !== selectedQueue.active.turnId &&
      selectedRecord()?.controller.interruptibleNow(),
    ),
    enqueuePrompt: (text: string) => {
      const accepted = viewRecord
        ? composerDrafts.enqueue(viewRecord, text)
        : false;
      if (accepted && viewRecord)
        btwControllersRef.current.get(viewRecord)?.clearSettled();
      return accepted;
    },
    interrupt: () => viewRecord?.controller.interrupt() ?? Promise.resolve(),
  };
  const supervisionController = useSupervision({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
  });
  const supervision = supervisionController.state;
  const codingSafetyController = useCodingSafety({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
    onPermissionApplied: (client) => {
      void supervisionController.refresh(client);
    },
  });
  const permission = codingSafetyController.permission;
  const diffReview = codingSafetyController.diffReview;
  const workspaceController = useWorkspaceProduct({
    client: currentClient,
    sessionId: currentSessionId,
    capabilities: currentCapabilities,
    connectionConfig: () => currentAuthority()?.config ?? null,
  });
  const workspace = workspaceController.state;
  const activeProfileId = () =>
    currentAuthority()?.profileId ??
    connectionSnapshot.session?.opened.active_profile_id ??
    "";
  const modelController = useModelSelection({
    client: currentClient,
    sessionId: currentSessionId,
    profileId: activeProfileId,
    capabilities: currentCapabilities,
  });
  const [launch, setLaunch] =
    useState<LaunchRuntimeState>(EMPTY_LAUNCH_RUNTIME);
  const onboardingController = useOnboarding({
    client: currentClient,
    capabilities: currentCapabilities,
    onConfigured: async (profileId, client) => {
      const transition = launchTransitionRef.current.current();
      const authority = currentAuthority();
      if (!transition || !authority || authority.client !== client) {
        throw new Error("The server connection changed during onboarding.");
      }
      const { config, lease } = transition;
      setLaunch((current) => ({ ...current, phase: "opening" }));
      const opening = openCandidateSession(
        launchProfileConfig(config, profileId),
        lease,
      );
      try {
        const outcome = await opening;
        if (!launchTransitionRef.current.isCurrent(lease)) return;
        if (outcome !== "opened") {
          throw new Error("The new coding session could not be opened.");
        }
        onboardingController.reset();
      } catch (reason) {
        failLaunchTransition(lease, reason);
        throw reason;
      }
    },
  });

  runtimeEventSinkRef.current = handleRuntimeEvent;

  useEffect(() => {
    return () => {
      candidateAbortRef.current?.abort();
      recoveryAbortRef.current?.abort();
      composerDrafts.clear();
      peerCoordinator.clear();
      recordManager.retireAll();
      launchTransitionRef.current.cancel();
    };
  }, []);

  const markTransitioning = (next: boolean) => {
    setTransitioning(next);
  };

  // Publish the persistent background records (every non-selected Session)
  // with their own live queue state — a terminal event advances a background
  // FIFO while another Session is selected.
  function publishBackgroundTurns(): void {
    const background = recordManager
      .records()
      .filter((record) => !record.selected && record.payload !== null);
    const attention: BackgroundTurnSnapshot[] = [];
    const snapshots: BackgroundSessionSnapshot[] = background.map((record) => {
      const queue = record.controller.queueSnapshot();
      const active = queue.active;
      // Read the record's OWN interaction ledger (one per record), never a
      // separate hook-level ledger that can drift.
      const waiting = record.interactions.waitingSnapshot().length > 0;
      // A turn whose outcome reconnect recovery could not prove must not
      // silently look like live work: Core ends a turn when its owner
      // connection closes, so without an observed terminal the honest
      // background state is "failed" (a "checking" lookup is still running).
      const recovery = record.controller.turnRecoveryNow();
      const lost = Boolean(
        active &&
        recovery?.turnId === active.turnId &&
        recovery.phase !== "checking",
      );
      const scope = {
        workspaceRoot: record.scope.workspaceRoot,
        profileId: record.scope.profileId,
        sessionId: record.scope.sessionId,
      };
      for (const turn of foregroundAttentionTurns(
        scope,
        active?.turnId ?? null,
        record.interactions.current(record.scope)?.turnId ?? null,
        record.timeline,
      )) {
        attention.push(
          lost && turn.turnId === active?.turnId
            ? { ...turn, state: "failed" }
            : turn,
        );
      }
      return {
        ...scope,
        state: lost
          ? "failed"
          : backgroundSessionState(queue, waiting, record.timeline),
        activeTurnId: active?.turnId ?? null,
        queuedCount: queue.pending.length,
        unread: record.unread,
        waiting,
      };
    });
    setBackgroundTurns(snapshots);
    setAttentionTurns(attention);
  }

  /**
   * Install the SELECTED record's retained presentation into the product view.
   * The record's hydrate/ready emitted BEFORE it was selected (only the
   * selected record forwards events), so the UI must restore the destination's
   * canonical transcript + pending interactions from the record's retained
   * authoritative payload. The record reducer already reconciled its queue.
   */
  function installSelectedRecord(
    record: ReturnType<SessionRecordManager<OctosUiClient>["selected"]>,
  ): void {
    if (!record) return;
    // These are selected-only read projections, not retained execution owners.
    // Reset them before reading B so A's settings/tasks cannot be shown in B.
    codingSafetyController.reset();
    supervisionController.reset();
    workspaceController.reset();
    modelController.reset();
    const payload = record.payload;
    if (payload) {
      // Install the record's OWN timeline (built up by its per-record reducer),
      // so switching back restores A's view and a background A2 never mutates
      // the selected Session's presentation.
      setTimeline(record.timeline);
      configureCodingSurfaces(payload.capabilities);
    }
    // Mark the selected record read; its own ledger drives the foreground panel.
    record.interactions.markRead(record.scope);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    const authority = record.runtime.currentAuthority();
    if (authority?.client.status === "connected") {
      void codingSafetyController.refreshPermission(authority.client);
      void supervisionController.refresh(authority.client);
      void workspaceController.refresh(authority.client);
      void modelController.refresh(authority.client);
    }
    publishBackgroundTurns();
  }

  // Pool recovery: the shared socket reconnected. Freeze ALL records, reopen +
  // rehydrate each scoped Session + cursor, reconcile the exact accepted turn,
  // and drain only never-accepted unsent turns once the server is idle+healthy.
  async function recoverSessionRecords(): Promise<void> {
    // ONE reconnect transport (the pool already reconnected its single socket).
    // Each managed record is suspended (authority leases invalidated), re-bound
    // to the shared socket, re-hydrated, and its controller reconciles the exact
    // accepted turn then drains its unsent FIFO exactly once via the record's
    // session-hydrate reducer — never a direct concurrent start loop over the
    // backlog. The AbortController is local: recovery is best-effort per record.
    recoveryAbortRef.current?.abort();
    const abort = new AbortController();
    recoveryAbortRef.current = abort;
    const results = await recordManager.recoverRecords(abort.signal);
    if (abort.signal.aborted || recoveryAbortRef.current !== abort) return;
    recoveryAbortRef.current = null;
    const surfacing = planRecoverySurfacing(
      results,
      recordManager.selected()?.scope.sessionId ?? null,
    );
    // Only the SELECTED record's failure is fatal for the workspace: it is the
    // one record whose composer surface the user is actually on. A failure in
    // ANY OTHER record must not tear down the live Session.
    if (surfacing.fatal) {
      workspaceController.setError(surfacing.fatal);
    } else {
      // Only clear a previous fatal error; an unconditional setError(null)
      // allocates a fresh workspace state on EVERY healthy recovery and
      // re-renders the sidebar tree (regressed native-workflows :249/:505).
      if (workspaceController.state.error !== null) {
        workspaceController.setError(null);
      }
      setRecoveryNotice(surfacing.notice);
    }
    publishBackgroundTurns();
  }

  function resetProductSessionState(): void {
    setEventLog({ events: [], omitted: 0 });
    setTimeline([]);
    codingSafetyController.reset();
    supervisionController.reset();
    onboardingController.reset();
    workspaceController.reset();
    modelController.reset();
  }

  function handleRuntimeEvent(
    event: ActiveSessionRuntimeEvent<OctosUiClient>,
  ): void {
    if (event.type === "session-cleared") {
      // "select" and "disconnect" replace the product projection and reset the
      // queue. "resume" is reconnect recovery on the SAME record: its queue and
      // executable controller must be preserved — only the presentation
      // projection is replaced by the fresh hydrate that follows.
      if (event.reason === "resume") {
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        return;
      }
      resetProductSessionState();
      setLaunch(EMPTY_LAUNCH_RUNTIME);
      return;
    }
    if (event.type === "authenticated") {
      configureCodingSurfaces(event.authority.capabilities);
      setLaunch(EMPTY_LAUNCH_RUNTIME);
      markTransitioning(false);
      // The pool reconnected its one socket. Freeze every persistent record and
      // recover each Session against the fresh transport (reopen + hydrate +
      // reconcile its accepted turn + drain only never-accepted unsent work).
      if (event.reason === "reconnect") {
        void recoverSessionRecords();
      }
      return;
    }
    if (event.type === "raw-notification") {
      appendObservedEvent(event.notification);
      return;
    }
    if (event.type === "session-hydrate") {
      if (event.reason === "candidate") {
        // Candidate adoption emits session-cleared before its raw diagnostics,
        // so resetting here would erase the new Session's staged event log.
        pendingRestoreConfigRef.current = null;
        setRestoreRejected(false);
      }
      // The RECORD is the hydrate/timeline/FIFO authority: its reducer already
      // rebuilt record.timeline, restored record.interactions, and reconciled
      // the record's own controller. This handler only MIRRORS the selected
      // record's retained presentation into React — it must NOT re-fold the
      // timeline, re-restore interactions, or re-drive the queue.
      const record = recordManager.selected();
      if (record && record.scope.sessionId === event.authority.sessionId) {
        setTimeline(record.timeline);
      }
      // A same-transport durable recovery does not replace the capability/RPC
      // authority. Candidate and reconnect hydrates do, so only those retire
      // controller requests that may belong to an obsolete socket.
      if (event.reason !== "recovery") {
        configureCodingSurfaces(event.authority.capabilities);
      }
      if (event.reason === "candidate") {
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        markTransitioning(false);
      }
      return;
    }
    if (event.type === "notification") {
      applyProductNotification(event.notification, event.authority);
      return;
    }
    if (event.reason !== "recovery") {
      void codingSafetyController.refreshPermission(event.authority.client);
      void supervisionController.refresh(event.authority.client);
      void workspaceController.refresh(event.authority.client);
      void modelController.refresh(event.authority.client);
    }
  }

  function appendObservedEvent(notification: RpcNotification): void {
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
  }

  function restoreLaunchChoice(lease: LaunchTransitionLease): boolean {
    const choice = launchTransitionRef.current.restoreChoice(lease);
    if (!choice) return false;
    setLaunch({
      phase: "awaiting_choice",
      cwd: choice.config.cwd,
      decision: choice.decision,
    });
    return true;
  }

  function failLaunchTransition(
    lease: LaunchTransitionLease,
    reason?: unknown,
  ): void {
    if (!launchTransitionRef.current.isCurrent(lease)) return;
    // Some preparation failures already set a precise, actionable product
    // error (notably the retained-owner capacity boundary). Do not replace it
    // with a generic transition failure while still cleaning up the lease.
    if (reason !== undefined)
      workspaceController.setError(errorMessage(reason));
    if (!restoreLaunchChoice(lease)) {
      launchTransitionRef.current.discard(lease);
      setLaunch(EMPTY_LAUNCH_RUNTIME);
    }
    markTransitioning(false);
  }

  const connect = (input: SessionConnectionInput) => {
    // Authentication and selecting a coding Session are separate product
    // actions. The auth gate must not create a hidden default session.
    beginConnection(input, false);
  };

  const restore = (input: SessionConnectionInput) => {
    // Refresh restoration is a best-effort Session transition after the
    // authenticated server shell is committed. A stale Session must never
    // turn valid credentials into a connection failure.
    beginConnection(input, true);
  };

  const beginConnection = (
    input: SessionConnectionInput,
    restoreAfterAuthentication = false,
  ) => {
    recoveryAbortRef.current?.abort();
    // Explicit login starts a new authenticated identity even at the same URL.
    // Automatic transport reconnect does not call beginConnection.
    authEpochRef.current += 1;
    composerDrafts.clear();
    peerCoordinator.clear();
    recordManager.retireAll();
    publishBackgroundTurns();
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    const config = normalizeConnectionInput(input);
    pendingRestoreConfigRef.current =
      restoreAfterAuthentication && config.sessionId && config.cwd
        ? config
        : null;
    setRestoreRejected(false);
    markTransitioning(false);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    void activeRuntime
      .authenticate(config)
      .then((authority) => {
        if (!authority || !activeRuntime.isCurrent(authority)) return;
        const restoreTarget = pendingRestoreConfigRef.current;
        pendingRestoreConfigRef.current = null;
        if (!restoreTarget) return;
        void openCandidateSession(restoreTarget).then((outcome) => {
          if (outcome === "opened") return;
          if (
            activeRuntime.isCurrent(authority) &&
            authority.client.status === "connected"
          ) {
            setRestoreRejected(true);
          }
        });
      })
      .catch(() => {
        pendingRestoreConfigRef.current = null;
        setLaunch(EMPTY_LAUNCH_RUNTIME);
        markTransitioning(false);
      });
  };

  async function resolveInitialLaunch(
    authority: ActiveSessionAuthority<OctosUiClient>,
    config: SessionConnectionInput,
    lease: LaunchTransitionLease,
  ): Promise<SessionConnectionInput | null> {
    const stillOwnsTransition = () =>
      launchTransitionRef.current.isCurrent(lease) &&
      (activeRuntime.isCurrent(authority) ||
        recordManager
          .records()
          .some((record) => record.runtime.isCurrent(authority)));
    if (!config.cwd) return stillOwnsTransition() ? config : null;
    const capabilities = authority.capabilities;
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
    const decision = await authority.client.resolveLaunch({
      cwd: config.cwd,
      ...(config.profileId ? { profile_id: config.profileId } : {}),
    });
    if (!stillOwnsTransition()) return null;
    const automaticProfile =
      decision.decision === "resume" ||
      (decision.decision === "activate" &&
        config.sessionId.trim().startsWith("web-"))
        ? decision.resolved_profile
        : undefined;
    if (automaticProfile) {
      setLaunch({ phase: "opening", cwd: config.cwd, decision: null });
      return launchProfileConfig(config, automaticProfile);
    }
    if (!launchTransitionRef.current.rememberDecision(lease, decision)) {
      return null;
    }
    setLaunch({
      phase: "awaiting_choice",
      cwd: config.cwd,
      decision,
    });
    if (decision.decision === "no_profile") {
      void onboardingController.prepare();
    }
    return null;
  }

  async function openCandidateSession(
    config: SessionConnectionInput,
    existingLease?: LaunchTransitionLease,
    requireExactWorkspace = false,
  ): Promise<WorkspaceOpenOutcome> {
    const lease = existingLease ?? launchTransitionRef.current.begin(config);
    if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
    // The record manager already requires the confirmed workspace root to
    // equal a requested cwd. A saved link additionally needs that cwd at all.
    if (requireExactWorkspace && !config.cwd.trim()) {
      failLaunchTransition(
        lease,
        "The server opened a different workspace from the saved link.",
      );
      return "failed";
    }
    // The POOL owns the one physical socket. A candidate borrows it; the pool
    // must be connected and still owned by the same generation after awaits.
    const poolAuthority = activeRuntime.currentAuthority();
    const pooledClient = poolAuthority?.client ?? null;
    if (
      !poolAuthority ||
      !pooledClient ||
      pooledClient.status !== "connected"
    ) {
      failLaunchTransition(lease, "The Octos server connection is not ready.");
      return "failed";
    }
    if (missingCodingSessionRequirements(poolAuthority.capabilities).length) {
      failLaunchTransition(
        lease,
        "This Octos server cannot open a coding session in the Web app.",
      );
      return "failed";
    }

    candidateAbortRef.current?.abort();
    const abortController = new AbortController();
    candidateAbortRef.current = abortController;

    markTransitioning(true);
    const choice = launchTransitionRef.current.restoreChoice(lease);
    setLaunch({
      phase: "opening",
      cwd: config.cwd,
      decision: choice?.decision ?? null,
    });
    workspaceController.setError(null);
    try {
      // Prepare on the POOLED transport (never a new socket), then install into
      // the DESTINATION record's managed runtime. A failed candidate releases
      // only its staging listeners; the selected record's queue and the shared
      // transport are untouched, so a failed open cannot interrupt the current
      // Session.
      const record = await recordManager.openOnRecord(
        config,
        pooledClient,
        abortController.signal,
      );
      if (
        candidateAbortRef.current !== abortController ||
        !launchTransitionRef.current.isCurrent(lease) ||
        !activeRuntime.isCurrent(poolAuthority)
      ) {
        return "failed";
      }
      // Select the destination record: the previous record keeps running in the
      // background (its queue/controller are untouched — no reset, no handoff).
      recordManager.select(record.scope);
      // Install the destination's retained canonical transcript + interactions
      // + presentation. Its hydrate/ready emitted BEFORE selection (only the
      // selected record forwards events), so the UI must restore from the
      // record's retained authoritative payload.
      installSelectedRecord(record);
      publishBackgroundTurns();
      return "opened";
    } catch (reason) {
      if (
        candidateAbortRef.current === abortController &&
        launchTransitionRef.current.isCurrent(lease)
      ) {
        failLaunchTransition(lease, reason);
      }
      return "failed";
    } finally {
      if (candidateAbortRef.current === abortController) {
        candidateAbortRef.current = null;
        markTransitioning(false);
      }
    }
  }

  function configureCodingSurfaces(
    capabilities: UiProtocolCapabilities | undefined,
  ) {
    codingSafetyController.configureCapabilities(capabilities);
    supervisionController.configureCapabilities(capabilities);
    workspaceController.configureCapabilities(capabilities);
    modelController.configureCapabilities(capabilities);
  }

  const disconnect = () => {
    recoveryAbortRef.current?.abort();
    // Explicit disconnect retires every persistent record (and the pool closes
    // the shared socket via activeRuntime.disconnect()).
    composerDrafts.clear();
    peerCoordinator.clear();
    recordManager.retireAll();
    publishBackgroundTurns();
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    pendingRestoreConfigRef.current = null;
    setRestoreRejected(false);
    markTransitioning(false);
    activeRuntime.disconnect();
  };

  const refreshWorkspace = async () => {
    await workspaceController.refresh();
  };

  const switchSession = async (
    sessionId: string,
  ): Promise<WorkspaceOpenOutcome> => {
    const target = sessionId.trim();
    const authority = currentAuthority();
    const config = authority?.config;
    if (!target || target === authority?.sessionId || !config) return "failed";
    return openWorkspaceSession({
      sessionId: target,
      cwd: config.cwd,
      profileId: authority.profileId,
      resolveLaunch: false,
    });
  };

  const openWorkspaceSession = (
    input: WorkspaceSessionOpenInput,
  ): Promise<WorkspaceOpenOutcome> => {
    if (!input.sessionId.trim() || !input.cwd.trim())
      return Promise.resolve("failed");
    if (navigationBlockedByTurnRecovery()) return Promise.resolve("failed");
    const retained = recordManager
      .records()
      .find(
        (record) =>
          record.scope.authorityEpoch === authEpochRef.current &&
          record.scope.sessionId === input.sessionId.trim() &&
          record.scope.workspaceRoot === input.cwd.trim() &&
          (!input.profileId ||
            record.scope.profileId === input.profileId.trim()),
      );
    if (retained) {
      // A view switch MUST NOT reopen/rehydrate an in-flight dispatch. A start
      // can be accepted after an earlier hydrate, making that hydrate ambiguous.
      candidateAbortRef.current?.abort();
      candidateAbortRef.current = null;
      launchTransitionRef.current.cancel();
      recordManager.select(retained.scope);
      installSelectedRecord(retained);
      markTransitioning(false);
      return Promise.resolve("opened");
    }
    if (!currentAuthority()) return Promise.resolve("failed");
    // Navigation is independent of every turn's acknowledgement and FIFO.
    // The launch coordinator and candidate abort provide latest-intent fencing.
    return performWorkspaceSessionOpen(input);
  };

  /**
   * The selected Session's unresolved turn is BROWSER-HELD evidence, not
   * discoverable history: it lives only in this record's recovery state, and
   * navigating away (a switch or a new Session) would leave the operator with
   * no record to resolve it from — and could later permit an unsafe resend.
   * Resolving it through "Check status" clears the block.
   */
  function navigationBlockedByTurnRecovery(): boolean {
    if (!turnController.turnRecovery) return false;
    workspaceController.setError(TURN_RECOVERY_NAVIGATION_MESSAGE);
    return true;
  }

  async function performWorkspaceSessionOpen(
    input: WorkspaceSessionOpenInput,
  ): Promise<WorkspaceOpenOutcome> {
    const target = input.sessionId.trim();
    const cwd = input.cwd.trim();
    const authority = currentAuthority();
    const config = authority?.config;
    if (!target || !cwd || !config || !authority) return "failed";
    const candidateConfig = {
      ...config,
      sessionId: target,
      cwd,
      profileId: input.profileId?.trim() || config.profileId,
    };
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    const lease = launchTransitionRef.current.begin(candidateConfig);
    // Switching sessions selects an existing persistent record (or opens a new
    // one). No source reset, no handoff, no eight-owner cap: the source record
    // keeps running in the background with its own queue/controller.
    onboardingController.reset();
    workspaceController.setError(null);
    markTransitioning(true);
    if (input.resolveLaunch === false) {
      // A catalog row already names an authoritative Session. Folder launch
      // resolution is for creating a Session and may resolve another default
      // profile; reopen with the server-confirmed id and profile tuple.
      setLaunch({ phase: "opening", cwd, decision: null });
      return openCandidateSession(
        candidateConfig,
        lease,
        input.requireExactWorkspace,
      );
    }
    setLaunch({ phase: "resolving", cwd, decision: null });
    try {
      const resolved = await resolveInitialLaunch(
        authority,
        candidateConfig,
        lease,
      );
      if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
      if (!resolved) return "awaiting_choice";
      return openCandidateSession(resolved, lease, input.requireExactWorkspace);
    } catch (reason) {
      if (!launchTransitionRef.current.isCurrent(lease)) return "failed";
      failLaunchTransition(lease, reason);
      return "failed";
    }
  }

  const chooseLaunchProfile = async (profileId: string) => {
    const target = profileId.trim();
    const transition = launchTransitionRef.current.current();
    const decision = transition?.decision;
    const authority = currentAuthority();
    const config = transition?.config;
    const lease = transition?.lease;
    const allowed = decision
      ? [decision.resolved_profile, ...decision.existing_profiles].filter(
          (candidate): candidate is string => Boolean(candidate),
        )
      : [];
    if (
      !target ||
      !authority ||
      !config ||
      !lease ||
      !decision ||
      !allowed.includes(target) ||
      candidateAbortRef.current !== null
    ) {
      return;
    }
    setLaunch((current) => ({ ...current, phase: "opening" }));
    const opening = openCandidateSession(
      launchProfileConfig(config, target),
      lease,
    );
    try {
      const outcome = await opening;
      if (!launchTransitionRef.current.isCurrent(lease)) return;
      if (outcome !== "opened") restoreLaunchChoice(lease);
    } catch (reason) {
      if (!launchTransitionRef.current.isCurrent(lease)) return;
      failLaunchTransition(lease, reason);
    }
  };

  const cancelLaunch = () => {
    launchTransitionRef.current.cancel();
    candidateAbortRef.current?.abort();
    candidateAbortRef.current = null;
    onboardingController.reset();
    workspaceController.setError(null);
    setLaunch(EMPTY_LAUNCH_RUNTIME);
    markTransitioning(false);
  };

  function applyProductNotification(
    notification: RpcNotification,
    authority: ActiveSessionAuthority<OctosUiClient>,
  ): void {
    // This fires for the SELECTED record's runtime events; the record manager
    // already routed it, so the authority is current by construction.
    codingSafetyController.observeNotification(notification);
    supervisionController.observeNotification(notification);
    const tokenCost = parseTokenCostUpdate(notification);
    if (tokenCost && tokenCost.sessionId === authority.sessionId) {
      workspaceController.observeTokenCost(tokenCost);
    }

    // The record reducer owns canonical/legacy admission, timeline folding,
    // interaction state and FIFO settlement. This hook is a selected view only.
    const record = selectedRecord();
    if (record?.scope.sessionId === authority.sessionId)
      setTimeline(record.timeline);
  }

  function isViewCurrent(): boolean {
    if (
      !viewRecord ||
      !viewAuthority ||
      viewRecord.closed ||
      viewEpoch !== authEpochRef.current ||
      recordManager.selected() !== viewRecord ||
      recordManager.get(viewRecord.scope) !== viewRecord ||
      !viewRecord.runtime.isCurrent(viewAuthority) ||
      activeRuntime.currentAuthority()?.client !== viewAuthority.client
    )
      return false;
    const snapshot = viewRecord.runtime.getSnapshot();
    const current = viewRecord.runtime.currentAuthority();
    return (
      current !== null &&
      snapshot.phase === "ready" &&
      snapshot.recovery.phase === "healthy" &&
      current.capabilities === viewAuthority.capabilities &&
      current.sessionId === viewRecord.scope.sessionId &&
      current.profileId === viewRecord.scope.profileId &&
      current.cwd === viewRecord.scope.workspaceRoot &&
      current.config.endpoint === viewRecord.scope.endpoint
    );
  }

  const openingConfig = transitioning
    ? launchTransitionRef.current.current()?.config
    : null;

  return {
    peers: {
      manager: viewRecord ? peerCoordinator.get(viewRecord) : null,
      error: viewRecord ? peerCoordinator.getError(viewRecord) : null,
      /**
       * `/peer clear` (TUI parity 2500 §2): the coordinator prune for the ACTIVE
       * record. A foreign/unbound record is a fail-closed 0. The roster
       * re-renders through the manager's own publish, so the dock pill counts
       * follow without any extra wiring.
       */
      clearFinished: () =>
        viewRecord ? peerCoordinator.clearFinished(viewRecord) : 0,
      /**
       * P1 (grant 2810 §2): stage ONE peer on the operator's chosen MODEL LANE.
       * The lane is recorded FIRST (the coordinator's supplier reads it at call
       * time), then the peer is staged through the existing kickoff path — whose
       * `#openByDispatch` arm takes over whenever the record's control readiness
       * is `ready`. An unadvertised/unread lane therefore refuses typed inside the
       * supplier and stages nothing.
       *
       * P2g (grant 3030): routed through the SAME NEVER-SILENT sink the console
       * uses, so a failed manager lookup or a null settle surfaces a typed
       * outcome instead of an inert `void`.
       */
      dispatch: (laneKey, brief, title) => {
        dispatchStagedPeer(laneKey, brief, title);
      },
      /**
       * P1 (grant 2810 §2): RELEASE the held control seat. Parks the binding with
       * `next:"external"` (the dispatched peer keeps running) and clears the local
       * acquire, so the supplier immediately refuses typed until a new acquire.
       * No fence held ⇒ no frame at all.
       */
      releaseSeat: () => {
        // P1 (grant 2810 §2) + P3 (grant 3120 §b): the ONE release path, SHARED
        // with the console's Release button — including the release LATCH, so a
        // `/peer`-driven release can never be silently undone by the post-release
        // inventory walk either.
        releaseControlSeat();
      },
      gather: async (slugs, canSubmit) => {
        const record = viewRecord;
        const authority = record?.runtime.currentAuthority() ?? null;
        const reasoningEffort = viewDraft?.effort;
        const filter = slugs === undefined ? undefined : [...slugs];
        const { gatherFromRecord } = await import("../peers/gather.ts");
        return gatherFromRecord({
          record,
          authority,
          reasoningEffort,
          slugs: filter,
          canSubmit,
          isRetained: (origin) => recordManager.get(origin.scope) === origin,
          pooledClient: () => activeRuntime.currentAuthority()?.client ?? null,
        });
      },
      // Fail-closed: with no acquired control capability there is no sink, so
      // the dock keeps its row actions unmounted (`onApprovalRespond && …`).
      ...(controlAcquire === null ? {} : { approvalRespond }),
    },
    connection: {
      status: connectionSnapshot.status,
      closed: viewRecord?.closed ?? false,
      error: connectionSnapshot.error,
      opened:
        connectionSnapshot.session?.opened ??
        (viewRecord?.closed ? (viewRecord.payload?.opened ?? null) : null),
      recovery: connectionSnapshot.recovery,
      diagnostics: connectionSnapshot.diagnostics,
      capabilities:
        connectionSnapshot.session?.capabilities ??
        connectionSnapshot.serverCapabilities,
      driverInventory: driverInventorySnapshot,
      peerControl: peerControlSeat,
      peerController,
      connected:
        connectionSnapshot.phase === "ready" &&
        connectionSnapshot.status === "connected" &&
        connectionSnapshot.session !== null &&
        connectionSnapshot.recovery.phase === "healthy",
      authenticated: serverConnection.snapshot.authenticated,
      restoreRejected,
      recoveryNotice,
      dismissRecoveryNotice: () => setRecoveryNotice(null),
      connect,
      restore,
      disconnect,
    },
    conversation: {
      timeline,
      setTimeline: (update) => {
        if (!viewRecord || recordManager.get(viewRecord.scope) !== viewRecord)
          return;
        viewRecord.timeline =
          typeof update === "function" ? update(viewRecord.timeline) : update;
        if (viewRecord.selected) setTimeline(viewRecord.timeline);
      },
      queue: turnController.queue,
      dispatchingTurnId: turnController.dispatchingTurnId,
      turnRecovery: turnController.turnRecovery,
      retryTurnRecovery: turnController.retryTurnRecovery,
      interruptible: turnController.interruptible,
      interruptingTurnId: turnController.interruptingTurnId,
      enqueuePrompt: turnController.enqueuePrompt,
      cancelQueuedPrompt: turnController.cancelQueuedPrompt,
      btw: viewRecord
        ? (btwControllersRef.current.get(viewRecord) ?? null)
        : null,
      askBtw: (question) => {
        if (
          !viewRecord ||
          viewRecord.closed ||
          recordManager.get(viewRecord.scope) !== viewRecord
        )
          return "stale";
        let controller = btwControllersRef.current.get(viewRecord);
        if (!controller) {
          controller = new LazyBtwController({
            record: viewRecord,
            isRetained: (record) =>
              recordManager.get(record.scope) === record &&
              !record.closed &&
              record.scope.authorityEpoch === authEpochRef.current,
            pooledClient: currentClient,
          });
          btwControllersRef.current.set(viewRecord, controller);
          setBtwRevision((revision) => revision + 1);
        }
        return controller.ask(question);
      },
      steeringEnabled: viewRecord?.controller.steeringEnabled() ?? false,
      setSteeringEnabled: (value) => {
        if (
          !viewRecord ||
          viewRecord.closed ||
          recordManager.get(viewRecord.scope) !== viewRecord
        )
          return;
        viewRecord.controller.setSteeringEnabled(
          value === "toggle" ? !viewRecord.controller.steeringEnabled() : value,
        );
        setDraftRevision((revision) => revision + 1);
      },
      inputError: viewDraft?.error ?? null,
      reasoningEffort: viewDraft?.effort,
      showReasoning: viewDraft?.showReasoning ?? true,
      setShowReasoning: (value) => {
        if (viewRecord) composerDrafts.setShowReasoning(viewRecord, value);
      },
      setReasoningEffort: (value) => {
        if (viewRecord) composerDrafts.setEffort(viewRecord, value);
      },
      attachments: viewDraft?.images ?? null,
      prepareAttachments: () =>
        viewRecord
          ? composerDrafts.prepareImages(viewRecord)
          : Promise.resolve(null),
      interruptedPrompt: viewRecord
        ? composerDrafts.peekRestore(viewRecord)
        : null,
      takeInterruptedPrompt: () =>
        viewRecord ? composerDrafts.consumeRestore(viewRecord) : null,
      seatHandover: seatHandoverStatus,
      resumeChatSend,
      interrupt: turnController.interrupt,
    },
    interactions: {
      ...interactionSnapshot,
      respondApproval: (decision, scope) =>
        interactionLedger?.getSnapshot().approval ===
        interactionSnapshot.approval
          ? (interactionLedger?.respondApproval(decision, scope) ??
            Promise.resolve())
          : Promise.resolve(),
      respondQuestion: (answers) =>
        interactionLedger?.getSnapshot().question ===
        interactionSnapshot.question
          ? (interactionLedger?.respondQuestion(answers) ?? Promise.resolve())
          : Promise.resolve(),
    },
    safety: {
      permission,
      diffReview,
      refreshPermission: codingSafetyController.refreshPermission,
      updatePermission: codingSafetyController.updatePermission,
      openDiffReview: codingSafetyController.openDiffReview,
      closeDiffReview: codingSafetyController.closeDiffReview,
    },
    models: {
      state: modelController.state,
      refresh: modelController.refresh,
      select: modelController.select,
      management: {
        client: currentClient(),
        profileId: activeProfileId(),
        authorityKey: `${authEpochRef.current}:${currentAuthority()?.generation ?? 0}:${activeProfileId()}`,
        capabilities: currentCapabilities(),
        available:
          supportsMethod(
            currentCapabilities(),
            APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
          ) ||
          supportsMethod(
            currentCapabilities(),
            APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
          ),
      },
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
      transitioning,
      openingSession: openingConfig
        ? {
            cwd: openingConfig.cwd,
            profileId: openingConfig.profileId,
            sessionId: openingConfig.sessionId,
          }
        : null,
      pendingNavigation: null,
      cancelPendingNavigation: noopCancelPendingNavigation,
      backgroundTurns,
      attentionTurns,
      onboarding: onboardingController.state,
      refresh: refreshWorkspace,
      listWorkspaceSessions: workspaceController.listWorkspaceSessions,
      switchSession,
      openSession: openWorkspaceSession,
      deleteSession: workspaceController.deleteSession,
      chooseLaunchProfile,
      cancelLaunch,
      retryOnboarding: onboardingController.prepare,
      submitOnboarding: onboardingController.submit,
    },
    diagnostics: {
      events: eventLog.events,
      omittedEvents: eventLog.omitted,
    },
    protocol: {
      client: currentClient(),
      authorityKey: (() => {
        const authority = currentAuthority();
        return viewRecord
          ? `${authority?.generation ?? 0}:${sessionRuntimeScopeKey(viewRecord.scope)}`
          : `${authEpochRef.current}:${authority?.generation ?? 0}:${authority?.sessionId ?? ""}:${authority?.profileId ?? ""}`;
      })(),
      sessionId: currentSessionId(),
      profileId: activeProfileId(),
      isCurrent: isViewCurrent,
      spawnAgents: (text) =>
        admitAgentSpawn(viewRecord, isViewCurrent, text, viewDraft?.effort),
      selectResumed: (record) => {
        if (
          !isViewCurrent() ||
          !viewRecord ||
          recordManager.get(record.scope) !== record ||
          record.closed ||
          !record.payload ||
          record.scope.endpoint !== viewRecord.scope.endpoint ||
          record.scope.authorityEpoch !== viewRecord.scope.authorityEpoch ||
          record.scope.profileId !== viewRecord.scope.profileId ||
          record.scope.workspaceRoot !== viewRecord.scope.workspaceRoot ||
          record.runtime.getSnapshot().phase !== "ready" ||
          record.runtime.getSnapshot().recovery.phase !== "healthy"
        )
          return false;
        candidateAbortRef.current?.abort();
        candidateAbortRef.current = null;
        launchTransitionRef.current.cancel();
        recordManager.select(record.scope);
        installSelectedRecord(record);
        markTransitioning(false);
        return true;
      },
      resumeBinding: async () => {
        const authority = viewRecord?.runtime.currentAuthority();
        if (!viewRecord || !authority || !isViewCurrent())
          throw new Error("Open a confirmed Session first.");
        const { createResumeBinding } =
          await import("../resume/resume-binding.ts");
        if (!isViewCurrent())
          throw new Error(
            "History browsing authority changed. Reopen its controls.",
          );
        return createResumeBinding({
          manager: recordManager.engineFor(viewRecord)!,
          record: viewRecord,
          isSourceCurrent: isViewCurrent,
        });
      },
      historyBinding: async (applyPrefill) => {
        const authority = viewRecord?.runtime.currentAuthority();
        if (!viewRecord || !authority)
          throw new Error("Open a confirmed Session first.");
        const { createHistoryBinding } =
          await import("../history/history-binding.ts");
        if (
          recordManager.get(viewRecord.scope) !== viewRecord ||
          !viewRecord.runtime.isCurrent(authority)
        )
          throw new Error("History authority changed. Reopen its controls.");
        return createHistoryBinding({
          manager: recordManager.engineFor(viewRecord)!,
          record: viewRecord,
          ...(applyPrefill ? { applyPrefill } : {}),
        });
      },
      reviewBinding: async () => {
        const authority = viewRecord?.runtime.currentAuthority();
        if (!viewRecord || !authority)
          throw new Error("Open a confirmed Session first.");
        const { createNativeReviewBinding } =
          await import("../review/native-review.ts");
        if (
          recordManager.get(viewRecord.scope) !== viewRecord ||
          !viewRecord.runtime.isCurrent(authority)
        )
          throw new Error("Review authority changed. Reopen its controls.");
        return createNativeReviewBinding({
          manager: recordManager.engineFor(viewRecord)!,
          record: viewRecord,
        });
      },
      inspectionBinding: async () => {
        const authority = viewRecord?.runtime.currentAuthority();
        const epoch = authEpochRef.current;
        if (!viewRecord || !authority)
          throw new Error("Open a confirmed Session first.");
        const { createInspectionBinding } =
          await import("../inspection/inspection-binding.ts");
        if (
          recordManager.get(viewRecord.scope) !== viewRecord ||
          !viewRecord.runtime.isCurrent(authority)
        )
          throw new Error("Inspection authority changed. Reopen its controls.");
        return createInspectionBinding({
          manager: recordManager.engineFor(viewRecord)!,
          record: viewRecord,
          isSourceCurrent: () =>
            authEpochRef.current === epoch &&
            activeRuntime.currentAuthority()?.client === authority.client,
        });
      },
    },
  };
}

function launchProfileConfig(
  config: SessionConnectionInput,
  profileId: string,
): SessionConnectionInput {
  return {
    ...config,
    sessionId: bindWebSessionIdToProfile(config.sessionId, profileId),
    profileId,
  };
}

function normalizeConnectionInput(
  input: SessionConnectionInput,
): SessionConnectionInput {
  return {
    endpoint: input.endpoint.trim(),
    token: input.token,
    sessionId: input.sessionId.trim(),
    profileId: input.profileId.trim(),
    cwd: input.cwd.trim(),
  };
}

function isFatalSessionContractError(message: string): boolean {
  return (
    message.startsWith("Server protocol contract is incompatible") ||
    message.startsWith("Server lacks the coding Session contract") ||
    message === "session/hydrate returned an invalid result" ||
    // Hydrate landed on a different session than the one we opened —
    // retrying would loop forever on a routing fault (see issue #13).
    message === "session/hydrate returned another session" ||
    message.startsWith("session/hydrate returned session ")
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

function assertCodingSessionContract(
  capabilities: UiProtocolCapabilities | undefined,
): void {
  const missing = missingCodingSessionRequirements(capabilities);
  if (missing.length) {
    throw new Error(
      `Server lacks the coding Session contract: ${missing.join(", ")}`,
    );
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * A pooled-transport reconnect recovers EVERY managed record at once. A failure
 * in some record must not tear down the whole workspace: only a failure of the
 * record the user is currently on (`selectedSessionId`) is fatal. Every other
 * failure is a NON-FATAL notice listing the affected Sessions.
 */
export interface RecoverySurfacing {
  /** Fatal workspace error, or null when the live Session survived. */
  fatal: string | null;
  /** Non-fatal, dismissible notice, or null when nothing failed. */
  notice: { message: string; failedSessionIds: string[] } | null;
}

export function planRecoverySurfacing(
  results: ReadonlyArray<SessionRecordRecoveryResult>,
  selectedSessionId: string | null,
): RecoverySurfacing {
  const failed = results.filter((result) => result.state === "failed");
  if (!failed.length) return { fatal: null, notice: null };
  const selected = failed.find(
    (result) => result.sessionId === selectedSessionId,
  );
  const message = `${failed.length} Session(s) could not be recovered; their work has not been replayed. Reconnect or inspect the affected Session.`;
  // The Session the user is on can never be silently degraded — that is fatal.
  if (selected) return { fatal: message, notice: null };
  // Other Sessions failed while the live Session survived: stay usable.
  return {
    fatal: null,
    notice: { message, failedSessionIds: failed.map((f) => f.sessionId) },
  };
}
