const MAX_DRAFTS = 50;

export type SessionDraftRecord = [sessionKey: string, text: string];

/** Bound tab storage without truncating any user's draft. */
export function parseSessionDrafts(value: unknown): SessionDraftRecord[] {
  if (!Array.isArray(value) || value.length > MAX_DRAFTS) return [];
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
  readonly #drafts: Map<string, string>;

  constructor(initial: SessionDraftRecord[] = []) {
    this.#drafts = new Map(initial);
  }

  get(sessionId: string): string | undefined {
    return this.#drafts.get(sessionId);
  }

  set(sessionId: string, draft: string): boolean {
    if (!draft) {
      this.#drafts.delete(sessionId);
      return true;
    }
    if (!this.#drafts.has(sessionId) && this.#drafts.size >= MAX_DRAFTS)
      return false;
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
