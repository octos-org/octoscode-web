/**
 * Bounded storage for unsent per-session composer text.
 *
 * Drafts are convenience state, not durable server state. Keeping the policy in
 * one bounded object prevents long-lived browser tabs from accumulating every
 * session id they have ever visited.
 */
export type SessionDraftRecord = [sessionKey: string, text: string];

/** Bound tab storage without truncating any user's draft. */
export function parseSessionDrafts(value: unknown): SessionDraftRecord[] {
  if (!Array.isArray(value) || value.length > 50) return [];
  let size = 0;
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !entry[0] ||
      entry[0].length > 16_384 ||
      typeof entry[1] !== "string" ||
      !entry[1] ||
      seen.has(entry[0])
    )
      return [];
    size += entry[0].length + entry[1].length;
    if (size > 524_288) return [];
    seen.add(entry[0]);
  }
  return value.map(([key, text]) => [key, text]);
}

export class SessionDraftCache {
  readonly #limit: number;
  readonly #drafts = new Map<string, string>();

  constructor(limit = 50, initial: unknown = []) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("SessionDraftCache limit must be a positive integer");
    }
    this.#limit = limit;
    for (const [key, text] of parseSessionDrafts(initial)) this.set(key, text);
  }

  get(sessionId: string): string | undefined {
    const value = this.#drafts.get(sessionId);
    if (value === undefined) return undefined;
    this.#drafts.delete(sessionId);
    this.#drafts.set(sessionId, value);
    return value;
  }

  set(sessionId: string, draft: string): boolean {
    if (!sessionId) return false;
    if (!draft) {
      this.#drafts.delete(sessionId);
      return true;
    }
    if (!this.#drafts.has(sessionId) && this.#drafts.size >= this.#limit)
      return false;
    this.#drafts.delete(sessionId);
    this.#drafts.set(sessionId, draft);
    return true;
  }

  clear(): void {
    this.#drafts.clear();
  }

  snapshot(): SessionDraftRecord[] {
    return [...this.#drafts];
  }

  get size(): number {
    return this.#drafts.size;
  }
}
