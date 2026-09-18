import type { ActiveSessionClient } from "./active-session-runtime.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";
import type {
  SessionRecord,
  SessionRecordManager,
  SessionRecordManagerOptions,
  SessionRecordRecoveryResult,
} from "./session-record-manager.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "./session-scope.ts";

type Engine<Client extends ActiveSessionClient> = SessionRecordManager<Client>;
type Factory<Client extends ActiveSessionClient> = (
  options: SessionRecordManagerOptions<Client>,
) => Engine<Client>;

/** The authenticated shell needs no coding engine until an explicit Session
 * open. This facade defers that engine, not the app or pooled connection. */
export class LazySessionRecordManager<Client extends ActiveSessionClient> {
  readonly #options: SessionRecordManagerOptions<Client>;
  readonly #loader: () => Promise<Factory<Client>>;
  readonly #listeners = new Set<() => void>();
  #engine: Engine<Client> | null = null;
  #loading: Promise<Engine<Client>> | null = null;
  #unsubscribe: (() => void) | null = null;
  #generation = 0;
  #openEpoch = 0;

  constructor(
    options: SessionRecordManagerOptions<Client>,
    loader: () => Promise<Factory<Client>> = async () => {
      const { SessionRecordManager } =
        await import("./session-record-manager.ts");
      return (dependencies) => new SessionRecordManager(dependencies);
    },
  ) {
    this.#options = options;
    this.#loader = loader;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #notify = (): void => {
    for (const listener of this.#listeners) listener();
  };
  keyOf(scope: SessionRuntimeScope): string {
    return sessionRuntimeScopeKey(scope);
  }
  get(scope: SessionRuntimeScope): SessionRecord<Client> | null {
    return this.#engine?.get(scope) ?? null;
  }
  selected(): SessionRecord<Client> | null {
    return this.#engine?.selected() ?? null;
  }
  records(): ReadonlyArray<SessionRecord<Client>> {
    return this.#engine?.records() ?? [];
  }
  /** Nominal engine bridge for history/review: only a currently retained record qualifies. */
  engineFor(record: SessionRecord<Client>): Engine<Client> | null {
    return this.#engine?.get(record.scope) === record ? this.#engine : null;
  }
  /**
   * P2L (grant 3220 §2): the ADOPT-facing engine bridge. `engineFor` answers
   * null whenever the lazy engine is merely UNLOADED — which is the live NORMAL
   * case (connect -> workspace record -> acquire -> dispatch, with no prior
   * `/peer` staging that would have forced a load). Returning null there made
   * the adopt seam null and silently fail-closed an otherwise valid dispatch
   * (run 2850f: enabled console, held seat, ZERO wire frames). This variant
   * ENSURES the engine (awaiting the loader) and answers null ONLY when the
   * facade genuinely retains no record for this scope — a truly FOREIGN record,
   * which must still never be adopted.
   */
  async ensureEngineFor(
    record: SessionRecord<Client>,
  ): Promise<Engine<Client> | null> {
    if (!this.#engine) {
      try {
        await this.#load();
      } catch {
        return null;
      }
    }
    return this.engineFor(record);
  }
  ensure(scope: SessionRuntimeScope): SessionRecord<Client> {
    return this.#required().ensure(scope);
  }
  select(scope: SessionRuntimeScope): SessionRecord<Client> {
    return this.#required().select(scope);
  }
  #required(): Engine<Client> {
    if (!this.#engine)
      throw new Error(
        "Open a coding Session before accessing its record engine.",
      );
    return this.#engine;
  }

  #load(): Promise<Engine<Client>> {
    if (this.#engine) return Promise.resolve(this.#engine);
    if (this.#loading) return this.#loading;
    const generation = this.#generation;
    const loading = this.#loader()
      .then((factory) => {
        if (generation !== this.#generation)
          throw new Error(
            "The Session engine authority was retired while loading.",
          );
        let engine: Engine<Client>;
        const current = () =>
          this.#generation === generation && this.#engine === engine;
        engine = factory({
          ...this.#options,
          // Retired engines cannot commit late opens or publish into a new owner.
          pooledClient: () => (current() ? this.#options.pooledClient() : null),
          authorityEpoch: () =>
            current() ? this.#options.authorityEpoch() : Number.NaN,
          onSelectedEvent: (event) => {
            if (current()) this.#options.onSelectedEvent(event);
          },
          onSelectedSnapshot: () => {
            if (current()) this.#options.onSelectedSnapshot();
          },
          onBackgroundActivity: () => {
            if (current()) this.#options.onBackgroundActivity();
          },
        });
        this.#engine = engine;
        this.#unsubscribe = engine.subscribe(() => {
          if (current()) this.#notify();
        });
        return engine;
      })
      .finally(() => {
        if (this.#loading === loading) this.#loading = null;
      });
    this.#loading = loading;
    return loading;
  }

  async openOnRecord(
    config: SessionConnectionInput,
    client: Client,
    signal: AbortSignal,
    authorizeCommit: () => boolean = () => true,
  ): Promise<SessionRecord<Client>> {
    const generation = this.#generation,
      openEpoch = this.#openEpoch;
    const authority = this.#options.authorityEpoch();
    const input = { ...config };
    const assertCurrent = () => {
      if (
        signal.aborted ||
        !authorizeCommit() ||
        generation !== this.#generation ||
        openEpoch !== this.#openEpoch ||
        this.#options.authorityEpoch() !== authority ||
        this.#options.pooledClient() !== client ||
        client.status !== "connected"
      )
        throw new Error(
          "The pooled Session authority changed before opening completed.",
        );
    };
    assertCurrent();
    let abort = () => {};
    let engine: Engine<Client>;
    try {
      engine = await Promise.race([
        this.#load(),
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error("Session opening was cancelled."));
          signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
    assertCurrent();
    const record = await engine.openOnRecord(input, client, signal, () => {
      // The engine must fence its own publish/commit, not just our return.
      try {
        assertCurrent();
        return this.#engine === engine;
      } catch {
        return false;
      }
    });
    assertCurrent();
    if (this.#engine !== engine || engine.get(record.scope) !== record)
      throw new Error("The opened Session belongs to a retired engine.");
    return record;
  }

  suspendRecords(): void {
    this.#openEpoch += 1;
    this.#engine?.suspendRecords();
  }
  async recoverRecords(
    signal: AbortSignal,
  ): Promise<ReadonlyArray<SessionRecordRecoveryResult>> {
    const engine = this.#engine;
    if (!engine) return [];
    const generation = this.#generation;
    const result = await engine.recoverRecords(signal);
    return this.#engine === engine && generation === this.#generation
      ? result
      : [];
  }
  closeRetainedRecord(
    record: SessionRecord<Client>,
    message?: string,
  ): boolean {
    return (
      this.engineFor(record)?.closeRetainedRecord(record, message) ?? false
    );
  }
  evict(scope: SessionRuntimeScope): void {
    if (!this.#engine?.get(scope)) return;
    this.#engine.evict(scope);
    // Engine eviction notifies during teardown, before map deletion. Publish
    // once afterwards too so observers see the actual empty/selected state.
    this.#notify();
  }
  retireAll(): void {
    this.#generation += 1;
    this.#openEpoch += 1;
    const engine = this.#engine;
    this.#engine = null;
    this.#loading = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    engine?.retireAll();
    this.#notify();
  }
}
