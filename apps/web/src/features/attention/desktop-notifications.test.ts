import { describe, expect, it, vi } from "vitest";
import {
  DesktopNotifications,
  desktopEnvironment,
  type DesktopEnvironment,
} from "./desktop-notifications.ts";

function environment(
  overrides: Partial<DesktopEnvironment> = {},
): DesktopEnvironment {
  return {
    permission: () => "granted",
    requestPermission: vi.fn(async () => "granted" as const),
    create: vi.fn(() => ({ close: vi.fn(), onclick: null })),
    focus: vi.fn(),
    readPreference: () => false,
    savePreference: vi.fn(),
    ...overrides,
  };
}

describe("desktop notification consent", () => {
  it("does not prompt or notify without explicit opt-in even with existing permission", () => {
    const env = environment();
    const service = new DesktopNotifications(env);
    service.show("completed");
    expect(service.getSnapshot().enabled).toBe(false);
    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(env.create).not.toHaveBeenCalled();
  });

  it("persists only explicit granted consent and disables without another permission prompt", async () => {
    const env = environment();
    const service = new DesktopNotifications(env);
    const change = vi.fn();
    const unsubscribe = service.subscribe(change);
    await service.toggle();
    expect(service.getSnapshot()).toMatchObject({
      enabled: true,
      pending: false,
      error: false,
    });
    expect(env.savePreference).toHaveBeenLastCalledWith(true);
    service.show("waiting");
    expect(env.create).toHaveBeenCalledWith(
      expect.stringContaining("needs your input"),
    );
    await service.toggle();
    expect(env.savePreference).toHaveBeenLastCalledWith(false);
    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalled();
    unsubscribe();
  });

  it.each(["denied", "default"] as const)(
    "keeps %s permission readable and disabled",
    async (permission) => {
      const env = environment({ requestPermission: async () => permission });
      const service = new DesktopNotifications(env);
      await service.toggle();
      expect(service.getSnapshot()).toMatchObject({
        enabled: false,
        pending: false,
        error: true,
      });
      expect(service.getSnapshot().message).toContain("Tab counts still work");
      service.show("failed");
      expect(env.create).not.toHaveBeenCalled();
    },
  );

  it("supports unavailable browsers without requesting permission", async () => {
    const env = environment({ permission: () => null });
    const service = new DesktopNotifications(env);
    await service.toggle();
    expect(service.getSnapshot()).toMatchObject({
      enabled: false,
      available: false,
    });
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it("catches rejected permission and notification constructor failures", async () => {
    const rejected = new DesktopNotifications(
      environment({
        requestPermission: async () => {
          throw new Error("blocked");
        },
      }),
    );
    await rejected.toggle();
    expect(rejected.getSnapshot()).toMatchObject({
      enabled: false,
      pending: false,
      error: true,
    });
    const env = environment({
      readPreference: () => true,
      create: () => {
        throw new Error("unsupported constructor");
      },
    });
    const delivery = new DesktopNotifications(env);
    expect(() => delivery.show("failed")).not.toThrow();
    expect(delivery.getSnapshot().message).toContain("could not show");
    expect(env.savePreference).toHaveBeenCalledWith(false);
  });

  it("does not silently reuse saved consent after permission revocation", () => {
    const env = environment({
      permission: () => "denied",
      readPreference: () => true,
    });
    const service = new DesktopNotifications(env);
    service.show("completed");
    expect(service.getSnapshot().enabled).toBe(false);
    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(env.create).not.toHaveBeenCalled();
  });

  it("closes stale OS notices and focuses only on an explicit notification click", () => {
    const env = environment({ readPreference: () => true });
    const service = new DesktopNotifications(env);
    service.show("completed");
    const notice = vi.mocked(env.create).mock.results[0]!.value;
    expect(env.focus).not.toHaveBeenCalled();
    notice.onclick?.(new Event("click"));
    expect(env.focus).toHaveBeenCalledTimes(1);
    expect(notice.close).toHaveBeenCalledTimes(1);
    service.show("failed");
    const second = vi.mocked(env.create).mock.results[1]!.value;
    service.dispose();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("ignores permission that resolves after disposal and rejects duplicate clicks", async () => {
    let resolve!: (value: NotificationPermission) => void;
    const env = environment({
      requestPermission: vi.fn(
        () =>
          new Promise<NotificationPermission>((next) => {
            resolve = next;
          }),
      ),
    });
    const service = new DesktopNotifications(env);
    const pending = service.toggle();
    await service.toggle();
    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    service.dispose();
    resolve("granted");
    await pending;
    expect(env.savePreference).not.toHaveBeenCalled();
  });

  it("guards whole storage and Notification getters and keeps preferences token-free", () => {
    const blocked = Object.defineProperties(
      {},
      {
        localStorage: {
          get() {
            throw new Error("blocked");
          },
        },
        Notification: {
          get() {
            throw new Error("blocked");
          },
        },
      },
    ) as Window & typeof globalThis;
    const env = desktopEnvironment(blocked);
    expect(env.permission()).toBeNull();
    expect(env.readPreference()).toBe(false);
    expect(() => env.savePreference(true)).not.toThrow();
    const storage = { getItem: vi.fn(() => "true"), setItem: vi.fn() };
    const available = desktopEnvironment({
      localStorage: storage,
    } as unknown as Window & typeof globalThis);
    expect(available.readPreference()).toBe(true);
    available.savePreference(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      "octoscode-web:desktop-notifications",
      "false",
    );
  });
});
