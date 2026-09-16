import {
  PEER_METHODS,
  samePeerScope,
  parsePeerNotification,
  type PeerCommands,
  type PeerScope,
  type PeerPrepareParams,
  type PeerGatherParams,
} from "@octos-org/octoscode-client/peer-protocol";
import type { RpcNotification } from "@octos-org/octoscode-client/protocol";
import type {
  PeerManager,
  PeerManagerOptions,
  PeerManagerSnapshot,
  PeerSessionEvent,
} from "./peer-manager.ts";

type ManagerModule = Pick<typeof import("./peer-manager.ts"), "PeerManager">;
type Notification = Pick<RpcNotification, "method" | "params">;
const EMPTY: PeerManagerSnapshot = Object.freeze({
  peers: Object.freeze([]),
  blackboard: Object.freeze([]),
  prepareBusy: false,
  gatherBusy: false,
  prepareError: null,
  gatherError: null,
  prepareUncertain: false,
  dispatchRefusalKind: null,
});

/** Lazy construction is itself authority-bound; a cleared import cannot replay old events. */
export class LazyPeerManager {
  #options: PeerManagerOptions;
  #import: () => Promise<ManagerModule>;
  #commands: PeerCommands | null;
  #owner: PeerScope | null;
  #epoch = 0;
  #inner: PeerManager | null = null;
  #loading: Promise<PeerManager | null> | null = null;
  #buffered: Array<{ notification: Notification; owner: PeerScope }> = [];
  #snapshot = EMPTY;
  #unsubscribe: (() => void) | null = null;
  #listeners = new Set<() => void>();

  constructor(
    options: PeerManagerOptions,
    loader: () => Promise<ManagerModule> = () => import("./peer-manager.ts"),
  ) {
    this.#options = options;
    this.#commands = options.commands();
    this.#owner = this.#commands?.scope ?? null;
    this.#import = loader;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = (): PeerManagerSnapshot => this.#snapshot;
  snapshot = this.getSnapshot;
  #publish(snapshot: PeerManagerSnapshot): void {
    if (this.#snapshot === snapshot) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
  syncAuthority(): void {
    const next = this.#options.commands();
    if (next === this.#commands) return;
    this.#commands = next;
    if (next && !samePeerScope(this.#owner, next.scope)) {
      this.#owner = next.scope;
      this.clear();
      return;
    }
    this.#epoch += 1;
    this.#loading = null;
    this.#inner?.syncAuthority();
    if (next && !this.#inner && this.#buffered.length) void this.#load();
  }
  clear(): void {
    this.#epoch += 1;
    this.#buffered = [];
    this.#loading = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#inner?.clear();
    this.#inner = null;
    this.#owner = this.#commands?.scope ?? null;
    this.#publish(EMPTY);
  }
  #current(source: PeerCommands | null, epoch: number): boolean {
    return (
      !!source &&
      this.#epoch === epoch &&
      this.#commands === source &&
      this.#options.commands() === source
    );
  }
  #load(): Promise<PeerManager | null> {
    if (this.#inner) return Promise.resolve(this.#inner);
    if (this.#loading) return this.#loading;
    const source = this.#commands;
    if (!source) return Promise.resolve(null);
    const epoch = this.#epoch;
    const loading = this.#import()
      .then((module) => {
        if (!this.#current(source, epoch)) return null;
        const manager = new module.PeerManager(this.#options);
        this.#inner = manager;
        this.#unsubscribe = manager.subscribe(() =>
          this.#publish(manager.getSnapshot()),
        );
        const events = this.#buffered;
        this.#buffered = [];
        for (const { notification, owner } of events) {
          if (!this.#current(source, epoch)) break;
          if (!samePeerScope(owner, source.scope)) continue;
          manager.observeNotification(notification, source);
        }
        if (!this.#current(source, epoch)) return null;
        this.#publish(manager.getSnapshot());
        return manager;
      })
      .catch(() => {
        if (this.#current(source, epoch))
          this.#publish(
            Object.freeze({
              ...this.#snapshot,
              prepareError:
                "Could not load the peer interface. Retry the peer action.",
            }),
          );
        return null;
      })
      .finally(() => {
        if (this.#loading === loading) this.#loading = null;
      });
    this.#loading = loading;
    return loading;
  }
  observeNotification(
    notification: Notification,
    source: PeerCommands,
  ): boolean {
    this.syncAuthority();
    if (
      source !== this.#commands ||
      (notification.method !== PEER_METHODS.STAGED &&
        notification.method !== PEER_METHODS.CLOSED)
    )
      return false;
    const parsed = parsePeerNotification(notification, source.scope);
    if (
      !parsed ||
      (parsed.kind === "staged" &&
        (!source.capabilities.staged || this.#options.readOnly?.())) ||
      (parsed.kind === "closed" && !source.capabilities.closed)
    )
      return false;
    if (this.#inner)
      return this.#inner.observeNotification(notification, source);
    this.#buffered.push({
      notification: { method: notification.method, params: parsed.event },
      owner: source.scope,
    });
    void this.#load();
    return true;
  }
  /**
   * Forward one peer Session event to the inner manager's activity axis. The
   * `inner` instance owns every row, so an unloaded module has nothing to
   * stamp and correctly reports false.
   */
  observeSessionEvent(event: PeerSessionEvent, source: PeerCommands): boolean {
    this.syncAuthority();
    if (source !== this.#commands) return false;
    return this.#inner?.observeSessionEvent(event, source) ?? false;
  }
  canPrepare(readOnly = this.#options.readOnly?.() ?? false): boolean {
    return (
      !readOnly &&
      !this.#options.readOnly?.() &&
      (this.#options.commands()?.capabilities.prepare ?? false)
    );
  }
  canGather(): boolean {
    return this.#options.commands()?.capabilities.gather ?? false;
  }
  /**
   * Stage ONE peer. A `null` settle is NOT silence: it means the lazy manager's
   * `#load()`/`#current` mismatch retired this authority mid-load, so the
   * staging was never confirmed. P2g (grant 3030) requires that outcome to reach
   * the panel, so the console's sink (`performStagedDispatch`) reads this `null`
   * as a typed `unknown` and renders it — the run-12 triage found this exact
   * settle being `void`-swallowed into invisibility.
   */
  async kickoff(params: PeerPrepareParams, options?: { readOnly: boolean }) {
    this.syncAuthority();
    // Preserve the form across module loading. The real manager performs the
    // complete validation/whitelist before dispatch and owns visible errors.
    const input = {
      ...params,
      ...(Array.isArray(params.names) ? { names: [...params.names] } : {}),
    };
    const source = this.#commands;
    const epoch = this.#epoch;
    const manager = await this.#load();
    return manager && this.#current(source, epoch)
      ? manager.kickoff(input, options)
      : null;
  }
  async gather(params: PeerGatherParams = {}) {
    this.syncAuthority();
    const source = this.#commands;
    const epoch = this.#epoch;
    const manager = await this.#load();
    return manager && this.#current(source, epoch)
      ? manager.gather(params)
      : null;
  }
  async retryOpen(identity: string): Promise<boolean> {
    this.syncAuthority();
    return this.#inner?.retryOpen(identity) ?? false;
  }
  acknowledgeClosed(identity: string): void {
    this.#inner?.acknowledgeClosed(identity);
  }
  /**
   * Forward the `/peer clear` roster prune (TUI parity 2500 §2). An unloaded
   * module has no rows to prune, so it correctly reports 0.
   */
  clearFinished(): number {
    this.syncAuthority();
    return this.#inner?.clearFinished() ?? 0;
  }
}
