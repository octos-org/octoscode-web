/**
 * Synchronous ownership for the whole workspace-launch transition.
 *
 * A lease is acquired before `launch/resolve`, not when `session/open` starts.
 * Async resolve/open/onboarding callbacks may publish product state only while
 * their lease is current. The remembered decision deliberately survives the
 * temporary "opening" phase so a failed candidate can return to the exact
 * server-authored choice instead of inventing or losing launch state.
 */
export interface LaunchTransitionLease {
  readonly generation: number;
}

export interface LaunchTransitionSnapshot<Config, Decision> {
  readonly lease: LaunchTransitionLease;
  readonly config: Config;
  readonly decision: Decision | null;
}

export interface LaunchTransitionChoice<Config, Decision> {
  readonly config: Config;
  readonly decision: Decision;
}

export class LaunchTransitionCoordinator<Config, Decision> {
  private generation = 0;
  private active: LaunchTransitionSnapshot<Config, Decision> | null = null;

  /** Supersede every older resolve/open callback and own the new intent. */
  begin(config: Config): LaunchTransitionLease {
    const lease = Object.freeze({ generation: ++this.generation });
    this.active = { lease, config, decision: null };
    return lease;
  }

  isCurrent(lease: LaunchTransitionLease): boolean {
    return this.active?.lease === lease;
  }

  /**
   * Keep the authoritative resolve result for later choice/retry UI.
   * Returns false rather than allowing a superseded resolver to publish.
   */
  rememberDecision(lease: LaunchTransitionLease, decision: Decision): boolean {
    if (!this.isCurrent(lease) || !this.active) return false;
    this.active = { ...this.active, decision };
    return true;
  }

  snapshot(
    lease: LaunchTransitionLease,
  ): LaunchTransitionSnapshot<Config, Decision> | null {
    if (!this.isCurrent(lease) || !this.active) return null;
    return { ...this.active };
  }

  current(): LaunchTransitionSnapshot<Config, Decision> | null {
    return this.active ? { ...this.active } : null;
  }

  /** Return the state needed to restore awaiting-choice after open fails. */
  restoreChoice(
    lease: LaunchTransitionLease,
  ): LaunchTransitionChoice<Config, Decision> | null {
    const snapshot = this.snapshot(lease);
    if (!snapshot || snapshot.decision === null) return null;
    return { config: snapshot.config, decision: snapshot.decision };
  }

  /** Retire a successfully committed transition only if its lease still owns it. */
  commit(lease: LaunchTransitionLease): boolean {
    return this.retire(lease);
  }

  /** Retire a terminal failure that has no server decision to restore. */
  discard(lease: LaunchTransitionLease): boolean {
    return this.retire(lease);
  }

  private retire(lease: LaunchTransitionLease): boolean {
    if (!this.isCurrent(lease)) return false;
    this.active = null;
    return true;
  }

  /** Invalidate every callback belonging to the current transition. */
  cancel(): LaunchTransitionSnapshot<Config, Decision> | null {
    const cancelled = this.current();
    this.generation += 1;
    this.active = null;
    return cancelled;
  }
}
