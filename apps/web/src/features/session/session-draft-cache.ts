/**
 * Small LRU for unsent per-session composer text.
 *
 * Drafts are convenience state, not durable server state. Keeping the policy in
 * one bounded object prevents long-lived browser tabs from accumulating every
 * session id they have ever visited.
 */
export class SessionDraftCache {
  readonly #limit: number;
  readonly #drafts = new Map<string, string>();

  constructor(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("SessionDraftCache limit must be a positive integer");
    }
    this.#limit = limit;
  }

  get(sessionId: string): string | undefined {
    const value = this.#drafts.get(sessionId);
    if (value === undefined) return undefined;
    this.#drafts.delete(sessionId);
    this.#drafts.set(sessionId, value);
    return value;
  }

  set(sessionId: string, draft: string): void {
    if (!sessionId) return;
    this.#drafts.delete(sessionId);
    this.#drafts.set(sessionId, draft);
    while (this.#drafts.size > this.#limit) {
      const oldest = this.#drafts.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.#drafts.delete(oldest);
    }
  }

  clear(): void {
    this.#drafts.clear();
  }

  get size(): number {
    return this.#drafts.size;
  }
}
