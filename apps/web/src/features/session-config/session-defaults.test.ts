import { describe, expect, it } from "vitest";
import {
  DEFAULTS_PREFERENCES_KEY,
  loadSessionDefaults,
  saveSessionDefaults,
  type SessionDefaults,
} from "./session-defaults.ts";
import type { StorageLike } from "../connection/preferences.ts";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

const VALID: SessionDefaults = {
  permissionMode: "workspace_write",
  network: "deny",
  sandbox: { enabled: true, networkAccess: false, readAllowPaths: [] },
};

describe("Settings › Defaults preferences (§4.4, §7 New-session defaults)", () => {
  it("round-trips a defaults draft through browser localStorage", () => {
    const storage = memoryStorage();
    saveSessionDefaults(VALID, storage);
    expect(loadSessionDefaults(storage)).toEqual(VALID);
  });

  it("survives an endpoint-scoped key without cross-origin bleed", () => {
    const storage = memoryStorage();
    saveSessionDefaults(VALID, storage, "https://a.example");
    expect(loadSessionDefaults(storage, "https://b.example")).toBeNull();
    expect(loadSessionDefaults(storage, "https://a.example")).toEqual(VALID);
  });

  it("fails closed on corrupt JSON (no defaults applied)", () => {
    const storage = memoryStorage({
      [DEFAULTS_PREFERENCES_KEY]: "{not json",
    });
    expect(loadSessionDefaults(storage)).toBeNull();
  });

  it("rejects an unknown permission mode rather than guessing", () => {
    const storage = memoryStorage({
      [DEFAULTS_PREFERENCES_KEY]: JSON.stringify({
        version: 1,
        permissionMode: "yolo",
        network: "deny",
        sandbox: { enabled: true, networkAccess: false, readAllowPaths: [] },
      }),
    });
    expect(loadSessionDefaults(storage)).toBeNull();
  });

  it("caps read_allow_paths to a bounded list", () => {
    const storage = memoryStorage();
    saveSessionDefaults(
      {
        ...VALID,
        sandbox: {
          enabled: true,
          networkAccess: false,
          readAllowPaths: Array.from({ length: 64 }, (_, i) => `/p/${i}`),
        },
      },
      storage,
    );
    const loaded = loadSessionDefaults(storage);
    expect(loaded?.sandbox.readAllowPaths.length).toBeLessThanOrEqual(16);
  });
});
