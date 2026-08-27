import { describe, expect, it } from "vitest";
import type { ConnectionDraft } from "./ConnectionPanel.tsx";
import {
  clearConnectionPreferences,
  loadAutoConnect,
  loadConnectionPreferences,
  saveConnectionPreferences,
  setAutoConnect,
  type StorageLike,
} from "./preferences.ts";

const defaults: ConnectionDraft = {
  endpoint: "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

describe("connection preferences", () => {
  it("keeps workspace intent durably and credentials in the current tab", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const value = {
      endpoint: "https://octos.example",
      token: "secret",
      sessionId: "web-session",
      profileId: "coding",
      cwd: "/srv/work/octoscode-web",
    };

    saveConnectionPreferences(value, durable, tab);

    expect(loadConnectionPreferences(defaults, durable, tab)).toEqual(value);
    expect(durable.getItem("octoscode-web.connection.v1")).not.toContain(
      "secret",
    );
    expect(
      loadConnectionPreferences(defaults, durable, new MemoryStorage()).token,
    ).toBe("");
  });

  it("fails closed to defaults for corrupt, oversized, or unavailable storage", () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem("octoscode-web.connection.v1", "not json");
    expect(
      loadConnectionPreferences(defaults, corrupt, new ThrowingStorage()),
    ).toEqual(defaults);

    const oversized = new MemoryStorage();
    oversized.setItem(
      "octoscode-web.connection.v1",
      JSON.stringify({
        version: 1,
        endpoint: "x".repeat(2_049),
        sessionId: "session",
        profileId: "profile",
        cwd: "/workspace",
      }),
    );
    expect(
      loadConnectionPreferences(defaults, oversized, new MemoryStorage()),
    ).toEqual(defaults);
  });

  it("clears all remembered intent and the tab auto-connect marker", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(
      { ...defaults, endpoint: "https://octos.example", token: "secret" },
      durable,
      tab,
    );
    setAutoConnect(tab, true);
    expect(loadAutoConnect(tab)).toBe(true);

    clearConnectionPreferences(durable, tab);

    expect(loadConnectionPreferences(defaults, durable, tab)).toEqual(defaults);
    expect(loadAutoConnect(tab)).toBe(false);
  });
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}
