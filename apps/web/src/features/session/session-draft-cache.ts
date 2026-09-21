const MAX_DRAFTS = 50;

export type SessionDraftRecord = [sessionKey: string, text: string];

/** Bound tab storage without truncating any user's draft. */
export function parseSessionDrafts(value: unknown): SessionDraftRecord[] {
  if (!Array.isArray(value)) return [];
  const result: SessionDraftRecord[] = [];
  const seen = new Set<string>();
  let size = 0;
  // Iterate newest-first so eviction drops the oldest entries. A single
  // bad entry is skipped rather than poisoning the entire batch — a
  // corrupt key must not permanently lock out draft persistence.
  for (let i = value.length - 1; i >= 0; i--) {
    const entry = value[i];
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !entry[0] ||
      entry[0].length > 16_384 ||
      typeof entry[1] !== "string" ||
      seen.has(entry[0])
    )
      continue;
    const entrySize = entry[0].length + entry[1].length;
    if (size + entrySize > 524_288) continue;
    size += entrySize;
    seen.add(entry[0]);
    result.unshift([entry[0], entry[1]]);
  }
  return result;
}

export class SessionDraftCache {
  readonly #drafts: Map<string, string>;
  readonly #onEvict: ((sessionId: string) => void) | undefined;

  constructor(
    initial: SessionDraftRecord[] = [],
    onEvict?: (sessionId: string) => void,
  ) {
    this.#drafts = new Map(initial);
    this.#onEvict = onEvict;
  }

  get(sessionId: string): string | undefined {
    return this.#drafts.get(sessionId);
  }

  set(sessionId: string, draft: string): boolean {
    if (!draft) {
      this.#drafts.delete(sessionId);
      return true;
    }
    let oldest: string | undefined;
    if (!this.#drafts.has(sessionId) && this.#drafts.size >= MAX_DRAFTS) {
      // Evict the oldest entry to make room — saves must never permanently
      // lock out because the cache is full.
      oldest = this.#drafts.keys().next().value;
      if (oldest !== undefined) this.#drafts.delete(oldest);
    }
    this.#drafts.set(sessionId, draft);
    // Report the eviction only after the mutation settled, so the durable
    // copy can be removed too: otherwise a dropped draft would resurface on
    // the next reload.
    if (oldest !== undefined) this.#onEvict?.(oldest);
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
