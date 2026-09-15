import { describe, expect, it } from "vitest";
import {
  applyAutonomyNotification,
  EMPTY_AUTONOMY,
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

const LOOP = {
  loop_id: "loop_01",
  session_id: "s1",
  profile_id: "dev",
  prompt: "Check the deploy",
  mode: "fixed_interval",
  interval_seconds: 60,
  status: "active",
  expires_at_ms: 1_700_086_400_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const MONITOR = {
  monitor_id: "monitor_01",
  session_id: "s1",
  profile_id: "dev",
  name: "watch-build",
  argv: ["./scripts/watch.sh"],
  mode: "poll",
  interval_seconds: 30,
  batch_ms: 500,
  max_events_per_hour: 60,
  persistent: false,
  status: "active",
  fires_used: 0,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const AGENT = {
  agent_id: "agent_01",
  session_id: "s1",
  path: "/repo/src/app.ts",
  role: "implementer",
  nickname: "impl-1",
  backend_kind: "builtin",
  status: "running",
  profile_id: "dev",
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
  artifact_count: 0,
  artifacts: [],
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

function goalCleared(generation: number): AutonomyNotification {
  return {
    kind: "goal_cleared",
    event: {
      session_id: "s1",
      cleared: true,
      goal: null,
      transition_actor: "user",
      generation,
    },
  };
}

describe("applyAutonomyNotification generation safety (#1959)", () => {
  it("applies strictly-greater generations and updates the watermark", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 3,
    };
    state = applyAutonomyNotification(state, goalUpdated(4), "s1");
    expect(state.goal?.tokens_used).toBe(400);
    expect(state.goalGeneration).toBe(4);
  });

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

  it("a clear watermark blocks subsequent stale updates, not just updates", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 2,
    };
    state = applyAutonomyNotification(state, goalCleared(6), "s1");
    expect(state.goal).toBeNull();
    expect(state.goalGeneration).toBe(6);
    // A racing pre-clear update (generation 5) arrives late — must be dropped.
    state = applyAutonomyNotification(state, goalUpdated(5), "s1");
    expect(state.goal).toBeNull();
    expect(state.goalGeneration).toBe(6);
  });

  it("treats generation 0 as an unstamped legacy backend and always applies", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 9,
    };
    state = applyAutonomyNotification(state, goalUpdated(0), "s1");
    expect(state.goal).not.toBeNull();
  });

  it("keeps the goal when cleared=false (clear requested, not confirmed)", () => {
    const state = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 0,
    };
    const next = applyAutonomyNotification(
      state,
      {
        kind: "goal_cleared",
        event: {
          session_id: "s1",
          cleared: false,
          goal: null,
          transition_actor: "user",
          generation: 0,
        },
      },
      "s1",
    );
    expect(next.goal).toBe(GOAL);
  });
});

describe("applyAutonomyNotification multi-session isolation", () => {
  it("never lets a foreign-session event mutate the selected session", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      goal: GOAL,
      goalGeneration: 3,
    };
    const foreign: AutonomyNotification = {
      kind: "goal_updated",
      event: {
        session_id: "s2",
        goal: { ...GOAL, objective: "Other session's goal" },
        transition_actor: "backend",
        generation: 99,
      },
    };
    state = applyAutonomyNotification(state, foreign, "s1");
    expect(state.goal?.objective).toBe("Ship the parity slice");
    expect(state.goalGeneration).toBe(3);
    // But the background activity stays visible.
    expect(state.activity).toContain("s2");
  });

  it("isolates when the state's bound session no longer matches the owner", () => {
    // State bound to s1, owner now says s2 — the s1-scoped event is foreign
    // to the new selection, so it may not repaint; activity names the event
    // session, not the owner.
    const state = resetAutonomyForSession("s1");
    const next = applyAutonomyNotification(state, goalUpdated(7), "s2");
    expect(next.goal).toBeNull();
    expect(next.activity).toContain("s1");
  });

  it("foreign loop/monitor events update only the activity line", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      loops: [LOOP],
      monitors: [MONITOR],
    };
    state = applyAutonomyNotification(
      state,
      {
        kind: "loop_updated",
        event: {
          session_id: "s2",
          loop: { ...LOOP, session_id: "s2", loop_id: "loop_99" },
        },
      },
      "s1",
    );
    expect(state.loops.map((entry) => entry.loop_id)).toEqual(["loop_01"]);
    state = applyAutonomyNotification(
      state,
      {
        kind: "monitor_fired",
        event: {
          session_id: "s2",
          monitor_id: "monitor_99",
          line_count: 3,
          fired_at_ms: 1,
        },
      },
      "s1",
    );
    expect(state.monitors[0]?.fires_used).toBe(0);
    expect(state.activity).toContain("s2");
  });
});

describe("applyAutonomyNotification owning-session updates", () => {
  it("upserts, replaces, and removes loops", () => {
    let state: AutonomyRuntimeState = resetAutonomyForSession("s1");
    state = applyAutonomyNotification(
      state,
      { kind: "loop_updated", event: { session_id: "s1", loop: LOOP } },
      "s1",
    );
    expect(state.loops).toHaveLength(1);
    state = applyAutonomyNotification(
      state,
      {
        kind: "loop_updated",
        event: {
          session_id: "s1",
          loop: { ...LOOP, status: "paused" },
        },
      },
      "s1",
    );
    expect(state.loops[0]?.status).toBe("paused");
    state = applyAutonomyNotification(
      state,
      {
        kind: "loop_updated",
        event: {
          session_id: "s1",
          loop: { ...LOOP, status: "deleted" },
          deleted: true,
        },
      },
      "s1",
    );
    expect(state.loops).toHaveLength(0);
  });

  it("records monitor fires and expirations", () => {
    let state: AutonomyRuntimeState = {
      ...resetAutonomyForSession("s1"),
      monitors: [MONITOR],
    };
    state = applyAutonomyNotification(
      state,
      {
        kind: "monitor_fired",
        event: {
          session_id: "s1",
          monitor_id: "monitor_01",
          line_count: 2,
          fired_at_ms: 1_700_000_001_000,
        },
      },
      "s1",
    );
    expect(state.monitors[0]?.last_fired_at_ms).toBe(1_700_000_001_000);
    state = applyAutonomyNotification(
      state,
      {
        kind: "monitor_expired",
        event: {
          session_id: "s1",
          monitor_id: "monitor_01",
          status: "expired",
        },
      },
      "s1",
    );
    expect(state.monitors[0]?.status).toBe("expired");
    expect(state.activity).toContain("expired");
  });

  it("upserts agents by id", () => {
    let state: AutonomyRuntimeState = resetAutonomyForSession("s1");
    state = applyAutonomyNotification(
      state,
      { kind: "agent_updated", event: { session_id: "s1", agent: AGENT } },
      "s1",
    );
    state = applyAutonomyNotification(
      state,
      {
        kind: "agent_updated",
        event: {
          session_id: "s1",
          agent: { ...AGENT, status: "completed" },
        },
      },
      "s1",
    );
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0]?.status).toBe("completed");
  });
});

describe("resetAutonomyForSession", () => {
  it("binds the new session and drops all previous autonomy state", () => {
    const next = resetAutonomyForSession("s2");
    expect(next.sessionId).toBe("s2");
    expect(next.goal).toBeNull();
    expect(next.loops).toEqual([]);
    expect(next.monitors).toEqual([]);
    expect(next.agents).toEqual([]);
    expect(next.goalGeneration).toBe(0);
    expect(next.activity).toBeNull();
    expect(next.capabilities).toEqual(EMPTY_AUTONOMY.capabilities);
  });
});
