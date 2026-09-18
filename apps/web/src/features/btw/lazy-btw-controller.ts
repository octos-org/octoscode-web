import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
} from "@octos-org/octoscode-client/protocol";
import type { BtwCommands } from "@octos-org/octoscode-client/btw";
import type { ActiveSessionAuthority } from "../session/active-session-runtime.ts";
import type { SessionRuntimeScope } from "../session/session-scope.ts";

type Authority = ActiveSessionAuthority<OctosUiClient>;

export interface BtwRecord {
  readonly scope: SessionRuntimeScope;
  readonly closed: boolean;
  readonly runtime: {
    currentAuthority(): Authority | null;
    isCurrent(authority: Authority): boolean;
    getSnapshot(): { phase: string; recovery: { phase: string } };
    subscribe(listener: () => void): () => void;
  };
}

export interface BtwAsideSnapshot {
  readonly requestId: number;
  readonly question: string;
  readonly state: "answering" | "answered" | "failed";
  readonly answer: string | null;
  readonly model: string | null;
  readonly error: string | null;
}

export type BtwAdmission =
  "accepted" | "empty" | "busy" | "unavailable" | "stale";

export interface BtwControllerOptions {
  record: BtwRecord;
  isRetained(record: BtwRecord): boolean;
  pooledClient(): OctosUiClient | null;
  /** Test seam; production uses the client's lazy native contract factory. */
  loadCommands?(authority: Authority): Promise<BtwCommands>;
}

interface Operation {
  requestId: number;
  authority: Authority;
  scope: Readonly<SessionRuntimeScope>;
  question: string;
}

const FAILED = "The aside could not be answered. Try again.";
const STALE =
  "The Session connection changed before the aside completed. Ask again when it is ready.";

/**
 * Small hot wrapper; parser/RPC code loads through client.btwCommands only on
 * demand. No Markdown, React, queue, global client, or transcript dependency.
 * Native TUI keeps one ephemeral aside per retained record, even off screen.
 */
export class LazyBtwController {
  readonly #options: BtwControllerOptions;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribe: () => void;
  #snapshot: BtwAsideSnapshot | null = null;
  #operation: Operation | null = null;
  #nextRequestId = 0;
  #disposed = false;

  constructor(options: BtwControllerOptions) {
    this.#options = options;
    this.#unsubscribe = options.record.runtime.subscribe(() => {
      const operation = this.#operation;
      if (operation && !this.#current(operation)) this.#fail(operation, STALE);
    });
  }

  getSnapshot = (): BtwAsideSnapshot | null => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Admission is synchronous so a rejected command need not consume a draft. */
  ask = (question: string): BtwAdmission => {
    if (this.#disposed) return "stale";
    if (typeof question !== "string" || !question.trim()) return "empty";
    const authority = this.#options.record.runtime.currentAuthority();
    if (!authority) return "stale";
    if (!supportsMethod(authority.capabilities, CORE_UI_METHODS.SESSION_BTW))
      return "unavailable";
    const operation: Operation = {
      requestId: ++this.#nextRequestId,
      authority,
      scope: Object.freeze({ ...this.#options.record.scope }),
      question: question.trim(),
    };
    if (!this.#current(operation)) return "stale";
    if (this.#snapshot?.state === "answering") return "busy";
    this.#operation = operation;
    this.#publish({
      requestId: operation.requestId,
      question: operation.question,
      state: "answering",
      answer: null,
      model: null,
      error: null,
    });
    // Captured record/authority precede BOTH lazy load and native provider RPC.
    void this.#run(operation);
    return "accepted";
  };

  /** Explicit dismissal also hides an answering aside; late answers stay hidden. */
  dismiss = (): boolean => {
    if (!this.#snapshot) return false;
    this.#operation = null;
    this.#publish(null);
    return true;
  };

  /** Call only after an ordinary prompt was actually admitted. */
  clearSettled = (): boolean =>
    this.#snapshot && this.#snapshot.state !== "answering"
      ? this.dismiss()
      : false;

  dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#operation = null;
    this.#publish(null);
    this.#listeners.clear();
  };

  #current(operation: Operation): boolean {
    const { record } = this.#options;
    const { authority, scope } = operation;
    const snapshot = record.runtime.getSnapshot();
    return (
      !this.#disposed &&
      !record.closed &&
      this.#options.isRetained(record) &&
      this.#options.pooledClient() === authority.client &&
      authority.client.status === "connected" &&
      record.runtime.isCurrent(authority) &&
      record.runtime.currentAuthority()?.capabilities ===
        authority.capabilities &&
      supportsMethod(authority.capabilities, CORE_UI_METHODS.SESSION_BTW) &&
      snapshot.phase === "ready" &&
      snapshot.recovery.phase === "healthy" &&
      record.scope.endpoint === scope.endpoint &&
      record.scope.workspaceRoot === scope.workspaceRoot &&
      record.scope.profileId === scope.profileId &&
      record.scope.sessionId === scope.sessionId &&
      record.scope.authorityEpoch === scope.authorityEpoch &&
      authority.sessionId === scope.sessionId &&
      authority.profileId === scope.profileId &&
      authority.cwd === scope.workspaceRoot &&
      authority.config.endpoint.trim() === scope.endpoint.trim()
    );
  }

  #owns(operation: Operation): boolean {
    return (
      this.#operation === operation &&
      this.#snapshot?.requestId === operation.requestId
    );
  }

  async #run(operation: Operation): Promise<void> {
    try {
      if (!this.#current(operation) || !this.#owns(operation)) {
        this.#fail(operation, STALE);
        return;
      }
      const commands = await (this.#options.loadCommands
        ? this.#options.loadCommands(operation.authority)
        : operation.authority.client.btwCommands(
            operation.scope.sessionId,
            operation.authority.capabilities!,
          ));
      if (!this.#current(operation) || !this.#owns(operation)) {
        this.#fail(operation, STALE);
        return;
      }
      if (commands.sessionId !== operation.scope.sessionId) throw new Error();
      const result = await commands.ask(operation.question);
      if (!this.#current(operation) || !this.#owns(operation)) {
        this.#fail(operation, STALE);
        return;
      }
      if (
        result.session_id !== operation.scope.sessionId ||
        !result.answer.trim()
      )
        throw new Error();
      this.#operation = null;
      this.#publish({
        requestId: operation.requestId,
        question: operation.question,
        state: "answered",
        answer: result.answer,
        model: result.model ?? null,
        error: null,
      });
    } catch {
      this.#fail(operation, this.#current(operation) ? FAILED : STALE);
    }
  }

  #fail(operation: Operation, error: string): void {
    if (!this.#owns(operation)) return;
    this.#operation = null;
    this.#publish({
      requestId: operation.requestId,
      question: operation.question,
      state: "failed",
      answer: null,
      model: null,
      error,
    });
  }

  #publish(snapshot: BtwAsideSnapshot | null): void {
    this.#snapshot = snapshot ? Object.freeze(snapshot) : null;
    for (const listener of this.#listeners) listener();
  }
}
