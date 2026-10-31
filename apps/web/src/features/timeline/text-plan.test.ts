import { describe, expect, it } from "vitest";
import { latestTextPlan, parseTextPlan } from "./text-plan.ts";
import type { TimelineEntry } from "./entry-model.ts";

describe("parseTextPlan", () => {
  it("reads the opening checklist and keeps the rest of the answer", () => {
    expect(
      parseTextPlan(
        "Plan:\n- [ ] Find the CSV\n- [x] Read it\n\nI'll start with the folder.",
      ),
    ).toEqual({
      items: [
        { title: "Find the CSV", done: false },
        { title: "Read it", done: true },
      ],
      rest: "I'll start with the folder.",
    });
  });

  it("accepts a Chinese or bold heading", () => {
    expect(parseTextPlan("计划：\n- [ ] 一\n- [ ] 二")?.items).toHaveLength(2);
    expect(parseTextPlan("**Plan:**\n- [ ] a\n- [ ] b")?.items).toHaveLength(2);
  });

  it("ignores ordinary answers and single-item lists", () => {
    expect(parseTextPlan("The plan is simple.\n- [ ] a\n- [ ] b")).toBeNull();
    expect(parseTextPlan("Plan:\n- [ ] only one")).toBeNull();
    expect(parseTextPlan("Plan:\nNo checklist here")).toBeNull();
  });
});

describe("latestTextPlan", () => {
  const plan: TimelineEntry = {
    id: "assistant:1",
    kind: "assistant",
    title: "Octos",
    body: "Plan:\n- [x] a\n- [ ] b",
    status: "complete",
    turnId: "turn-1",
    endedAtMs: 42,
  };

  it("shapes the newest checklist as a plan for the panel", () => {
    expect(latestTextPlan([plan], "session-1")).toEqual({
      ended: false,
      plan: {
        sessionId: "session-1",
        turnId: "turn-1",
        updatedAtMs: 42,
        items: [
          { id: "assistant:1:0", title: "a", status: "completed" },
          { id: "assistant:1:1", title: "b", status: "pending" },
        ],
      },
    });
  });

  it("marks the plan ended once its turn has a terminal", () => {
    const terminal: TimelineEntry = {
      id: "terminal:turn-1",
      kind: "system",
      title: "Turn complete",
      body: "",
      status: "complete",
      turnId: "turn-1",
    };
    expect(latestTextPlan([plan, terminal], "s")?.ended).toBe(true);
    expect(latestTextPlan([terminal], "s")).toBeNull();
  });
});
