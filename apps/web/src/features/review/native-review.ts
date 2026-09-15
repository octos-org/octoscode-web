import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type {
  SessionRecord,
  SessionRecordManager,
} from "../session/session-record-manager.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "../session/session-scope.ts";

export function nativeReviewSupported(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return (
    supportsMethod(capabilities, CORE_UI_METHODS.REVIEW_START) &&
    supportsFeature(capabilities, CORE_UI_FEATURES.REVIEW_START_V1)
  );
}

/**
 * The ONE typed reason native review is withheld in a given state. Every
 * withholding cause has its OWN literal, so a presentation shell can branch on
 * reason identity and a test can pin an exact state -> reason mapping. The
 * values live in one exported const map, so no caller has to match prose.
 */
export const NATIVE_REVIEW_BLOCK_REASONS = {
  /** The Session's confirmed RPC authority was replaced, closed, or evicted. */
  authorityChanged: "Review Session authority changed. Reopen native review.",
  /** The connected server does not advertise the review method AND feature. */
  capabilityUnsupported: "This server does not advertise native code review.",
  /** The Session is still recovering/connecting; no turn may be admitted yet. */
  sessionNotReady:
    "Wait for this Session to finish recovery before starting review.",
  /** A running or queued ordinary turn already owns the single turn slot. */
  sessionBusy:
    "Wait for this Session's active turn and queued prompts to settle before starting review.",
  /** A pending approval or user question must be resolved before review. */
  sessionPendingInteraction:
    "Wait for this Session's pending questions and approvals to settle before starting review.",
} as const;

export type NativeReviewBlockReason =
  (typeof NATIVE_REVIEW_BLOCK_REASONS)[keyof typeof NATIVE_REVIEW_BLOCK_REASONS];

export interface NativeReviewBinding {
  readonly scope: Readonly<SessionRuntimeScope>;
  readonly authorityKey: string;
  isCurrent(): boolean;
  subscribe(listener: () => void): () => void;
  /** A primitive snapshot stays referentially stable between record changes. */
  blockedReason(): string | null;
  /** Synchronous local admission, not a server ACK. Errors remain on the record. */
  start(prompt: string): string;
}

/** Native review is a server-owned workflow, distinct from the diff preview UI. */
export function createNativeReviewBinding({
  manager,
  record,
}: {
  manager: SessionRecordManager<OctosUiClient>;
  record: SessionRecord<OctosUiClient>;
}): NativeReviewBinding {
  const authority = record.runtime.currentAuthority();
  if (!authority)
    throw new Error("Open a confirmed Session before starting review.");
  const scope = Object.freeze({ ...record.scope });
  const { client, capabilities } = authority;
  const isCurrent = () => {
    const current = record.runtime.currentAuthority();
    return (
      manager.get(scope) === record &&
      !record.closed &&
      record.runtime.isCurrent(authority) &&
      client.status === "connected" &&
      current?.sessionId === scope.sessionId &&
      current.profileId === scope.profileId &&
      current.cwd === scope.workspaceRoot &&
      current.config.endpoint === scope.endpoint &&
      current.capabilities === capabilities
    );
  };
  // Idle-only admission. Each withholding cause returns its OWN typed reason;
  // the two busy causes stay distinct so a shell can tell "this Session is
  // mid-turn" from "a human must answer a question/approval first".
  const blockedReason = (): NativeReviewBlockReason | null => {
    if (!isCurrent()) return NATIVE_REVIEW_BLOCK_REASONS.authorityChanged;
    if (!nativeReviewSupported(capabilities))
      return NATIVE_REVIEW_BLOCK_REASONS.capabilityUnsupported;
    const state = record.runtime.getSnapshot();
    if (
      state.phase !== "ready" ||
      state.status !== "connected" ||
      state.recovery.phase !== "healthy"
    )
      return NATIVE_REVIEW_BLOCK_REASONS.sessionNotReady;
    const queue = record.controller.snapshot();
    if (queue.active || queue.pending.length)
      return NATIVE_REVIEW_BLOCK_REASONS.sessionBusy;
    if (record.interactions.current(scope))
      return NATIVE_REVIEW_BLOCK_REASONS.sessionPendingInteraction;
    return null;
  };
  /**
   * An admitted review is not yet dispatched: `startTurn` may still be awaiting
   * the lazy `historyCommands` factory. It marks the preflight UUID attempted,
   * but a transport suspended mid-dispatch DELIBERATELY clears that mark so a
   * never-sent lazy factory can retry on the same queue. That retry must not
   * resurrect a review admitted under an authority this record has since
   * replaced, closed, or evicted — the successor authority would receive
   * `review/start` for a stale selection. While the review is queued but not
   * yet accepted, watch the record's authority and retire it the moment our
   * admitting authority stops being current, so the retry path finds an empty
   * queue head and dispatches nothing.
   */
  let watchedReviewTurnId: string | null = null;
  let releaseAuthorityWatch: (() => void) | null = null;
  const stopAuthorityWatch = (): void => {
    const release = releaseAuthorityWatch;
    releaseAuthorityWatch = null;
    release?.();
  };
  const reviewTurnStillQueued = (turnId: string): boolean => {
    const snapshot = record.controller.snapshot();
    return (
      snapshot.active?.turnId === turnId ||
      snapshot.pending.some((turn) => turn.turnId === turnId)
    );
  };
  const watchAdmittedReview = (turnId: string): void => {
    stopAuthorityWatch();
    watchedReviewTurnId = turnId;
    releaseAuthorityWatch = record.runtime.subscribe(() => {
      const admitted = watchedReviewTurnId;
      if (!admitted || !reviewTurnStillQueued(admitted)) {
        watchedReviewTurnId = null;
        stopAuthorityWatch();
        return;
      }
      if (isCurrent()) return;
      watchedReviewTurnId = null;
      stopAuthorityWatch();
      if (reviewTurnStillQueued(admitted))
        record.controller.settleTurn(admitted, "failed");
    });
  };
  return {
    scope,
    authorityKey: JSON.stringify([
      sessionRuntimeScopeKey(scope),
      authority.generation,
    ]),
    isCurrent,
    subscribe: manager.subscribe,
    blockedReason,
    start(prompt) {
      const blocked = blockedReason();
      if (blocked) throw new Error(blocked);
      // TUI review_start_command: one UUID, optional trimmed prompt, idle only.
      // No fabricated default prompt, media, target, instructions, or reasoning.
      const turnId = crypto.randomUUID();
      if (
        !record.controller.enqueueTurn({
          kind: "review",
          turnId,
          text: prompt.trim(),
        })
      )
        throw new Error(
          "Native review could not be admitted. Check this Session's readiness and capabilities.",
        );
      watchAdmittedReview(turnId);
      return turnId;
    },
  };
}
