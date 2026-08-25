import { describe, expect, it } from "vitest";
import {
  matchesSessionScope,
  notificationMatchesSessionScope,
} from "./scope.ts";

describe("session scope matching", () => {
  it("accepts exact and base-plus-topic forms without crossing topics", () => {
    expect(
      matchesSessionScope(
        "profile:local:tui#coding",
        "profile:local:tui",
        "coding",
      ),
    ).toBe(true);
    expect(
      matchesSessionScope(
        "profile:local:tui#coding",
        "profile:local:tui#coding",
        "coding",
      ),
    ).toBe(true);
    expect(
      matchesSessionScope(
        "profile:local:tui#coding",
        "profile:local:tui#coding",
        "review",
      ),
    ).toBe(false);
    expect(
      matchesSessionScope(
        "profile:local:tui#coding",
        "other:local:tui",
        "coding",
      ),
    ).toBe(false);
  });

  it("fails closed on malformed explicit session ids", () => {
    expect(
      notificationMatchesSessionScope(
        { jsonrpc: "2.0", method: "warning", params: { session_id: 42 } },
        "profile:local:tui#coding",
      ),
    ).toBe(false);
    expect(
      notificationMatchesSessionScope(
        { jsonrpc: "2.0", method: "warning", params: {} },
        "profile:local:tui#coding",
      ),
    ).toBe(true);
  });
});
