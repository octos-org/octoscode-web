import { describe, expect, it } from "vitest";
import { readThemePreference, saveThemePreference } from "./use-theme.ts";

function browserWith(initial: string | null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set("dsw-theme", initial);
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return { localStorage };
}

describe("theme preference storage", () => {
  it("accepts only supported persisted overrides", () => {
    expect(readThemePreference(browserWith("dark"))).toBe("dark");
    expect(readThemePreference(browserWith("light"))).toBe("light");
    for (const value of [null, "system", "Dark", "undefined", "{}", ""]) {
      expect(readThemePreference(browserWith(value))).toBe("system");
    }
  });

  it("persists an override and removes it to restore live OS following", () => {
    const browser = browserWith(null);
    saveThemePreference("dark", browser);
    expect(readThemePreference(browser)).toBe("dark");
    saveThemePreference("light", browser);
    expect(readThemePreference(browser)).toBe("light");
    saveThemePreference("system", browser);
    expect(readThemePreference(browser)).toBe("system");
    expect(browser.localStorage.length).toBe(0);
  });

  it("survives a blocked localStorage getter without touching other state", () => {
    const browser = {
      get localStorage(): Storage {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    };
    expect(readThemePreference(browser)).toBe("system");
    for (const theme of ["light", "dark", "system"] as const) {
      expect(() => saveThemePreference(theme, browser)).not.toThrow();
    }
  });

  it("survives getItem, setItem and removeItem failures independently", () => {
    const browser = browserWith("dark");
    browser.localStorage.getItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    expect(readThemePreference(browser)).toBe("system");

    browser.localStorage.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
    expect(() => saveThemePreference("light", browser)).not.toThrow();
    browser.localStorage.removeItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    expect(() => saveThemePreference("system", browser)).not.toThrow();
  });
});
