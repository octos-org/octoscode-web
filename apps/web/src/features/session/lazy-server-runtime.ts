import type {
  ActiveSessionAuthority,
  ActiveSessionClient,
  ActiveSessionRuntime,
  ActiveSessionRuntimeEvent,
  ActiveSessionRuntimeOptions,
  ActiveSessionRuntimeSnapshot,
} from "./active-session-runtime.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

type Factory<Client extends ActiveSessionClient> = (
  options: ActiveSessionRuntimeOptions<Client>,
) => ActiveSessionRuntime<Client>;

type RuntimeOptionsSource<Client extends ActiveSessionClient> =
  | ActiveSessionRuntimeOptions<Client>
  | (() => Promise<ActiveSessionRuntimeOptions<Client>>);

/** Load the existing socket/recovery owner only on explicit Connect or restore.
 * This facade owns admission and presentation before loading, never transport. */
export class LazyServerRuntime<Client extends ActiveSessionClient> {
  readonly #options: RuntimeOptionsSource<Client>;
  readonly #loader: () => Promise<Factory<Client>>;
  readonly #listeners = new Set<() => void>();
  readonly #events = new Set<
    (event: ActiveSessionRuntimeEvent<Client>) => void
  >();
  #factory: Promise<Factory<Client>> | null = null;
  #runtime: ActiveSessionRuntime<Client> | null = null;
  #intent = 0;
  #snapshot: ActiveSessionRuntimeSnapshot = emptySnapshot("idle");

  constructor(
    options: RuntimeOptionsSource<Client>,
    loader: () => Promise<Factory<Client>> = async () => {
      const { ActiveSessionRuntime } =
        await import("./active-session-runtime.ts");
      return (dependencies) => new ActiveSessionRuntime(dependencies);
    },
  ) {
    this.#options = options;
    this.#loader = loader;
  }

  getSnapshot = (): ActiveSessionRuntimeSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  subscribeEvents(
    listener: (event: ActiveSessionRuntimeEvent<Client>) => void,
  ): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }
  currentAuthority(): ActiveSessionAuthority<Client> | null {
    return this.#runtime?.currentAuthority() ?? null;
  }
  isCurrent(authority: ActiveSessionAuthority<Client>): boolean {
    return this.#runtime?.isCurrent(authority) ?? false;
  }

  async authenticate(
    input: SessionConnectionInput,
  ): Promise<ActiveSessionAuthority<Client> | null> {
    const intent = ++this.#intent;
    // Capture the caller's explicit connection intent before crossing the module boundary.
    // Credentials stay only in this pending call and the existing runtime, never snapshots.
    const config = { ...input };
    if (!this.#runtime) {
      this.#publish(emptySnapshot("connecting"));
      try {
        const factory = await this.#load();
        if (intent !== this.#intent) return null;
        const options =
          typeof this.#options === "function" ? await this.#options() : this.#options;
        if (intent !== this.#intent) return null;
        if (!this.#runtime) {
          const runtime = factory(options);
          this.#runtime = runtime;
          runtime.subscribe(() => this.#publish(runtime.getSnapshot()));
          runtime.subscribeEvents((event) => this.#emit(event));
        }
      } catch {
        if (intent !== this.#intent) return null;
        this.#publish({
          ...emptySnapshot("error"),
          error: "The connection runtime could not load. Try connecting again.",
        });
        // Never forward a module/provider exception containing endpoint credentials.
        throw new Error(
          "The connection runtime could not load. Try connecting again.",
        );
      }
    }
    if (intent !== this.#intent) return null;
    const authority = await this.#runtime.authenticate(config);
    return intent === this.#intent ? authority : null;
  }

  disconnect(): void {
    ++this.#intent;
    if (this.#runtime) this.#runtime.disconnect();
    else {
      this.#publish(emptySnapshot("disconnected"));
      this.#emit({ type: "session-cleared", reason: "disconnect" });
    }
  }

  #load(): Promise<Factory<Client>> {
    if (!this.#factory) {
      const pending = Promise.resolve().then(() => this.#loader());
      this.#factory = pending;
      void pending.catch(() => {
        if (this.#factory === pending) this.#factory = null;
      });
    }
    return this.#factory;
  }
  #publish(snapshot: ActiveSessionRuntimeSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
  #emit(event: ActiveSessionRuntimeEvent<Client>): void {
    for (const listener of this.#events) listener(event);
  }
}

function emptySnapshot(
  phase: "idle" | "connecting" | "disconnected" | "error",
): ActiveSessionRuntimeSnapshot {
  return {
    phase,
    status: phase === "disconnected" || phase === "connecting" ? phase : "idle",
    error: null,
    authenticated: false,
    serverCapabilities: undefined,
    session: null,
    recovery: { phase: "idle", sessionId: "", reconnectAttempt: 0 },
    diagnostics: [],
  };
}
