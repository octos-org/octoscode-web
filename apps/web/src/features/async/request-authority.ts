/**
 * An async operation may publish product state only while it still owns the
 * latest request generation and the transport/session scope that started it.
 *
 * `finish` deliberately checks generation ownership only. When a transport is
 * replaced without a newer request, the stale operation must still be able to
 * remove the loading/busy flag it originally installed, while `isCurrent`
 * prevents its result or error from entering the new scope.
 */
export interface RequestAuthority<Client> {
  readonly generation: number;
  readonly client: Client;
  readonly sessionId: string;
}

export class RequestAuthorityGate<Client> {
  #generation = 0;
  #owner: RequestAuthority<Client> | null = null;

  begin(client: Client, sessionId: string): RequestAuthority<Client> {
    const authority = Object.freeze({
      generation: ++this.#generation,
      client,
      sessionId,
    });
    this.#owner = authority;
    return authority;
  }

  invalidate(): void {
    this.#generation += 1;
    this.#owner = null;
  }

  owns(authority: RequestAuthority<Client>): boolean {
    return this.#owner === authority;
  }

  isCurrent(
    authority: RequestAuthority<Client>,
    client: Client | null,
    sessionId: string,
  ): boolean {
    return (
      this.owns(authority) &&
      authority.client === client &&
      authority.sessionId === sessionId
    );
  }

  /** Retire the operation only if no newer request has taken ownership. */
  finish(authority: RequestAuthority<Client>): boolean {
    if (!this.owns(authority)) return false;
    this.#owner = null;
    return true;
  }
}
