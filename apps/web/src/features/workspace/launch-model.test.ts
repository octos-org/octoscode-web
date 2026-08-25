import { describe, expect, it } from "vitest";
import { codingSessionIdForProfile } from "./launch-model.ts";

describe("Octoscode launch identity", () => {
  it("uses the same durable coding session key as the TUI", () => {
    expect(codingSessionIdForProfile("deepseek")).toBe(
      "deepseek:local:tui#coding",
    );
  });
});
