import { describe, expect, it, vi } from "vitest";
import { OctosUiClient } from "@octos-org/octoscode-client";
import {
  ActiveSessionRuntime,
  type ActiveSessionRuntimeOptions,
} from "./active-session-runtime.ts";
import { LazyServerRuntime } from "./lazy-server-runtime.ts";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const config = (endpoint = "https://fixture.test"): SessionConnectionInput => ({
  endpoint,
  token: "synthetic-private-token",
  sessionId: "",
  profileId: "",
  cwd: "",
});
function setup() {
  const clients: OctosUiClient[] = [];
  const engines: ActiveSessionRuntime<OctosUiClient>[] = [];
  const createClient = vi.fn((input: SessionConnectionInput) => {
    const client = new OctosUiClient({ endpoint: input.endpoint });
    vi.spyOn(client, "status", "get").mockReturnValue("connected");
    vi.spyOn(client, "connect").mockResolvedValue();
    vi.spyOn(client, "disconnect").mockImplementation(() => {});
    vi.spyOn(client, "listConfigCapabilities").mockResolvedValue({
      capabilities: {
        version: {
          protocol: "octos-ui/v1alpha1",
          schema_version: 1,
          jsonrpc: "2.0",
        },
        capabilities_schema_version: 2,
        supported_notifications: [],
        supported_methods: [],
        supported_features: [],
      },
    });
    clients.push(client);
    return client;
  });
  const options: ActiveSessionRuntimeOptions<OctosUiClient> = {
    createClient,
    validateServerCapabilities: () => {},
    validateSessionCapabilities: () => {},
  };
  const factory = vi.fn((dependencies: typeof options) => {
    const engine = new ActiveSessionRuntime(dependencies);
    engines.push(engine);
    return engine;
  });
  const module = deferred<typeof factory>();
  const loader = vi.fn(() => module.promise);
  const runtime = new LazyServerRuntime(options, loader);
  return {
    runtime,
    module,
    loader,
    factory,
    createClient,
    clients,
    engines,
    options,
  };
}

describe("explicit connection runtime loading", () => {
  it("loads client construction only on explicit Connect and cancels stale dependency loads", async () => {
    const h = setup();
    const dependencies = deferred<typeof h.options>();
    const loadOptions = vi.fn(() => dependencies.promise);
    const runtime = new LazyServerRuntime(loadOptions, async () => h.factory);
    expect(loadOptions).not.toHaveBeenCalled();
    const first = runtime.authenticate(config("https://old.test"));
    await vi.waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(1));
    runtime.disconnect();
    dependencies.resolve(h.options);
    expect(await first).toBeNull();
    expect(h.createClient).not.toHaveBeenCalled();
    const active = await runtime.authenticate(config("https://new.test"));
    expect(active).not.toBeNull();
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.factory).toHaveBeenCalledTimes(1);
    runtime.disconnect();
  });
  it("does not load on landing-screen reads, subscriptions, or cleanup", () => {
    const h = setup(),
      changed = vi.fn(),
      event = vi.fn();
    const remove = h.runtime.subscribe(changed);
    const removeEvent = h.runtime.subscribeEvents(event);
    const initial = h.runtime.getSnapshot();
    expect(h.runtime.getSnapshot()).toBe(initial);
    expect(initial.phase).toBe("idle");
    expect(h.runtime.currentAuthority()).toBeNull();
    h.runtime.disconnect();
    expect(h.runtime.getSnapshot().phase).toBe("disconnected");
    expect(event).toHaveBeenCalledWith({
      type: "session-cleared",
      reason: "disconnect",
    });
    expect(h.loader).not.toHaveBeenCalled();
    expect(h.createClient).not.toHaveBeenCalled();
    remove();
    removeEvent();
    h.runtime.disconnect();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
  });

  it("publishes connecting synchronously and latest Connect wins a shared delayed load", async () => {
    const h = setup(),
      event = vi.fn();
    h.runtime.subscribeEvents(event);
    const first = h.runtime.authenticate(config("https://old.test"));
    expect(h.runtime.getSnapshot()).toMatchObject({
      phase: "connecting",
      authenticated: false,
      session: null,
    });
    const input = config("https://new.test");
    const second = h.runtime.authenticate(input);
    input.endpoint = "https://mutated.test";
    expect(JSON.stringify(h.runtime.getSnapshot())).not.toContain(
      "synthetic-private-token",
    );
    h.module.resolve(h.factory);
    expect(await first).toBeNull();
    const authority = await second;
    expect(h.loader).toHaveBeenCalledTimes(1);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.createClient.mock.calls[0]?.[0].endpoint).toBe("https://new.test");
    expect(authority).not.toBeNull();
    expect(h.runtime.currentAuthority()).toBe(authority);
    expect(h.runtime.isCurrent(authority!)).toBe(true);
    expect(h.runtime.getSnapshot()).toBe(h.engines[0]?.getSnapshot());
    expect(event).toHaveBeenCalledWith(
      expect.objectContaining({ type: "authenticated" }),
    );
    h.runtime.disconnect();
    expect(h.runtime.isCurrent(authority!)).toBe(false);
  });

  it("disconnect/unmount during import never creates a stale socket and later explicit restore works", async () => {
    const h = setup();
    const pending = h.runtime.authenticate(config());
    h.runtime.disconnect();
    h.module.resolve(h.factory);
    expect(await pending).toBeNull();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.runtime.getSnapshot().phase).toBe("disconnected");
    expect(await h.runtime.authenticate(config())).not.toBeNull();
    expect(h.factory).toHaveBeenCalledTimes(1);
    h.runtime.disconnect();
  });

  it("keeps one real runtime across reconnect intent and synchronously invalidates an established owner", async () => {
    const h = setup();
    h.module.resolve(h.factory);
    const old = await h.runtime.authenticate(config());
    const next = h.runtime.authenticate(config("https://replacement.test"));
    expect(h.runtime.isCurrent(old!)).toBe(false);
    expect(h.clients[0]?.disconnect).toHaveBeenCalledTimes(1);
    const current = await next;
    expect(h.runtime.isCurrent(current!)).toBe(true);
    expect(h.engines).toHaveLength(1);
    expect(h.clients).toHaveLength(2);
    h.runtime.disconnect();
    expect(h.clients[1]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a connection completing after disconnect", async () => {
    const h = setup(),
      gate = deferred<void>();
    h.module.resolve(h.factory);
    const initial = await h.runtime.authenticate(config());
    expect(initial).not.toBeNull();
    const spy = vi.spyOn(h.engines[0]!, "authenticate");
    spy.mockImplementationOnce(async () => {
      await gate.promise;
      return initial;
    });
    const pending = h.runtime.authenticate(config());
    h.runtime.disconnect();
    gate.resolve();
    expect(await pending).toBeNull();
    expect(h.runtime.currentAuthority()).toBeNull();
  });

  it("reports a generic module failure and retries only on another explicit Connect", async () => {
    const h = setup();
    const pending = h.runtime.authenticate(config());
    const rejected = expect(pending).rejects.toThrow(
      "connection runtime could not load",
    );
    h.module.reject(
      new Error("https://fixture.test?token=synthetic-private-token"),
    );
    await rejected;
    expect(h.runtime.getSnapshot().phase).toBe("error");
    expect(JSON.stringify(h.runtime.getSnapshot())).not.toContain(
      "synthetic-private-token",
    );
    expect(h.createClient).not.toHaveBeenCalled();
    h.loader.mockResolvedValueOnce(h.factory);
    expect(await h.runtime.authenticate(config())).not.toBeNull();
    expect(h.loader).toHaveBeenCalledTimes(2);
    h.runtime.disconnect();
  });
});
