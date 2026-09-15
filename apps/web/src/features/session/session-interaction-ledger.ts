import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  approvalResolutionId,
  isRecord,
  parseApprovalRequested,
  parseUserQuestionRequested,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type RpcNotification,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
} from "@octos-org/octoscode-client/protocol";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import { matchesSessionScope } from "./scope.ts";

type InteractionScope = Pick<SessionConnectionInput, "endpoint" | "sessionId">;
export type SessionInteractionKind = "approval" | "question";

export interface SessionInteractionRecord {
  kind: SessionInteractionKind;
  sessionId: string;
  endpoint: string;
  generation: number;
  turnId: string;
  requestId: string;
  title: string;
  unread: boolean;
  approval?: ApprovalRequested;
  question?: UserQuestionRequested;
}
export interface SessionInteractionSnapshot {
  approval: ApprovalRequested | null;
  question: UserQuestionRequested | null;
  busy: boolean;
  error: string | null;
}
export interface SessionInteractionResolution {
  decision?: ApprovalDecision;
  approvalScope?: ApprovalScope;
  clientNote?: string;
  answer?: UserQuestionAnswer;
  answers?: UserQuestionAnswer[];
}
export interface SessionInteractionClient {
  respondApproval(params: {
    session_id: string;
    approval_id: string;
    decision: ApprovalDecision;
    approval_scope?: ApprovalScope;
    client_note?: string;
  }): Promise<unknown>;
  respondUserQuestion(params: {
    session_id: string;
    question_id: string;
    answers: UserQuestionAnswer[];
    client_note?: string;
  }): Promise<unknown>;
}
export interface SessionInteractionLedgerOptions {
  authorityFor(sessionId: string): {
    generation: number;
    client: SessionInteractionClient;
    sessionId: string;
    capabilities?: UiProtocolCapabilities | undefined;
    ready?: boolean;
  } | null;
}
export class StaleInteractionGenerationError extends Error {
  constructor() {
    super(
      "This interaction no longer belongs to the current Session generation.",
    );
    this.name = "StaleInteractionGenerationError";
  }
}

/** The record's sole interaction authority, shared by the panel and Waiting badge. */
export class SessionInteractionLedger {
  readonly #options: SessionInteractionLedgerOptions;
  readonly #records = new Map<string, SessionInteractionRecord>();
  readonly #listeners = new Set<() => void>();
  #operation = 0;
  #busy = false;
  #error: string | null = null;
  #snapshot: SessionInteractionSnapshot = {
    approval: null,
    question: null,
    busy: false,
    error: null,
  };

  constructor(options: SessionInteractionLedgerOptions) {
    this.#options = options;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = (): SessionInteractionSnapshot => this.#snapshot;
  #publish(): void {
    const records = [...this.#records.values()];
    this.#snapshot = {
      approval: records.find((record) => record.approval)?.approval ?? null,
      question: records.find((record) => record.question)?.question ?? null,
      busy: this.#busy,
      error: this.#error,
    };
    for (const listener of this.#listeners) listener();
  }
  keyOf(config: InteractionScope): string {
    return JSON.stringify([config.endpoint.trim(), config.sessionId.trim()]);
  }
  #requestKey(record: SessionInteractionRecord): string {
    return JSON.stringify([
      this.keyOf(record),
      record.kind,
      record.turnId,
      record.requestId,
    ]);
  }
  #invalidate(): void {
    this.#operation += 1;
    this.#busy = false;
    this.#error = null;
  }
  /** Keep Waiting state while transport authority is unavailable. */
  suspendTransport(): void {
    this.#invalidate();
    this.#publish();
  }

  restoreFromHydrate(
    config: InteractionScope,
    generation: number,
    hydrated: { pending_approvals?: unknown[]; pending_questions?: unknown[] },
    options: { background: boolean },
  ): void {
    this.#invalidate();
    for (const [key, record] of this.#records) {
      if (this.keyOf(record) === this.keyOf(config)) this.#records.delete(key);
    }
    for (const params of hydrated.pending_approvals ?? []) {
      this.#observeNotification(
        config,
        generation,
        {
          jsonrpc: "2.0",
          method: CORE_UI_METHODS.APPROVAL_REQUESTED,
          params,
        },
        options,
      );
    }
    for (const params of hydrated.pending_questions ?? []) {
      this.#observeNotification(
        config,
        generation,
        {
          jsonrpc: "2.0",
          method: CORE_UI_METHODS.USER_QUESTION_REQUESTED,
          params,
        },
        options,
      );
    }
    this.#publish();
  }
  observe(
    config: InteractionScope,
    record: Omit<SessionInteractionRecord, "endpoint" | "sessionId" | "unread">,
    options: { background: boolean },
  ): void {
    this.#store(config, record, options);
    this.#publish();
  }
  #store(
    config: InteractionScope,
    observed: Omit<
      SessionInteractionRecord,
      "endpoint" | "sessionId" | "unread"
    >,
    options: { background: boolean },
  ): void {
    const record: SessionInteractionRecord = {
      ...structuredClone(observed),
      endpoint: config.endpoint,
      sessionId: config.sessionId,
      unread: options.background,
    };
    const key = this.#requestKey(record);
    const previous = this.#records.get(key);
    // Replayed observations of the same tuple cannot cancel its response.
    if (previous?.generation === record.generation) return;
    // A newer interaction for the same Session and kind supersedes the older
    // pending one: `resolve` re-checks record identity, so a late response to
    // the superseded record fails closed instead of dispatching.
    for (const [otherKey, other] of this.#records) {
      if (
        otherKey !== key &&
        other.kind === record.kind &&
        this.keyOf(other) === this.keyOf(record)
      ) {
        this.#records.delete(otherKey);
      }
    }
    this.#invalidate();
    this.#records.set(key, record);
  }
  observeNotification(
    config: InteractionScope,
    generation: number,
    notification: RpcNotification,
    options: { background: boolean },
  ): boolean {
    const changed = this.#observeNotification(
      config,
      generation,
      notification,
      options,
    );
    if (changed) this.#publish();
    return changed;
  }
  #observeNotification(
    config: InteractionScope,
    generation: number,
    notification: RpcNotification,
    options: { background: boolean },
  ): boolean {
    const capabilities = this.#options.authorityFor(
      config.sessionId,
    )?.capabilities;
    const approval = parseApprovalRequested(notification);
    if (
      approval &&
      approval.approvalId &&
      approval.turnId &&
      matchesSessionScope(
        config.sessionId,
        approval.sessionId,
        approval.topic,
      ) &&
      supportsMethod(capabilities, CORE_UI_METHODS.APPROVAL_RESPOND)
    ) {
      this.#store(
        config,
        {
          kind: "approval",
          generation,
          turnId: approval.turnId,
          requestId: approval.approvalId,
          title: approval.title,
          approval,
        },
        options,
      );
      return true;
    }
    const question = parseUserQuestionRequested(notification);
    if (
      question &&
      question.questionId &&
      question.turnId &&
      matchesSessionScope(
        config.sessionId,
        question.sessionId,
        question.topic,
      ) &&
      supportsMethod(capabilities, CORE_UI_METHODS.USER_QUESTION_RESPOND) &&
      supportsFeature(capabilities, CORE_UI_FEATURES.USER_QUESTION_V1)
    ) {
      this.#store(
        config,
        {
          kind: "question",
          generation,
          turnId: question.turnId,
          requestId: question.questionId,
          title: question.title,
          question,
        },
        options,
      );
      return true;
    }
    const approvalId = approvalResolutionId(notification);
    const params = notification.params;
    if (
      approvalId &&
      isRecord(params) &&
      typeof params.session_id === "string" &&
      matchesSessionScope(
        config.sessionId,
        params.session_id,
        typeof params.topic === "string" ? params.topic : undefined,
      )
    ) {
      for (const [key, record] of this.#records) {
        if (
          this.keyOf(record) === this.keyOf(config) &&
          record.kind === "approval" &&
          record.requestId === approvalId &&
          record.generation === generation &&
          (params.turn_id === undefined || params.turn_id === record.turnId)
        ) {
          this.#records.delete(key);
          this.#invalidate();
          return true;
        }
      }
    }
    return false;
  }
  settleTurn(config: InteractionScope, turnId: string): void {
    let changed = false;
    for (const [key, record] of this.#records) {
      if (
        this.keyOf(record) === this.keyOf(config) &&
        record.turnId === turnId
      ) {
        this.#records.delete(key);
        changed = true;
      }
    }
    if (!changed) return;
    this.#invalidate();
    this.#publish();
  }
  current(config: InteractionScope): SessionInteractionRecord | null {
    return (
      [...this.#records.values()].find(
        (record) => this.keyOf(record) === this.keyOf(config),
      ) ?? null
    );
  }
  markRead(config: InteractionScope): void {
    let changed = false;
    for (const record of this.#records.values()) {
      if (this.keyOf(record) === this.keyOf(config) && record.unread) {
        record.unread = false;
        changed = true;
      }
    }
    if (changed) this.#publish();
  }
  waitingSnapshot(): ReadonlyArray<SessionInteractionRecord> {
    return [...this.#records.values()];
  }

  respondApproval = async (
    decision: ApprovalDecision,
    scope?: ApprovalScope,
    note?: string,
  ): Promise<void> => {
    const record = [...this.#records.values()].find(
      (pending) => pending.approval,
    );
    if (!record || this.#busy) return;
    await this.#respond(record, {
      decision,
      ...(scope ? { approvalScope: scope } : {}),
      ...(note ? { clientNote: note } : {}),
    });
  };
  respondQuestion = async (
    answers: UserQuestionAnswer[],
    note?: string,
  ): Promise<void> => {
    const record = [...this.#records.values()].find(
      (pending) => pending.question,
    );
    if (!record || this.#busy) return;
    await this.#respond(record, {
      answers,
      ...(note ? { clientNote: note } : {}),
    });
  };
  async #respond(
    record: SessionInteractionRecord,
    resolution: SessionInteractionResolution,
  ): Promise<void> {
    try {
      await this.resolve(record, resolution);
    } catch (reason) {
      // Resolution owns async errors; stale preflight failures have no RPC.
      if (
        reason instanceof StaleInteractionGenerationError &&
        this.#records.get(this.#requestKey(record)) === record
      ) {
        this.#error = reason.message;
        this.#publish();
      }
    }
  }
  async resolve(
    record: SessionInteractionRecord,
    resolution: SessionInteractionResolution,
  ): Promise<void> {
    const key = this.#requestKey(record);
    const authority = this.#options.authorityFor(record.sessionId);
    if (
      !authority ||
      authority.ready === false ||
      authority.sessionId !== record.sessionId ||
      authority.generation !== record.generation ||
      this.#records.get(key) !== record
    ) {
      throw new StaleInteractionGenerationError();
    }
    if (this.#busy) return;
    const operation = ++this.#operation;
    const isCurrent = () => {
      const latest = this.#options.authorityFor(record.sessionId);
      return (
        this.#operation === operation &&
        this.#records.get(key) === record &&
        latest?.client === authority.client &&
        latest.ready !== false &&
        latest.generation === authority.generation &&
        latest.sessionId === authority.sessionId
      );
    };
    this.#busy = true;
    this.#error = null;
    this.#publish();
    try {
      let result: unknown;
      if (record.kind === "approval") {
        if (!resolution.decision)
          throw new Error("Approval resolution requires a decision");
        result = await authority.client.respondApproval({
          // Split-wire requests carry the topic separately. Response RPCs do
          // not: use this exact, generation-checked owning SessionKey.
          session_id: record.sessionId,
          approval_id: record.requestId,
          decision: resolution.decision,
          ...(resolution.approvalScope
            ? { approval_scope: resolution.approvalScope }
            : {}),
          ...(resolution.clientNote
            ? { client_note: resolution.clientNote }
            : {}),
        });
      } else {
        const answers =
          resolution.answers ??
          (resolution.answer ? [resolution.answer] : null);
        if (!answers) throw new Error("Question resolution requires answers");
        result = await authority.client.respondUserQuestion({
          session_id: record.sessionId,
          question_id: record.requestId,
          answers: structuredClone(answers),
          ...(resolution.clientNote
            ? { client_note: resolution.clientNote }
            : {}),
        });
      }
      if (!isCurrent()) return;
      if (!isRecord(result) || result.accepted !== true)
        throw new Error("The server rejected the response");
      const responseId =
        record.kind === "approval" ? result.approval_id : result.question_id;
      if (responseId !== record.requestId)
        throw new Error("The server responded for another interaction");
      this.#records.delete(key);
    } catch (reason) {
      if (!isCurrent()) return;
      this.#error = reason instanceof Error ? reason.message : String(reason);
      throw reason;
    } finally {
      if (this.#operation === operation) {
        this.#busy = false;
        this.#publish();
      }
    }
  }
  clear(): void {
    this.#invalidate();
    this.#records.clear();
    this.#publish();
  }
}
