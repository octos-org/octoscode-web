import { describe, expect, it, vi } from "vitest";
import {
  bindAutonomyNotifications,
  loadAutonomyCommands,
  type AutonomyClient,
} from "./binding.ts";
import {
  createSessionAutonomyCommands,
  type RpcNotification,
  type UiProtocolCapabilities,
} from "./client-contract.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [],
  supported_features: [],
  supported_notifications: [],
};
const commands = (sessionId: string) =>
  createSessionAutonomyCommands({ request: async () => null }, sessionId, caps);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("autonomy authority host binding", () => {
  it("does not publish a retired factory result or error into a replacement mount", async () => {
    const old = deferred<ReturnType<typeof commands>>();
    const fresh = deferred<ReturnType<typeof commands>>();
    const accept = vi.fn(),
      fail = vi.fn();
    const client: AutonomyClient = {
      autonomyCommands: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise),
      subscribeNotifications: () => () => {},
    };
    const cancel = loadAutonomyCommands(client, "s1", caps, accept, fail);
    cancel();
    loadAutonomyCommands(client, "s1", caps, accept, fail);
    old.resolve(commands("s1"));
    await flush();
    expect(accept).not.toHaveBeenCalled();
    fresh.resolve(commands("s1"));
    await flush();
    expect(accept).toHaveBeenCalledTimes(1);
    const rejected = deferred<ReturnType<typeof commands>>();
    const cancelError = loadAutonomyCommands(
      { ...client, autonomyCommands: () => rejected.promise },
      "s1",
      caps,
      accept,
      fail,
    );
    cancelError();
    rejected.reject(new Error("retired"));
    await flush();
    expect(fail).not.toHaveBeenCalled();
  });

  it("rejects a wrong-session factory without exposing raw errors", async () => {
    const accept = vi.fn(),
      fail = vi.fn();
    loadAutonomyCommands(
      {
        autonomyCommands: async () => commands("foreign"),
        subscribeNotifications: () => () => {},
      },
      "s1",
      caps,
      accept,
      fail,
    );
    await flush();
    expect(accept).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledExactlyOnceWith();
  });

  it("subscribes before refresh and never reactivates a retired callback", () => {
    const callbacks: Array<(event: RpcNotification) => void> = [];
    const order: string[] = [];
    const client: AutonomyClient = {
      autonomyCommands: async () => commands("s1"),
      subscribeNotifications: (callback) => {
        callbacks.push(callback);
        order.push("subscribe");
        return () => {
          order.push("unsubscribe");
        };
      },
    };
    const observed = vi.fn();
    const refresh = async () => {
      order.push("refresh");
    };
    const first = bindAutonomyNotifications(client, observed, refresh);
    expect(order).toEqual(["subscribe", "refresh"]);
    first();
    const second = bindAutonomyNotifications(client, observed, refresh);
    const event = {
      jsonrpc: "2.0" as const,
      method: "loop/fired",
      params: { session_id: "s1", loop_id: "l" },
    };
    callbacks[0]!(event);
    expect(observed).not.toHaveBeenCalled();
    callbacks[1]!(event);
    expect(observed).toHaveBeenCalledExactlyOnceWith(event);
    second();
    callbacks[1]!(event);
    expect(observed).toHaveBeenCalledTimes(1);
  });
});
