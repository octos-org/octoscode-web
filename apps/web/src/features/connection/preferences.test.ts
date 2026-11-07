import { describe, expect, it } from "vitest";
import type { ConnectionDraft } from "./ConnectionPanel.tsx";
import {
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
  it("keeps only origin durably and scopes credentials plus session to the tab", () => {
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
    expect(durable.getItem("octoscode-web.connection.v2")).toBe(
      '{"version":2,"endpoint":"https://octos.example"}',
    );
    expect([...tab.values.keys()]).toEqual(["octoscode-web.tab-connection.v3"]);
    expect(
      loadConnectionPreferences(defaults, durable, new MemoryStorage()),
    ).toEqual({
      ...defaults,
      endpoint: "https://octos.example",
    });
  });

  it("never remembers credentials pasted into an address or reconnects a replaced draft", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(defaults, durable, tab);
    setAutoConnect(tab, true);
    saveConnectionPreferences(
      { ...defaults, endpoint: "https://example.test?token=pasted-secret" },
      durable,
      tab,
    );
    expect([...durable.values.values()].join("")).not.toContain(
      "pasted-secret",
    );
    expect([...tab.values.values()].join("")).not.toContain("pasted-secret");
    expect(loadAutoConnect(tab)).toBe(false);
    expect(loadConnectionPreferences(defaults, durable, tab).endpoint).toBe(
      defaults.endpoint,
    );
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
