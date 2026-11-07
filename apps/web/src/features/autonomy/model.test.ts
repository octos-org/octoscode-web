import { describe, expect, it } from "vitest";
import {
  applyAutonomyNotification,
  resetAutonomyForSession,
  type AutonomyRuntimeState,
} from "./model.ts";
import type { AutonomyNotification } from "./client-contract.ts";

const GOAL = {
  profile_id: "dev",
  goal_id: "goal_01",
  objective: "Ship the parity slice",
  status: "active",
  token_budget: 300_000,
  tokens_used: 1_200,
  time_used_seconds: 45,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_500,
};

function goalUpdated(generation: number): AutonomyNotification {
  return {
    kind: "goal_updated",
    event: {
      session_id: "s1",
      goal: { ...GOAL, tokens_used: generation * 100 },
      transition_actor: "backend",
      generation,
    },
  };
}

describe("applyAutonomyNotification generation safety (#1959)", () => {
  it("drops a stale update — a late pre-clear update cannot resurrect the goal", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 5,
    };
    state = applyAutonomyNotification(state, goalUpdated(4), "s1");
    expect(state.goal?.tokens_used).toBe(1_200);
    expect(state.goalGeneration).toBe(5);
  });
});
