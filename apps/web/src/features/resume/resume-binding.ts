import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type SessionListEntry,
} from "@octos-org/octoscode-client/protocol";
import type {
  SessionRecord,
  SessionRecordManager,
} from "../session/session-record-manager.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "../session/session-scope.ts";

type Record = SessionRecord<OctosUiClient>;
export interface ResumeCandidate {
  readonly id: string;
  readonly messageCount: number;
  readonly title: string;
  readonly updatedAt?: string;
  readonly lastPrompt?: string;
  /**
   * The server reported a live turn in this session. Absent when the server
   * does not report the fact at all, which is NOT the same as idle — the row
   * then says nothing rather than implying the session is free.
   */
  readonly activeTurn?: boolean;
}
export interface ResumeConfirmation {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly profileId: string;
}
export interface ResumeBinding {
  readonly authorityKey: string;
  readonly scope: Readonly<SessionRuntimeScope>;
  isCurrent(): boolean;
  subscribe(listener: () => void): () => void;
  list(signal: AbortSignal): Promise<readonly ResumeCandidate[]>;
  blockedReason(candidate: ResumeCandidate): string | null;
  resume(
    candidate: ResumeCandidate,
    confirmation: ResumeConfirmation,
    signal: AbortSignal,
  ): Promise<Record>;
}

// rc11 types.rs:607. A channel-like first component is NOT a profile. Unknown
// future channels fail closed until the identity contract is updated.
const CHANNELS = new Set([
  "acp",
  "api",
  "cli",
  "dingtalk",
  "discord",
  "email",
  "feishu",
  "line",
  "local",
  "matrix",
  "qq-bot",
  "slack",
  "system",
  "telegram",
  "test",
  "twilio",
  "wechat",
  "wecom",
  "wecom-bot",
  "whatsapp",
]);
/** Core SessionKey::split_base_key, including channel registry and colon chat IDs. */
export function isFullSessionForProfile(
  sessionId: string,
  profileId: string,
): boolean {
  if (!sessionId || sessionId !== sessionId.trim() || /\p{Cc}/u.test(sessionId))
    return false;
  const hash = sessionId.indexOf("#");
  const base = hash < 0 ? sessionId : sessionId.slice(0, hash);
  const first = base.indexOf(":");
  const second = base.indexOf(":", first + 1);
  if (first < 1 || second < first + 2) return false;
  const profile = base.slice(0, first),
    channel = base.slice(first + 1, second),
    chat = base.slice(second + 1);
  return (
    profile === profileId &&
    !CHANNELS.has(profile) &&
    CHANNELS.has(channel) &&
    chat.length > 0 &&
    chat === chat.trim() &&
    (hash < 0 ||
      (sessionId.slice(hash + 1).trim().length > 0 &&
        sessionId.slice(hash + 1) === sessionId.slice(hash + 1).trim()))
  );
}

/** Read catalog rows as unverified hints, never as confirmed workspace records. */
export function createResumeBinding({
  manager,
  record,
  isSourceCurrent,
}: {
  manager: SessionRecordManager<OctosUiClient>;
  record: Record;
  isSourceCurrent(): boolean;
}): ResumeBinding {
  const authority = record.runtime.currentAuthority();
  if (!authority?.capabilities || !record.payload)
    throw new Error(
      "A confirmed source Session is required to browse history.",
    );
  const scope = Object.freeze({ ...record.scope });
  const { client, capabilities } = authority;
  const selectedAtOpen = manager.selected();
  const isCurrent = () =>
    isSourceCurrent() &&
    manager.get(scope) === record &&
    !record.closed &&
    manager.selected() === selectedAtOpen &&
    record.runtime.isCurrent(authority) &&
    client.status === "connected" &&
    record.runtime.getSnapshot().phase === "ready";
  const assertCurrent = (signal?: AbortSignal) => {
    if (signal?.aborted || !isCurrent())
      throw new Error("History browsing authority changed. Reopen the picker.");
  };
  assertCurrent();
  let readEpoch = 0;
  let opening = false;
  let known = new Map<string, ResumeCandidate>();
  const targetScope = (id: string): SessionRuntimeScope => ({
    ...scope,
    sessionId: id,
  });
  function conflict(id: string): boolean {
    return manager
      .records()
      .some(
        (other) =>
          other.scope.sessionId === id &&
          (other.scope.workspaceRoot !== scope.workspaceRoot ||
            other.scope.profileId !== scope.profileId ||
            other.scope.endpoint !== scope.endpoint ||
            other.scope.authorityEpoch !== scope.authorityEpoch),
      );
  }
  const blockedReason = (candidate: ResumeCandidate): string | null => {
    if (!isCurrent()) return "Source Session changed. Reopen history browsing.";
    if (known.get(candidate.id) !== candidate)
      return "Refresh the catalog before selecting this row.";
    if (conflict(candidate.id))
      return "This Session ID is already retained under another workspace or Profile. It cannot be rebound on the shared connection.";
    const existing = manager.get(targetScope(candidate.id));
    if (existing?.closed) return "This retained Session is closed.";
    if (existing?.payload) return null;
    if (existing)
      return "This Session is still opening. Wait for its existing preparation to finish before resuming it.";
    if (!isFullSessionForProfile(candidate.id, scope.profileId))
      return "This catalog ID does not identify a full Session in the captured Profile. An authoritative full ID is required; no Profile or channel will be guessed.";
    if (
      !supportsMethod(capabilities, CORE_UI_METHODS.SESSION_OPEN) ||
      !supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE)
    )
      return "The server does not advertise scoped Session opening and hydration.";
    return null;
  };
  return {
    scope,
    authorityKey: JSON.stringify([
      sessionRuntimeScopeKey(scope),
      authority.generation,
    ]),
    isCurrent,
    subscribe: manager.subscribe,
    async list(signal) {
      assertCurrent(signal);
      if (opening)
        throw new Error("Wait for the selected Session to finish opening.");
      if (
        !supportsMethod(capabilities, CORE_UI_METHODS.SESSION_LIST) ||
        !supportsFeature(
          capabilities,
          CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1,
        )
      )
        throw new Error(
          "Workspace-aware history listing is unavailable on this server.",
        );
      const epoch = ++readEpoch;
      known = new Map();
      const result = await client.listSessions({ cwd: scope.workspaceRoot });
      assertCurrent(signal);
      if (epoch !== readEpoch)
        throw new Error("A newer history listing replaced this request.");
      if (result.sessions.length > 10000)
        throw new Error("History catalog is too large to inspect safely.");
      const rows: ResumeCandidate[] = [];
      for (const entry of result.sessions) {
        if (known.has(entry.id)) {
          known = new Map();
          throw new Error(
            "The history catalog contains duplicate ambiguous IDs.",
          );
        }
        const row = catalogCandidate(entry);
        known.set(row.id, row);
        rows.push(row);
      }
      return Object.freeze(
        rows.sort((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        ),
      );
    },
    blockedReason,
    async resume(candidate, confirmation, signal) {
      assertCurrent(signal);
      if (opening) throw new Error("A history opening is already pending.");
      const reason = blockedReason(candidate);
      if (reason) throw new Error(reason);
      if (
        confirmation.sessionId !== candidate.id ||
        confirmation.workspaceRoot !== scope.workspaceRoot ||
        confirmation.profileId !== scope.profileId
      )
        throw new Error(
          "Confirm the exact Session, workspace and Profile before opening.",
        );
      if (!supportsMethod(capabilities, CORE_UI_METHODS.SESSION_HYDRATE))
        throw new Error(
          "Canonical history reading is unavailable on this server.",
        );
      opening = true;
      const expectedScope = targetScope(candidate.id);
      const prior = manager.get(expectedScope);
      // Reserve one nonselected, unconfirmed record identity for this explicit
      // opening. It cannot enter confirmed sidebar refs until open/hydrate.
      const destination = prior ?? manager.ensure(expectedScope);
      let opened: Record | null = null;
      const current = () =>
        !signal.aborted &&
        isCurrent() &&
        !conflict(candidate.id) &&
        known.get(candidate.id) === candidate &&
        manager.get(expectedScope) === destination;
      try {
        if (prior?.payload) {
          const targetAuthority = prior.runtime.currentAuthority();
          if (
            !targetAuthority ||
            !prior.runtime.isCurrent(targetAuthority) ||
            prior.runtime.getSnapshot().phase !== "ready"
          )
            throw new Error(
              "The retained Session must recover before it can be resumed.",
            );
          // Inspect existing history without reinstalling its live controller or queue.
          const history = await client.hydrateSession({
            session_id: candidate.id,
            include: ["messages"],
          });
          if (!current() || !prior.runtime.isCurrent(targetAuthority))
            throw new Error("History browsing authority changed.");
          if (
            history.session_id !== candidate.id ||
            !history.messages ||
            (candidate.messageCount > 0 && !history.messages.length)
          )
            throw new Error(
              "Historical identity was not resolved. The listed conversation was not resumed.",
            );
          return prior;
        }
        opened = await manager.openOnRecord(
          {
            endpoint: scope.endpoint,
            token: "",
            sessionId: candidate.id,
            profileId: scope.profileId,
            cwd: scope.workspaceRoot,
          },
          client,
          signal,
          current,
        );
        if (
          !current() ||
          sessionRuntimeScopeKey(opened.scope) !==
            sessionRuntimeScopeKey(expectedScope)
        )
          throw new Error(
            "History browsing authority changed before confirmation.",
          );
        const history = opened.payload?.hydrated;
        if (
          !history ||
          history.session_id !== candidate.id ||
          !history.messages ||
          (candidate.messageCount > 0 && !history.messages.length)
        )
          throw new Error(
            "Historical identity was not resolved. The listed conversation was not resumed.",
          );
        return opened;
      } catch (reason) {
        // Never evict a pre-existing, selected, busy, nonempty or replaced record.
        if (
          !prior &&
          manager.get(expectedScope) === destination &&
          !destination.selected &&
          !destination.payload?.hydrated.messages?.length &&
          !destination.queue.snapshot().active &&
          !destination.queue.snapshot().pending.length &&
          !destination.timeline.some((entry) => entry.kind !== "system") &&
          !destination.interactions.getSnapshot().approval &&
          !destination.interactions.getSnapshot().question &&
          !destination.payload?.hydrated.turns?.some(
            (turn) => turn.state === "active" || turn.state === "interrupting",
          ) &&
          !destination.payload?.hydrated.pending_approvals?.length &&
          !destination.payload?.hydrated.pending_questions?.length
        )
          manager.evict(expectedScope);
        throw reason;
      } finally {
        opening = false;
      }
    },
  };
}
function catalogCandidate(entry: SessionListEntry): ResumeCandidate {
  return Object.freeze({
    id: entry.id,
    messageCount: entry.message_count,
    title: entry.title ?? entry.id,
    ...(entry.updated_at ? { updatedAt: entry.updated_at } : {}),
    ...(entry.last_prompt ? { lastPrompt: entry.last_prompt } : {}),
    ...(typeof entry.active_turn === "boolean"
      ? { activeTurn: entry.active_turn }
      : {}),
  });
}
