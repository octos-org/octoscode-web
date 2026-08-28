/**
 * Identifies the exact `turn/start` attempt that owns a deferred navigation.
 *
 * Leases are identity tokens: callers must pass the original object back to
 * `acceptDispatch`, `rejectDispatch`, or `cancelDispatch`. A completion for a
 * superseded request therefore cannot release a newer navigation intent.
 */
export interface NavigationDispatchLease {
  readonly generation: number;
  readonly authorityKey: string;
  readonly turnId: string;
}

export type NavigationIntentDecision<Intent> =
  | {
      readonly kind: "run-now";
      readonly intent: Intent;
    }
  | {
      readonly kind: "deferred";
      readonly lease: NavigationDispatchLease;
      readonly stage: "dispatch" | "ready";
      /** The previous click replaced by this one under latest-wins policy. */
      readonly replacedIntent: Intent | null;
    };

export interface ReleasedNavigationIntent<Intent> {
  readonly intent: Intent;
  readonly lease: NavigationDispatchLease;
}

export interface PendingNavigationIntentSnapshot<Intent> {
  readonly authorityKey: string | null;
  readonly dispatch: NavigationDispatchLease | null;
  readonly intent: Intent | null;
  readonly stage: "dispatch" | "ready" | null;
}

/**
 * Coordinates one browser navigation intent with an in-flight `turn/start`.
 *
 * The controller does not perform navigation itself. `request` returns an
 * immediate effect while idle, or latches the latest click while a start RPC
 * is dispatching. Only acceptance of that exact dispatch releases the latched
 * intent, and it can be released at most once.
 */
export class PendingNavigationIntentController<Intent> {
  #generation = 0;
  #authorityKey: string | null = null;
  #dispatch: NavigationDispatchLease | null = null;
  #pending: {
    readonly lease: NavigationDispatchLease;
    readonly intent: Intent;
  } | null = null;
  #ready: ReleasedNavigationIntent<Intent> | null = null;

  /**
   * Publish the current transport/session authority.
   *
   * Reconnects and Session adoption must use a different authority key (for
   * example `${transportGeneration}:${sessionId}`). Changing it retires all
   * dispatch and navigation state owned by the previous authority.
   */
  setAuthority(authorityKey: string | null): Intent | null {
    if (authorityKey === this.#authorityKey) return null;
    const retired = this.#pending?.intent ?? this.#ready?.intent ?? null;
    this.#generation += 1;
    this.#authorityKey = authorityKey;
    this.#dispatch = null;
    this.#pending = null;
    this.#ready = null;
    return retired;
  }

  /** Own a new start attempt before its RPC promise can yield. */
  beginDispatch(authorityKey: string, turnId: string): NavigationDispatchLease {
    if (!authorityKey) throw new Error("Navigation authority is required");
    if (!turnId) throw new Error("Turn id is required");
    if (authorityKey !== this.#authorityKey) {
      this.setAuthority(authorityKey);
    }
    const lease = Object.freeze({
      generation: ++this.#generation,
      authorityKey,
      turnId,
    });
    // A newer dispatch supersedes both the old completion and any click that
    // was specifically waiting for it.
    this.#dispatch = lease;
    this.#pending = null;
    this.#ready = null;
    return lease;
  }

  /**
   * Ask to navigate. Multiple clicks during one dispatch use latest-wins.
   */
  request(intent: Intent): NavigationIntentDecision<Intent> {
    const ready = this.#ready;
    if (ready) {
      const replacedIntent = ready.intent;
      this.#ready = { ...ready, intent };
      return {
        kind: "deferred",
        lease: ready.lease,
        stage: "ready",
        replacedIntent,
      };
    }
    const lease = this.#dispatch;
    if (!lease) return { kind: "run-now", intent };
    const replacedIntent =
      this.#pending?.lease === lease ? this.#pending.intent : null;
    this.#pending = { lease, intent };
    return {
      kind: "deferred",
      lease,
      stage: "dispatch",
      replacedIntent,
    };
  }

  /**
   * Accept a start attempt and atomically take its deferred navigation.
   * Repeated or stale completions return `null`.
   */
  acceptDispatch(
    lease: NavigationDispatchLease,
  ): ReleasedNavigationIntent<Intent> | null {
    if (this.#dispatch !== lease) return null;
    this.#dispatch = null;
    const pending = this.#pending?.lease === lease ? this.#pending : null;
    this.#pending = null;
    return pending ? { intent: pending.intent, lease } : null;
  }

  /** Retain an accepted navigation until durable recovery becomes ready. */
  holdUntilReady(released: ReleasedNavigationIntent<Intent>): boolean {
    if (
      released.lease.authorityKey !== this.#authorityKey ||
      this.#dispatch !== null ||
      this.#ready !== null
    ) {
      return false;
    }
    this.#ready = released;
    return true;
  }

  /** Release a recovery-held navigation only to the same authority. */
  releaseReady(authorityKey: string): ReleasedNavigationIntent<Intent> | null {
    const ready = this.#ready;
    if (!ready || ready.lease.authorityKey !== authorityKey) return null;
    this.#ready = null;
    return ready;
  }

  /** A rejected start cannot authorize navigation away from its Session. */
  rejectDispatch(lease: NavigationDispatchLease): boolean {
    return this.#retireDispatch(lease);
  }

  /** A locally cancelled or terminal-before-ACK start follows the same rule. */
  cancelDispatch(lease: NavigationDispatchLease): boolean {
    return this.#retireDispatch(lease);
  }

  /** Cancel only the queued navigation while the start attempt continues. */
  cancelIntent(): Intent | null {
    const pending = this.#pending;
    const ready = this.#ready;
    this.#pending = null;
    this.#ready = null;
    return pending?.intent ?? ready?.intent ?? null;
  }

  /** Clear all state, including on disconnect or product reset. */
  reset(): void {
    this.#generation += 1;
    this.#authorityKey = null;
    this.#dispatch = null;
    this.#pending = null;
    this.#ready = null;
  }

  snapshot(): PendingNavigationIntentSnapshot<Intent> {
    return {
      authorityKey: this.#authorityKey,
      dispatch: this.#dispatch,
      intent: this.#pending?.intent ?? this.#ready?.intent ?? null,
      stage: this.#pending ? "dispatch" : this.#ready ? "ready" : null,
    };
  }

  #retireDispatch(lease: NavigationDispatchLease): boolean {
    if (this.#dispatch !== lease) return false;
    this.#dispatch = null;
    if (this.#pending?.lease === lease) this.#pending = null;
    return true;
  }
}
