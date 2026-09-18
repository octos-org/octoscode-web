import { describe, expect, it } from "vitest";
import { composeAgentSpawn } from "./agent-spawn.ts";

describe("native agents spawn prompt composition", () => {
  it("matches native English prompt and preserves multiline task content", () => {
    expect(composeAgentSpawn(3, "  Check tests\nand report evidence  ")).toBe(
      "Spawn 3 agent(s) to accomplish in parallel: Check tests\nand report evidence",
    );
  });
  it.each([0, -1, 1.5, NaN, Infinity, 4_294_967_296])(
    "rejects non-native count %s",
    (count) => {
      expect(composeAgentSpawn(count, "work")).toBeNull();
    },
  );
  it("accepts the native u32 boundary without silently applying a browser cap", () => {
    expect(composeAgentSpawn(4_294_967_295, "work")).toBe(
      "Spawn 4294967295 agent(s) to accomplish in parallel: work",
    );
    expect(composeAgentSpawn(1, "  \n ")).toBeNull();
  });
});
