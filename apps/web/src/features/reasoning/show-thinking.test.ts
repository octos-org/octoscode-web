import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOW_THINKING,
  parseShowThinking,
  SHOW_THINKING_KEY as SHOW_THINKING_KEY_VALUE,
} from "./show-thinking.ts";
const SHOW_THINKING_KEY: string = SHOW_THINKING_KEY_VALUE;

function storage(initial: string | null = null) {
  const values = new Map(
    initial ? ([[SHOW_THINKING_KEY, initial]] as const) : [],
  );
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("show-thinking browser preference", () => {
  it("defaults ON (thinking folded, not hidden)", () => {
    expect(DEFAULT_SHOW_THINKING).toBe(true);
  });

  it("reads and writes the dedicated namespaced key", () => {
    const local = storage();
    expect(parseShowThinking(local.getItem(SHOW_THINKING_KEY))).toBe(true);
    local.setItem(SHOW_THINKING_KEY, "false");
    expect(parseShowThinking(local.getItem(SHOW_THINKING_KEY))).toBe(false);
    local.setItem(SHOW_THINKING_KEY, "true");
    expect(parseShowThinking(local.getItem(SHOW_THINKING_KEY))).toBe(true);
  });

  it("fails closed to ON for malformed saved input", () => {
    for (const raw of [null, "", "yes", "0", "null", "{}", '"true"']) {
      expect(parseShowThinking(raw)).toBe(true);
    }
  });

  it("uses a distinct key from the display preferences store", () => {
    expect(SHOW_THINKING_KEY).not.toBe("octoscode.web.display.v1");
    expect(SHOW_THINKING_KEY.startsWith("octoscode.web.")).toBe(true);
  });
});
