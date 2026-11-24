/**
 * The dispatch gate for permission changes (T-0666, audit T-0623 P1).
 *
 * From the moment this tab sends `permission/profile/set` for a Session until
 * the server's receipt is verified AND a fresh readback lands, nothing may
 * start work in that Session: no `turn/start`, steer or review, from any entry
 * (keyboard, button, queue release). A SET whose outcome this tab cannot
 * confirm (timeout, lost or refused receipt, a different applied value, the
 * Session switched away, the transport replaced) leaves the Session closed
 * until the user re-reads the server's real state. Nothing here resends a SET.
 *
 * Keyed by canonical Session id, so a late answer for one Session never opens
 * another. Other tabs of this browser hear about a SET in flight and hold that
 * Session too, until the sender settles and they re-read. The protocol has no
 * permission revision or change notification, so another client entirely (a
 * terminal, another browser) stays outside what this can see.
 */
export type PermissionTransition =
  /** This tab's SET has no verified receipt and readback yet. */
  | "applying"
  /** The outcome is unknown: sending waits for a re-read of the server. */
  | "unconfirmed"
  /** Another tab of this browser is changing it. */
  | "elsewhere";

export interface PermissionSetTicket {
  readonly sessionId: string;
  readonly epoch: number;
}

export interface PermissionReadTicket {
  readonly sessionId: string;
  readonly epoch: number;
  /** Whether this read, once it lands, reopens the Session. */
  readonly settles: boolean;
}

export type PermissionChannelMessage =
  | { kind: "begin"; sessionId: string }
  | { kind: "settled"; sessionId: string; confirmed: boolean };

/** The slice of BroadcastChannel this uses. */
export interface PermissionChannel {
  postMessage(message: PermissionChannelMessage): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

export const PERMISSION_CHANNEL = "octoscode-web.permission-sets";

export function openPermissionChannel(): PermissionChannel | null {
  return typeof BroadcastChannel === "function"
    ? new BroadcastChannel(PERMISSION_CHANNEL)
    : null;
}

interface Entry {
  readonly state: PermissionTransition;
  readonly epoch: number;
  /** Any read that starts from now on settles it (not only an explicit one). */
  verified: boolean;
  /** This tab sent the SET, so the other tabs hear how it settled. */
  readonly local: boolean;
}

export class PermissionTransitions {
  #entries = new Map<string, Entry>();
  #epoch = 0;
  #listeners = new Set<(sessionId: string) => void>();
  #channel: PermissionChannel | null = null;
  #settledElsewhere = new Set<(sessionId: string) => void>();

  state(sessionId: string): PermissionTransition | null {
    return this.#entries.get(sessionId)?.state ?? null;
  }

  blocked(sessionId: string): boolean {
    return this.#entries.has(sessionId);
  }

  subscribe = (listener: (sessionId: string) => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Another tab's SET for a Session this tab may re-read now. */
  onSettledElsewhere(listener: (sessionId: string) => void): () => void {
    this.#settledElsewhere.add(listener);
    return () => this.#settledElsewhere.delete(listener);
  }

  /** Call synchronously, before the SET is sent: the Session closes now. */
  begin(sessionId: string): PermissionSetTicket {
    const epoch = this.#put(sessionId, "applying", false, true);
    this.#post({ kind: "begin", sessionId });
    return { sessionId, epoch };
  }

  /**
   * The receipt is the requested change, applied, for this Session. Still
   * closed: the readback started after this reopens it.
   */
  verified(ticket: PermissionSetTicket): void {
    const entry = this.#owned(ticket);
    if (entry) entry.verified = true;
  }

  /** The SET is over. Unless its readback already reopened it, it stays unknown. */
  settle(ticket: PermissionSetTicket): void {
    if (!this.#owned(ticket)) return;
    this.#put(ticket.sessionId, "unconfirmed", false, true);
    this.#post({
      kind: "settled",
      sessionId: ticket.sessionId,
      confirmed: false,
    });
  }

  /**
   * A permission read is starting. Only a read that starts after a verified
   * receipt, or one the user asked for, may reopen the Session; never one
   * that overlaps this tab's own SET in flight.
   */
  beginRead(sessionId: string, explicit = false): PermissionReadTicket {
    const entry = this.#entries.get(sessionId);
    return {
      sessionId,
      epoch: entry?.epoch ?? this.#epoch,
      settles: Boolean(
        entry && (entry.verified || (explicit && entry.state !== "applying")),
      ),
    };
  }

  /** The read's answer, for its own Session, is now on screen. */
  completeRead(ticket: PermissionReadTicket): void {
    const entry = this.#entries.get(ticket.sessionId);
    if (!entry || !ticket.settles || entry.epoch !== ticket.epoch) return;
    this.#entries.delete(ticket.sessionId);
    if (entry.local)
      this.#post({
        kind: "settled",
        sessionId: ticket.sessionId,
        confirmed: true,
      });
    this.#emit(ticket.sessionId);
  }

  /** Hear and tell the other tabs; returns the disconnect. */
  connect(channel: PermissionChannel | null): () => void {
    if (!channel) return () => undefined;
    this.#channel = channel;
    channel.onmessage = (event) => this.#receive(event.data);
    return () => {
      channel.onmessage = null;
      channel.close();
      if (this.#channel === channel) this.#channel = null;
    };
  }

  #receive(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const message = data as Partial<Record<string, unknown>>;
    const sessionId = message.sessionId;
    if (typeof sessionId !== "string" || !sessionId) return;
    if (message.kind === "begin") {
      this.#put(sessionId, "elsewhere", false, false);
      return;
    }
    if (message.kind !== "settled" || typeof message.confirmed !== "boolean")
      return;
    const entry = this.#entries.get(sessionId);
    // This tab's own SET, or nothing held here: not for this tab to settle.
    if (!entry || entry.local) return;
    this.#put(sessionId, "unconfirmed", message.confirmed, false);
    if (message.confirmed)
      for (const listener of this.#settledElsewhere) listener(sessionId);
  }

  #owned(ticket: PermissionSetTicket): Entry | null {
    const entry = this.#entries.get(ticket.sessionId);
    return entry?.local && entry.epoch === ticket.epoch ? entry : null;
  }

  #put(
    sessionId: string,
    state: PermissionTransition,
    verified: boolean,
    local: boolean,
  ): number {
    const epoch = ++this.#epoch;
    this.#entries.set(sessionId, { state, epoch, verified, local });
    this.#emit(sessionId);
    return epoch;
  }

  #post(message: PermissionChannelMessage): void {
    try {
      this.#channel?.postMessage(message);
    } catch {
      // A closed channel only loses the other tabs' hint; this tab's gate holds.
    }
  }

  #emit(sessionId: string): void {
    for (const listener of this.#listeners) listener(sessionId);
  }
}
