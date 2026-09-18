import { describe, expect, it } from "vitest";
import {
  matchesSessionScope,
  notificationMatchesSessionScope,
} from "./scope.ts";

describe("session scope matching", () => {
  const base = "coding:local:550e8400-e29b-41d4-a716-446655440000";

  it("does not treat a topicless UUID-shaped session as a topic wildcard", () => {
    expect(matchesSessionScope(base, base, "foreign")).toBe(false);
    expect(matchesSessionScope(base, base)).toBe(true);
    expect(matchesSessionScope(base, base, " \t ")).toBe(true);
    expect(matchesSessionScope(`${base}#review`, base, " review ")).toBe(true);
    expect(matchesSessionScope(`${base}#review`, `${base}#review`)).toBe(true);
    expect(matchesSessionScope(`${base}#review`, base)).toBe(false);
    expect(
      matchesSessionScope(
        `${base}#review#nested`,
        `${base}#review#nested`,
        "review#nested",
      ),
    ).toBe(true);
    expect(
      matchesSessionScope(`${base}#review#nested`, `${base}#review`, "nested"),
    ).toBe(false);
  });

  it.each([
    "approval/requested",
    "user_question/requested",
    "turn/completed",
    "projection/envelope",
  ])("rejects conflicting-topic %s even when the turn ID matches", (method) => {
    expect(
      notificationMatchesSessionScope(
        {
          jsonrpc: "2.0",
          method,
          params: {
            session_id: base,
            topic: "foreign",
            turn_id: "same-turn",
          },
        },
        base,
      ),
    ).toBe(false);
    expect(
      notificationMatchesSessionScope(
        {
          jsonrpc: "2.0",
          method,
          params: {
            session_id: base,
            topic: null,
            turn_id: "same-turn",
          },
        },
        base,
      ),
    ).toBe(true);
    expect(
      notificationMatchesSessionScope(
        {
          jsonrpc: "2.0",
          method,
          params: {
            session_id: base,
            topic: 42,
            turn_id: "same-turn",
          },
        },
        base,
      ),
    ).toBe(false);
  });

  it.each(["peer/staged", "peer/closed"])(
    "routes %s by its originating session, never the child payload topic",
    (method) => {
      for (const owner of [base, `${base}#master-topic`]) {
        const notification = {
          jsonrpc: "2.0" as const,
          method,
          params: { session_id: owner, topic: "peer-review" },
        };
        expect(notificationMatchesSessionScope(notification, owner)).toBe(true);
        expect(
          notificationMatchesSessionScope(notification, `${base}#peer-review`),
        ).toBe(false);
      }
      expect(
        notificationMatchesSessionScope(
          { jsonrpc: "2.0", method, params: { topic: "peer-review" } },
          base,
        ),
      ).toBe(false);
    },
  );
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
