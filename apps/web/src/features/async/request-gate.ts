/** Monotonic ownership token for latest-request-wins async state. */
export class RequestGate {
  #generation = 0;

  begin(): number {
    this.#generation += 1;
    return this.#generation;
  }

  invalidate(): void {
    this.#generation += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.#generation;
  }

  get current(): number {
    return this.#generation;
  }
}
