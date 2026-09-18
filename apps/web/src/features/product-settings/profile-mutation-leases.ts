/** Survives dialog unmount/Session switching; never contains credentials or drafts. */
export class ProfileMutationLeases {
  readonly #held = new Set<string>();
  readonly #changed: () => void;
  constructor(changed: () => void) {
    this.#changed = changed;
  }
  held(scope: string): boolean {
    return this.#held.has(scope);
  }
  acquire(scope: string): () => void {
    if (this.#held.has(scope))
      throw new Error("A Profile mutation is already pending");
    this.#held.add(scope);
    this.#changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#held.delete(scope);
      this.#changed();
    };
  }
}
