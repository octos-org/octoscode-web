import { describe, expect, it } from "vitest";
import type { StorageLike } from "./preferences.ts";
import {
  forgetRememberedToken,
  loadRememberedToken,
  rememberedTokenKey,
  rememberToken,
} from "./remembered-token.ts";

const ORIGIN = "http://127.0.0.1:50080";

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("per-device token memory", () => {
  it("round-trips one token per origin", () => {
    const storage = memoryStorage();
    expect(rememberToken(storage, ORIGIN, "paired-token")).toBe(true);
    expect(loadRememberedToken(storage, ORIGIN)).toBe("paired-token");
    expect(loadRememberedToken(storage, "http://127.0.0.1:18032")).toBeNull();
    expect(rememberedTokenKey(ORIGIN)).toBe(
      `octoscode-web.remembered-token.v1:${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("forgets only the named origin and proves it is gone", () => {
    const storage = memoryStorage();
    rememberToken(storage, ORIGIN, "one");
    rememberToken(storage, "http://localhost:18032", "two");
    expect(forgetRememberedToken(storage, ORIGIN)).toBe(true);
    expect(loadRememberedToken(storage, ORIGIN)).toBeNull();
    expect(loadRememberedToken(storage, "http://localhost:18032")).toBe("two");
  });

  it("reports failure instead of pretending a blocked store persisted", () => {
    const denied: StorageLike = {
      getItem: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    };
    expect(rememberToken(denied, ORIGIN, "paired-token")).toBe(false);
    expect(loadRememberedToken(denied, ORIGIN)).toBeNull();
    expect(forgetRememberedToken(denied, ORIGIN)).toBe(false);

    // The shape browserStorage() falls back to: every call succeeds, nothing
    // is kept. A write that cannot be read back is not persistence.
    const silent: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    expect(rememberToken(silent, ORIGIN, "paired-token")).toBe(false);
    expect(forgetRememberedToken(silent, ORIGIN)).toBe(true);
  });

  it("rejects an empty origin, an empty token, and a corrupt record", () => {
    const storage = memoryStorage();
    expect(rememberToken(storage, "  ", "paired-token")).toBe(false);
    expect(rememberToken(storage, ORIGIN, "")).toBe(false);
    expect(rememberToken(storage, ORIGIN, "x".repeat(16_385))).toBe(false);
    expect(loadRememberedToken(storage, "  ")).toBeNull();
    storage.map.set(rememberedTokenKey(ORIGIN), "{not json");
    expect(loadRememberedToken(storage, ORIGIN)).toBeNull();
    storage.map.set(
      rememberedTokenKey(ORIGIN),
      JSON.stringify({ version: 2, token: "future" }),
    );
    expect(loadRememberedToken(storage, ORIGIN)).toBeNull();
  });
});
