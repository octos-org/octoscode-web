import { describe, expect, it } from "vitest";
import {
  endedTurnIds,
  stepGroupIds,
  summarizeSteps,
  timelineRenderItems,
} from "./step-groups.ts";
import type { TimelineEntry } from "./entry-model.ts";

const step = (
  id: string,
  kind: "tool" | "reasoning",
  turnId: string,
  status: TimelineEntry["status"] = "complete",
): TimelineEntry => ({ id, kind, title: id, body: "", status, turnId });

const terminal = (turnId: string): TimelineEntry => ({
  id: `terminal:${turnId}`,
  kind: "system",
  title: "Turn complete",
  body: "",
  status: "complete",
  turnId,
});

describe("timelineRenderItems", () => {
  it("groups consecutive steps of an ended turn and keeps answers between groups", () => {
    const entries = [
      step("r1", "reasoning", "t1"),
      step("a", "tool", "t1"),
      {
        id: "answer",
        kind: "assistant",
        title: "Octos",
        body: "Done.",
        status: "complete",
        turnId: "t1",
      } satisfies TimelineEntry,
      step("b", "tool", "t1"),
      terminal("t1"),
    ];
    const items = timelineRenderItems(entries, endedTurnIds(entries));
    expect(items.map((item) => item.type)).toEqual([
      "steps",
      "entry",
      "entry",
      "summary",
    ]);
    expect(stepGroupIds(entries)).toEqual(["steps:r1"]);
  });

  it("never groups a live turn, a thinking-only run, or steps across turns", () => {
    const live = [step("r1", "reasoning", "t1"), step("a", "tool", "t1")];
    expect(
      timelineRenderItems(live, new Set()).map((item) => item.type),
    ).toEqual(["entry", "entry"]);
    const thinking = [
      step("r1", "reasoning", "t1"),
      step("r2", "reasoning", "t1"),
    ];
    expect(
      timelineRenderItems(thinking, new Set(["t1"])).map((item) => item.type),
    ).toEqual(["entry", "entry"]);
    const split = [step("a", "tool", "t1"), step("b", "tool", "t2")];
    expect(
      timelineRenderItems(split, new Set(["t1", "t2"])).map(
        (item) => item.type,
      ),
    ).toEqual(["entry", "entry"]);
  });
});

describe("summarizeSteps", () => {
  it("counts tools and failures and drops a zero duration", () => {
    expect(
      summarizeSteps([
        step("r1", "reasoning", "t1"),
        step("a", "tool", "t1", "error"),
        step("b", "tool", "t1"),
      ]),
    ).toEqual({ steps: 2, failed: 1, retried: 0, seconds: undefined });
    expect(
      summarizeSteps([step("a", "tool", "t1", "error")], new Set(["a"])),
    ).toMatchObject({ failed: 0, retried: 1 });
  });
});
