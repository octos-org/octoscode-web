import { describe, expect, it } from "vitest";
import type { PlanUpdated } from "@octos-org/octoscode-client/protocol";
import {
  applyPlanUpdated,
  clearPlanForTurn,
  planCardVisible,
  planHeadline,
  planProgress,
  planStatusLabel,
  planUpdatedLabel,
} from "./plan.ts";

function plan(overrides: Partial<PlanUpdated> = {}): PlanUpdated {
  return {
    sessionId: "session-1",
    updatedAtMs: 1_000,
    items: [
      { id: "a", title: "Read the contract", status: "completed" },
      { id: "b", title: "Write the card", status: "in_progress" },
      { id: "c", title: "Run the checks", status: "pending", priority: "P2" },
    ],
    ...overrides,
  };
}

describe("plan replacement", () => {
  it("replaces the previous plan wholesale rather than merging items", () => {
    const first = plan();
    const second = plan({
      updatedAtMs: 2_000,
      items: [{ id: "z", title: "Only item", status: "pending" }],
    });
    expect(applyPlanUpdated(first, second, true)).toEqual(second);
  });

  it("keeps the state untouched when plan.todos.v1 is not advertised", () => {
    expect(applyPlanUpdated(null, plan(), false)).toBeNull();
  });
});

describe("turn scoping", () => {
  it("clears a plan when its authoring turn terminates", () => {
    expect(clearPlanForTurn(plan({ turnId: "turn-1" }), "turn-1")).toBeNull();
  });

  it("keeps a plan when another turn terminates", () => {
    const scoped = plan({ turnId: "turn-1" });
    expect(clearPlanForTurn(scoped, "turn-2")).toBe(scoped);
  });

  it("keeps a plan with no authoring turn — nothing keys its removal", () => {
    const unscoped = plan();
    expect(clearPlanForTurn(unscoped, "turn-1")).toBe(unscoped);
  });
});

describe("plan presentation", () => {
  it("counts each status", () => {
    expect(planProgress(plan().items)).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      pending: 1,
    });
  });

  it("prefers the server title, then the in-progress item", () => {
    expect(planHeadline(plan({ title: "Shipping the card" }))).toBe(
      "Shipping the card",
    );
    expect(planHeadline(plan())).toBe("Write the card");
    expect(planHeadline(plan({ title: "   " }))).toBe("Write the card");
  });

  it("falls back to the card's own label when nothing is in progress", () => {
    expect(
      planHeadline(
        plan({ items: [{ id: "a", title: "Done", status: "completed" }] }),
      ),
    ).toBeNull();
  });

  it("maps every status to a translatable label", () => {
    expect(planStatusLabel("completed")).toBe("Done");
    expect(planStatusLabel("in_progress")).toBe("In progress");
    expect(planStatusLabel("pending")).toBe("Pending");
  });

  it("reads a sub-minute update as just now and ages it in place", () => {
    expect(planUpdatedLabel(1_000, 30_000)).toEqual({
      source: "Updated just now",
    });
    expect(planUpdatedLabel(0, 5 * 60_000)).toEqual({
      source: "Updated {count}m ago",
      params: { count: 5 },
    });
    expect(planUpdatedLabel(0, 3 * 3_600_000)).toEqual({
      source: "Updated {count}h ago",
      params: { count: 3 },
    });
    expect(planUpdatedLabel(0, 50 * 3_600_000)).toEqual({
      source: "Updated {count}d ago",
      params: { count: 2 },
    });
  });
});

describe("fail-closed visibility", () => {
  it("hides the card without the feature, without a plan, or with no items", () => {
    expect(planCardVisible(plan(), false)).toBe(false);
    expect(planCardVisible(null, true)).toBe(false);
    expect(planCardVisible(plan({ items: [] }), true)).toBe(false);
    expect(planCardVisible(plan(), true)).toBe(true);
  });
});
