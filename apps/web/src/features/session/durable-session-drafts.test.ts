import { afterEach, describe, expect, it, vi } from "vitest";
import { evictDurableDraft } from "./durable-session-drafts.ts";

const SCOPE = `octoscode-web.draft.v1:${JSON.stringify(["http://localhost", "user"])}:`;

function memoryStorage(initial: Record<string, string>) {
  const values = { ...initial };
  const storage = {
    get length() {
      return Object.keys(values).length;
    },
    key(index: number) {
      return Object.keys(values)[index] ?? null;
    },
    getItem(key: string) {
      return values[key] ?? null;
    },
    setItem(key: string, value: string) {
      values[key] = String(value);
    },
    removeItem(key: string) {
      delete values[key];
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("evictDurableDraft", () => {
  it("removes the evicted draft from a healthy scope", () => {
    const key = `${SCOPE}${JSON.stringify(["/w", "_main", "s-0"])}`;
    const values = memoryStorage({
      [key]: JSON.stringify("old draft"),
      [`${SCOPE}${JSON.stringify(["/w", "_main", "s-1"])}`]:
        JSON.stringify("kept draft"),
    });
    expect(
      evictDurableDraft(SCOPE, JSON.stringify(["/w", "_main", "s-0"])),
    ).toBe(true);
    expect(values[key]).toBeUndefined();
    expect(Object.values(values)).toEqual([JSON.stringify("kept draft")]);
  });

  it("refuses to remove anything from a scope a save would fail in", () => {
    const key = `${SCOPE}${JSON.stringify(["/w", "_main", "s-0"])}`;
    const values = memoryStorage({
      [key]: JSON.stringify("old draft"),
      [`${SCOPE}broken`]: "not-json{",
    });
    expect(
      evictDurableDraft(SCOPE, JSON.stringify(["/w", "_main", "s-0"])),
    ).toBe(false);
    expect(values[key]).toBe(JSON.stringify("old draft"));
  });
});
