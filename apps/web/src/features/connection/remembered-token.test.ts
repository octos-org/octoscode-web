import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRememberedTokens } from "./remembered-token.ts";

const PREFIX = "octoscode-web.remembered-token.v1:";

afterEach(() => vi.unstubAllGlobals());

describe("legacy credential cleanup", () => {
  it("removes saved tokens for every origin without changing preferences", () => {
    const values: Record<string, string> = {
      [`${PREFIX}http%3A%2F%2Flocalhost%3A50080`]: "legacy-token-one",
      [`${PREFIX}http%3A%2F%2Flocalhost%3A18032`]: "legacy-token-two",
      "octoscode-web.connection.v2": "connection-preferences",
    };
    const storage = {
      ...values,
      getItem(key: string) {
        return values[key] ?? null;
      },
      removeItem(key: string) {
        delete values[key];
      },
    };
    vi.stubGlobal("window", { localStorage: storage });
    expect(clearRememberedTokens()).toBe(true);
    expect(values).toEqual({
      "octoscode-web.connection.v2": "connection-preferences",
    });
  });

  it("reports when saved credentials could not be removed", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
    expect(clearRememberedTokens()).toBe(false);
    vi.stubGlobal("window", {
      localStorage: {
        [`${PREFIX}origin`]: "legacy-token",
        getItem: () => "legacy-token",
        removeItem: () => {},
      },
    });
    expect(clearRememberedTokens()).toBe(false);
  });
});
