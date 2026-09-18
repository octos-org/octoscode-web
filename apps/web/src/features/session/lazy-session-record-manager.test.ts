import { describe, expect, it, vi } from "vitest";
import { OctosUiClient } from "@octos-org/octoscode-client";
import {
  SessionRecordManager,
  type SessionRecordManagerOptions,
} from "./session-record-manager.ts";
import { LazySessionRecordManager } from "./lazy-session-record-manager.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

class Client extends OctosUiClient {
  constructor() {
    super({ endpoint: "ws://127.0.0.1:1" });
  }
  override get status() {
    return "connected" as const;
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const config = (sessionId = "s1"): SessionConnectionInput => ({
  endpoint: "ws://127.0.0.1:1",
  token: "",
  cwd: "/repo",
  profileId: "dev",
  sessionId,
});
const scope = (sessionId = "s1") => ({
  endpoint: "ws://127.0.0.1:1",
  workspaceRoot: "/repo",
  profileId: "dev",
  sessionId,
  authorityEpoch: 1,
});

function setup(deferLoading = false) {
  let client = new Client(),
    epoch = 1;
  const callback = vi.fn();
  const options: SessionRecordManagerOptions<Client> = {
    pooledClient: () => client,
    authorityEpoch: () => epoch,
    onSelectedEvent: callback,
    onSelectedSnapshot: callback,
    onBackgroundActivity: callback,
    controllerDependencies: (scope, getClient) => ({
      client: getClient,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => false,
      canInterrupt: () => false,
      setTimeline: () => {},
      setConnectionError: () => {},
    }),
    cursorFor: () => undefined,
    validateServerCapabilities: () => {},
    validateSessionCapabilities: () => {},
  };
  const engines: SessionRecordManager<Client>[] = [];
  const opened = vi.fn();
  let openGate: Promise<void> | null = null;
  const factory = (dependencies: SessionRecordManagerOptions<Client>) => {
    const engine = new SessionRecordManager(dependencies);
    engines.push(engine);
    vi.spyOn(engine, "openOnRecord").mockImplementation(async (input) => {
      opened(input.sessionId);
      if (openGate) await openGate;
      return engine.ensure({
        endpoint: input.endpoint,
        workspaceRoot: input.cwd,
        profileId: input.profileId,
        sessionId: input.sessionId,
        authorityEpoch: dependencies.authorityEpoch(),
      });
    });
    return engine;
  };
  const module = deferred<typeof factory>();
  const loader = vi.fn(() =>
    deferLoading ? module.promise : Promise.resolve(factory),
  );
  const manager = new LazySessionRecordManager(options, loader);
  return {
    manager,
    loader,
    module,
    factory,
    engines,
    opened,
    callback,
    get client() {
      return client;
    },
    rotate() {
      client = new Client();
      epoch += 1;
    },
    deferOpen(promise: Promise<void> | null) {
      openGate = promise;
    },
  };
}

describe("lazy coding record engine boundary", () => {
  it("does not load the coding engine for shell reads, subscriptions, or reconnect with no records", async () => {
    const h = setup(),
      changed = vi.fn();
    const unsubscribe = h.manager.subscribe(changed);
    expect(h.manager.get(scope())).toBeNull();
    expect(h.manager.selected()).toBeNull();
    expect(h.manager.records()).toEqual([]);
    expect(h.manager.keyOf(scope())).toContain("s1");
    expect(
      await h.manager.recoverRecords(new AbortController().signal),
    ).toEqual([]);
    h.manager.suspendRecords();
    h.manager.evict(scope());
    expect(() => h.manager.ensure(scope())).toThrow("Open a coding Session");
    expect(h.loader).not.toHaveBeenCalled();
    h.manager.retireAll();
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("shares one deferred engine for simultaneous first session opens without selecting either", async () => {
    const h = setup(true);
    const first = h.manager.openOnRecord(
      config("s1"),
      h.client,
      new AbortController().signal,
    );
    const second = h.manager.openOnRecord(
      config("s2"),
      h.client,
      new AbortController().signal,
    );
    expect(h.loader).toHaveBeenCalledTimes(1);
    expect(h.opened).not.toHaveBeenCalled();
    h.module.resolve(h.factory);
    const [a, b] = await Promise.all([first, second]);
    expect(h.engines).toHaveLength(1);
    expect(h.manager.records()).toEqual([a, b]);
    expect(h.manager.selected()).toBeNull();
    expect(h.manager.engineFor(a)).toBe(h.engines[0]);
    h.manager.retireAll();
  });

  it("rejects an old client's pending load after same-endpoint reauthentication", async () => {
    const h = setup(true);
    const operation = h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    const rejected = expect(operation).rejects.toThrow("authority changed");
    h.rotate();
    h.module.resolve(h.factory);
    await rejected;
    expect(h.opened).not.toHaveBeenCalled();
    expect(h.manager.records()).toEqual([]);
    h.manager.retireAll();
  });

  it("retirement prevents an old import from constructing or replacing a new engine", async () => {
    const h = setup(true);
    const operation = h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    const rejected = expect(operation).rejects.toThrow("authority was retired");
    h.manager.retireAll();
    h.module.resolve(h.factory);
    await rejected;
    expect(h.engines).toHaveLength(0);
    const fresh = await h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    expect(h.engines).toHaveLength(1);
    expect(h.manager.engineFor(fresh)).toBe(h.engines[0]);
    h.manager.retireAll();
  });

  it("suspension invalidates a pending first open without changing semantic authority", async () => {
    const h = setup(true);
    const operation = h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    const rejected = expect(operation).rejects.toThrow("authority changed");
    h.manager.suspendRecords();
    h.module.resolve(h.factory);
    await rejected;
    expect(h.opened).not.toHaveBeenCalled();
    h.manager.retireAll();
  });

  it("cancels promptly during module loading and never opens after the module eventually arrives", async () => {
    const h = setup(true),
      abort = new AbortController();
    const operation = h.manager.openOnRecord(config(), h.client, abort.signal);
    const rejected = expect(operation).rejects.toThrow("cancelled");
    abort.abort();
    await rejected;
    h.module.resolve(h.factory);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.opened).not.toHaveBeenCalled();
    h.manager.retireAll();
  });

  it("keeps loaded records and their queue through suspension, and publishes eviction after deletion", async () => {
    const h = setup();
    const record = await h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    h.manager.select(record.scope);
    record.queue.enqueue({ turnId: "queued", text: "owned by this record" });
    const engine = h.manager.engineFor(record);
    h.manager.suspendRecords();
    expect(h.manager.engineFor(record)).toBe(engine);
    expect(record.queue.snapshot().active?.turnId).toBe("queued");
    const snapshots: number[] = [];
    const unsubscribe = h.manager.subscribe(() =>
      snapshots.push(h.manager.records().length),
    );
    h.manager.evict(record.scope);
    expect(snapshots.at(-1)).toBe(0);
    expect(h.manager.selected()).toBeNull();
    expect(h.manager.engineFor(record)).toBeNull();
    unsubscribe();
    h.manager.retireAll();
  });

  it("a retired engine's delayed open cannot publish or return records into a fresh owner", async () => {
    const h = setup(),
      gate = deferred<void>();
    h.deferOpen(gate.promise);
    const operation = h.manager.openOnRecord(
      config(),
      h.client,
      new AbortController().signal,
    );
    const rejected = expect(operation).rejects.toThrow("authority changed");
    await vi.waitFor(() => expect(h.opened).toHaveBeenCalledTimes(1));
    h.manager.retireAll();
    h.deferOpen(null);
    const fresh = await h.manager.openOnRecord(
      config("fresh"),
      h.client,
      new AbortController().signal,
    );
    h.callback.mockClear();
    gate.resolve();
    await rejected;
    expect(h.callback).not.toHaveBeenCalled();
    expect(h.manager.records()).toEqual([fresh]);
    expect(h.manager.engineFor(fresh)).toBe(h.engines[1]);
    h.manager.retireAll();
  });
});
