/**
 * Tracks sessions that are currently being deleted or have already been
 * deleted in the current authenticated connection.
 *
 * A deleting or deleted session must not initiate new per-session reads
 * (`permission/profile/list`, `task/list`, `session/status/read`,
 * `profile/llm/list`, `session/driver/get`) or be reopened/selected while
 * `session/delete` is racing with startup or selection transitions.
 */
export class SessionDeletionFence {
  readonly #deleting = new Set<string>();
  readonly #deleted = new Set<string>();

  /** Mark a session as deleting. Returns true if this call entered the fence. */
  begin(sessionId: string): boolean {
    const id = sessionId.trim();
    if (!id || this.#deleted.has(id) || this.#deleting.has(id)) return false;
    this.#deleting.add(id);
    return true;
  }

  /** Permanently retire a session for the rest of this connection. */
  confirm(sessionId: string): void {
    const id = sessionId.trim();
    if (!id) return;
    this.#deleting.delete(id);
    this.#deleted.add(id);
  }

  /** Roll back an in-flight deletion attempt that did not delete the session. */
  abort(sessionId: string): void {
    const id = sessionId.trim();
    if (!id) return;
    this.#deleting.delete(id);
  }

  /** True while deleting or after confirmed deletion. */
  isRetired(sessionId: string | null | undefined): boolean {
    const id = sessionId?.trim();
    if (!id) return false;
    return this.#deleting.has(id) || this.#deleted.has(id);
  }

  /** Reset on disconnect or a new authenticated connection. */
  clear(): void {
    this.#deleting.clear();
    this.#deleted.clear();
  }
}
