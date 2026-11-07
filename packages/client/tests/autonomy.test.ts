import { describe, expect, it } from "vitest";
import {
  AUTONOMY_UNSUPPORTED,
  buildLoopControlParams,
  buildLoopCreateParams,
  buildMonitorControlParams,
  buildMonitorCreateParams,
  buildSessionGoalSetParams,
  goalEventGenerationAdmits,
  parseAgentListResult,
  parseAgentOutputReadResult,
  parseAgentStatusReadResult,
  parseAutonomyAgentRecord,
  parseAutonomyCapabilities,
  parseAutonomyGoalRecord,
  parseAutonomyNotification,
  parseLoopCreateResult,
  parseLoopDeleteResult,
  parseLoopFireNowResult,
  parseLoopListResult,
  parseLoopPauseResumeResult,
  parseMonitorCreateResult,
  parseMonitorControlResult,
  parseMonitorListResult,
  parseSessionGoalCleared,
  parseSessionGoalClearResult,
  parseSessionGoalGetResult,
  parseSessionGoalSetResult,
  parseSessionGoalUpdated,
  autonomySessionOwnsResult,
  createAutonomyCommands,
  sessionControlsTarget,
} from "../src/autonomy.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const GOAL_RECORD = {
  goal_id: "goal_01",
  objective: "Ship the parity slice",
  status: "active",
  token_budget: 300_000,
  tokens_used: 1_200,
  time_used_seconds: 45,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_500,
};

const LOOP_RECORD = {
  loop_id: "loop_01",
  session_id: "s1",
  profile_id: "dev",
  prompt: "Check the deploy",
  mode: "fixed_interval",
  interval_seconds: 60,
  status: "active",
  next_run_at_ms: 1_700_000_060_000,
  expires_at_ms: 1_700_086_400_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

const MONITOR_RECORD = {
  monitor_id: "monitor_01",
  session_id: "s1",
  profile_id: "dev",
  name: "watch-build",
  argv: ["./scripts/watch.sh"],
  filter_regex: "ERROR.*",
  mode: "poll",
  interval_seconds: 30,
  batch_ms: 500,
  max_events_per_hour: 60,
  persistent: false,
  status: "active",
  fires_used: 0,
  expires_at_ms: 1_700_003_600_000,
  created_at_ms: 1_700_000_000_000,
  updated_at_ms: 1_700_000_000_000,
};

function capabilities(
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}

describe("autonomy capability gating", () => {
  it.each(["s1#other", "s1"])(
    "rejects nested control owner %s when the envelope owns s1#owner",
    async (nestedOwner) => {
      const loopRpc = {
        request: async () => ({
          session_id: "s1#owner",
          loop_id: "loop_01",
          loop: { ...LOOP_RECORD, session_id: nestedOwner },
          ok: true,
          status: "paused",
        }),
      };
      await expect(
        createAutonomyCommands(loopRpc).loop.pauseLoop("loop_01", "s1#request"),
      ).rejects.toThrow(/nested loop owner/);
      const monitorRpc = {
        request: async () => ({
          session_id: "s1#owner",
          profile_id: "dev",
          monitor_id: "monitor_01",
          monitor: { ...MONITOR_RECORD, session_id: nestedOwner },
          ok: true,
          status: "paused",
          deleted: false,
        }),
      };
      await expect(
        createAutonomyCommands(monitorRpc).monitor.pauseMonitor(
          "monitor_01",
          "s1#request",
        ),
      ).rejects.toThrow(/nested monitor owner/);
    },
  );

  it.each([
    ["loop/updated", "loop", "loop_id", LOOP_RECORD],
    ["loop/fired", "loop", "loop_id", LOOP_RECORD],
    ["monitor/updated", "monitor", "monitor_id", MONITOR_RECORD],
    ["monitor/expired", "monitor", "monitor_id", MONITOR_RECORD],
  ] as const)(
    "validates nested owner and ID in %s",
    (method, field, idField, record) => {
      const params = {
        session_id: "s1",
        [idField]: record[idField as keyof typeof record],
        [field]: record,
      };
      const parse = (overrides: Record<string, unknown>) =>
        parseAutonomyNotification({
          jsonrpc: "2.0",
          method,
          params: { ...params, ...overrides },
        });
      expect(parse({})).not.toBeNull();
      for (const session_id of ["foreign", "s1#other"]) {
        expect(parse({ [field]: { ...record, session_id } })).toBeNull();
      }
      expect(
        parse({ [field]: { ...record, [idField]: "wrong-id" } }),
      ).toBeNull();
      if (method !== "loop/updated" && method !== "monitor/updated") {
        expect(parse({ [field]: null })).not.toBeNull();
        expect(parse({ [field]: undefined })).not.toBeNull();
      }
    },
  );
  it("reports nothing when capabilities are absent", () => {
    expect(parseAutonomyCapabilities(undefined)).toEqual(AUTONOMY_UNSUPPORTED);
  });

  it("requires both the method and its gating feature", () => {
    const caps = parseAutonomyCapabilities(
      capabilities(["session/goal/set"], ["coding.goal_runtime.v1"]),
    );
    expect(caps.goalSet).toBe(true);
    // Method advertised but feature missing → fail closed.
    expect(
      parseAutonomyCapabilities(capabilities(["session/goal/set"], [])).goalSet,
    ).toBe(false);
    // Feature advertised but method missing → fail closed.
    expect(
      parseAutonomyCapabilities(capabilities([], ["coding.goal_runtime.v1"]))
        .goalSet,
    ).toBe(false);
  });

  it("gates each family on its own feature", () => {
    const caps = parseAutonomyCapabilities(
      capabilities(
        [
          "loop/create",
          "loop/list",
          "loop/delete",
          "loop/pause",
          "loop/resume",
          "loop/fire_now",
          "monitor/create",
          "monitor/list",
          "monitor/pause",
          "monitor/resume",
          "monitor/delete",
          "agent/list",
          "agent/status/read",
          "agent/output/read",
          "session/goal/get",
          "session/goal/clear",
        ],
        [
          "coding.loop_runtime.v1",
          "coding.monitor_runtime.v1",
          "coding.agent_control.v1",
          "coding.goal_runtime.v1",
        ],
      ),
    );
    expect(caps.loopFireNow).toBe(true);
    expect(caps.monitorDelete).toBe(true);
    expect(caps.agentOutputRead).toBe(true);
    expect(caps.goalGet).toBe(true);
    expect(caps.goalClear).toBe(true);
    // A different family's feature must not leak in.
    expect(
      parseAutonomyCapabilities(
        capabilities(["session/goal/set"], ["coding.loop_runtime.v1"]),
      ).goalSet,
    ).toBe(false);
  });
});

describe("session ownership validation", () => {
  it("accepts only the exact owning session", () => {
    expect(autonomySessionOwnsResult("s1", "s1")).toBe(true);
    expect(autonomySessionOwnsResult("s1", "s2")).toBe(false);
    expect(autonomySessionOwnsResult("s1", undefined)).toBe(false);
    expect(autonomySessionOwnsResult("s1", 7)).toBe(false);
  });
});

describe("goal contracts", () => {
  // Wire chain: get/set/clear results round-trip, and malformed payloads
  // fail closed. Guards the goal link of the OUP autonomy surface.
  it("parses goal get/set/clear results and rejects malformed payloads", () => {
    expect(
      parseSessionGoalGetResult({
        session_id: "s1",
        profile_id: "dev",
        goal: GOAL_RECORD,
      })?.goal?.goal_id,
    ).toBe("goal_01");
    expect(
      parseSessionGoalGetResult({
        session_id: "s1",
        profile_id: "dev",
        goal: null,
      })?.goal,
    ).toBeNull();

    const set = parseSessionGoalSetResult({
      session_id: "s1",
      profile_id: "dev",
      goal: GOAL_RECORD,
      generation: 3,
      transition_actor: "user",
    });
    expect(set?.generation).toBe(3);
    expect(set?.goal.objective).toBe("Ship the parity slice");

    // goal must be exactly null on clear; a nested record is a protocol error.
    expect(
      parseSessionGoalClearResult({
        session_id: "s1",
        profile_id: "dev",
        cleared: true,
        goal: null,
        generation: 4,
        transition_actor: "user",
      })?.cleared,
    ).toBe(true);
    expect(
      parseSessionGoalClearResult({
        session_id: "s1",
        profile_id: "dev",
        cleared: true,
        goal: GOAL_RECORD,
        generation: 4,
        transition_actor: "user",
      }),
    ).toBeNull();

    expect(
      parseSessionGoalGetResult({ session_id: "s1", profile_id: "dev" }),
    ).toBeNull();
    expect(
      parseSessionGoalGetResult({
        session_id: "s1",
        profile_id: "dev",
        goal: { ...GOAL_RECORD, token_budget: "300000" },
      }),
    ).toBeNull();
    expect(parseAutonomyGoalRecord({ ...GOAL_RECORD, status: "" })).toBeNull();
  });

  // Deliberate decision: the client never invents a budget — an omitted
  // budget stays omitted so the server owns the default. Think before
  // adding client-side defaults here (goal budgets gate real spend).
  it("builds goal set params: trims, never defaults a budget, rejects invalid", () => {
    const built = buildSessionGoalSetParams({
      session_id: "s1",
      objective: "  Ship it  ",
    });
    expect(built).toEqual({ session_id: "s1", objective: "Ship it" });
    expect("token_budget" in (built ?? {})).toBe(false);

    expect(
      buildSessionGoalSetParams({
        session_id: "s1",
        objective: "Ship",
        token_budget: 50_000,
        status: "paused",
      }),
    ).toEqual({
      session_id: "s1",
      objective: "Ship",
      token_budget: 50_000,
      status: "paused",
    });

    for (const invalid of [
      { session_id: "s1", objective: " " },
      // Zero/negative budgets are rejected server-side; fail closed early.
      { session_id: "s1", objective: "Ship", token_budget: 0 },
      { session_id: "s1", objective: "Ship", token_budget: -5 },
      { session_id: "s1", objective: "Ship", status: "bogus" },
      { session_id: "s1", objective: "Ship", transition_actor: "root" },
      { session_id: "", objective: "x" },
    ]) {
      expect(buildSessionGoalSetParams(invalid)).toBeNull();
    }
  });
});

describe("goal generation admission (#1959)", () => {
  // Deliberate design: a goal event carries a monotonic generation and a
  // late (older-generation) update must never resurrect a cleared goal.
  // Generation 0 means an unstamped legacy backend and always applies.
  it("admits only newer generations; 0 means legacy", () => {
    expect(goalEventGenerationAdmits(3, 4)).toBe(true);
    expect(goalEventGenerationAdmits(3, 3)).toBe(false);
    expect(goalEventGenerationAdmits(3, 2)).toBe(false);
    // Clear stamped 5; a stale pre-clear update at 4 must drop.
    expect(goalEventGenerationAdmits(5, 4)).toBe(false);
    expect(goalEventGenerationAdmits(9, 0)).toBe(true);
    expect(goalEventGenerationAdmits(0, 0)).toBe(true);

    expect(
      parseSessionGoalUpdated({
        session_id: "s1",
        goal: GOAL_RECORD,
        transition_actor: "backend",
        generation: 6,
      })?.generation,
    ).toBe(6);
    expect(
      parseSessionGoalCleared({
        session_id: "s1",
        cleared: true,
        goal: null,
        transition_actor: "user",
        generation: 7,
      })?.goal,
    ).toBeNull();
  });
});

describe("loop contracts", () => {
  it("builds loop create params and rejects invalid ones", () => {
    expect(
      buildLoopCreateParams({ session_id: "s1", prompt: "watch deps" }),
    ).toEqual({ session_id: "s1", prompt: "watch deps" });
    expect(
      buildLoopCreateParams({
        session_id: "s1",
        command: "/loop every 5m check build",
      }),
    ).toEqual({ session_id: "s1", command: "/loop every 5m check build" });
    // No prompt/command at all → fail closed.
    expect(buildLoopCreateParams({ session_id: "s1" })).toBeNull();
    expect(buildLoopCreateParams({ session_id: "", prompt: "x" })).toBeNull();
    expect(buildLoopCreateParams({ session_id: "s1", prompt: " " })).toBeNull();
    // Interval bounds (server LOOP_MIN..LOOP_MAX).
    expect(
      buildLoopCreateParams({
        session_id: "s1",
        prompt: "x",
        interval_seconds: 0,
      }),
    ).toBeNull();
    expect(
      buildLoopCreateParams({
        session_id: "s1",
        prompt: "x",
        interval_seconds: 86_401,
      }),
    ).toBeNull();
    // fixed_interval requires an interval.
    expect(
      buildLoopCreateParams({
        session_id: "s1",
        prompt: "x",
        mode: "fixed_interval",
      }),
    ).toBeNull();
  });

  // Wire chain: create/list/control/fire-now results round-trip; malformed
  // results and control params fail closed.
  it("parses loop results and rejects malformed ones", () => {
    const created = parseLoopCreateResult({
      session_id: "s1",
      profile_id: "dev",
      loop_id: "loop_01",
      loop: LOOP_RECORD,
      ok: true,
      status: "active",
      created: true,
      fire: {
        queued: false,
        reason: "waiting_for_schedule",
        message: "loop created; it will queue when due",
      },
    });
    expect(created?.loop_id).toBe("loop_01");
    expect(created?.fire?.queued).toBe(false);

    // Unscoped list echoes session_id: null.
    expect(
      parseLoopListResult({
        session_id: "s1",
        profile_id: "dev",
        loops: [LOOP_RECORD],
      })?.loops,
    ).toHaveLength(1);
    expect(
      parseLoopListResult({
        session_id: null,
        profile_id: "dev",
        loops: [],
      })?.session_id,
    ).toBeNull();

    expect(
      parseLoopDeleteResult({
        session_id: "s1",
        loop_id: "loop_01",
        loop: LOOP_RECORD,
        ok: true,
        status: "deleted",
        deleted: true,
        reaped_cron_job_ids: ["job-1"],
      })?.reaped_cron_job_ids,
    ).toEqual(["job-1"]);

    expect(
      parseLoopPauseResumeResult({
        session_id: "s1",
        loop_id: "loop_01",
        loop: LOOP_RECORD,
        ok: true,
        status: "paused",
      })?.status,
    ).toBe("paused");

    expect(
      parseLoopFireNowResult({
        session_id: "s1",
        profile_id: "dev",
        loop_id: "loop_01",
        loop: LOOP_RECORD,
        ok: true,
        status: "queued",
        fire: { queued: true, duplicate: false, continuation_id: 7 },
      })?.fire?.continuation_id,
    ).toBe(7);

    expect(parseLoopCreateResult({ session_id: "s1" })).toBeNull();
    expect(
      parseLoopCreateResult({
        session_id: "s1",
        profile_id: "dev",
        loop_id: "loop_01",
        loop: { ...LOOP_RECORD, interval_seconds: "60" },
        ok: true,
        status: "active",
        created: true,
      }),
    ).toBeNull();
    expect(parseLoopListResult({ profile_id: "dev", loops: [{}] })).toBeNull();
    expect(buildLoopControlParams({ loop_id: "" })).toBeNull();
    expect(
      buildLoopControlParams({ loop_id: "loop_01", session_id: "" }),
    ).toBeNull();
    expect(
      parseLoopPauseResumeResult({
        session_id: "s1",
        loop_id: "loop_01",
        loop: LOOP_RECORD,
        ok: false,
        status: "paused",
      }),
    ).toBeNull();
  });
});

describe("monitor contracts", () => {
  // Deliberate decision: optional fields the caller did not set stay absent
  // on the wire (no client-invented defaults), and unknown modes refuse
  // before the wire instead of silently falling back to poll.
  it("builds monitor create params without inventing options", () => {
    const built = buildMonitorCreateParams({
      session_id: "s1",
      name: "  watch-build  ",
      argv: ["./scripts/watch.sh"],
    });
    expect(built).toEqual({
      session_id: "s1",
      name: "watch-build",
      argv: ["./scripts/watch.sh"],
    });
    // Optional fields absent → absent on the wire too.
    expect("persistent" in (built ?? {})).toBe(false);
    expect("interval_seconds" in (built ?? {})).toBe(false);

    expect(
      buildMonitorCreateParams({
        session_id: "s1",
        name: "w",
        argv: ["x"],
        mode: "cron" as never,
      }),
    ).toBeNull();
    expect(
      buildMonitorCreateParams({
        session_id: "s1",
        name: "w",
        argv: [],
      }),
    ).toBeNull();
    expect(
      buildMonitorCreateParams({ session_id: "s1", name: " ", argv: ["x"] }),
    ).toBeNull();
  });

  // Wire chain: create/list/control results round-trip; control params and
  // malformed results fail closed.
  it("parses monitor results and rejects malformed ones", () => {
    const created = parseMonitorCreateResult({
      session_id: "s1",
      profile_id: "dev",
      monitor_id: "monitor_01",
      monitor: MONITOR_RECORD,
      ok: true,
      status: "active",
      created: true,
    });
    expect(created?.monitor.mode).toBe("poll");

    expect(
      parseMonitorListResult({
        session_id: "s1",
        profile_id: "dev",
        monitors: [MONITOR_RECORD],
      })?.monitors[0]?.monitor_id,
    ).toBe("monitor_01");

    expect(
      parseMonitorControlResult({
        session_id: "s1",
        profile_id: "dev",
        monitor_id: "monitor_01",
        monitor: {
          ...MONITOR_RECORD,
          status: "paused",
          pause_reason: "user",
        },
        ok: true,
        status: "paused",
        deleted: false,
      })?.monitor.pause_reason,
    ).toBe("user");

    expect(buildMonitorControlParams({ monitor_id: "" })).toBeNull();
    expect(
      buildMonitorControlParams({ monitor_id: "monitor_01", profile_id: " " }),
    ).toBeNull();
  });
});

describe("agent inspection contracts", () => {
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
    artifact_count: 1,
    artifacts: [{ id: "a", title: "Diff", kind: "diff", status: "ready" }],
    output_tail: "still working",
  };

  it("rejects a foreign owner or conflicting envelope ID in agent notifications", () => {
    const parse = (agent: unknown, agentId = "agent_01") =>
      parseAutonomyNotification({
        jsonrpc: "2.0",
        method: "agent/updated",
        params: { session_id: "s1", agent_id: agentId, agent },
      });
    expect(parse(AGENT)).not.toBeNull();
    expect(parse({ ...AGENT, session_id: "s1#other" })).toBeNull();
    expect(parse({ ...AGENT, session_id: "foreign" })).toBeNull();
    expect(parse(AGENT, "other-id")).toBeNull();
  });

  // Wire chain: record/list/status/output read round-trip; malformed
  // payloads fail closed.
  it("parses agent records and read results, rejects malformed ones", () => {
    expect(parseAutonomyAgentRecord(AGENT)?.agent_id).toBe("agent_01");
    expect(
      parseAgentListResult({
        session_id: "s1",
        profile_id: "dev",
        agents: [AGENT],
      })?.agents,
    ).toHaveLength(1);
    expect(
      parseAgentStatusReadResult({ session_id: "s1", agent: AGENT })?.agent
        .role,
    ).toBe("implementer");
    expect(
      parseAgentOutputReadResult({
        agent_id: "agent_01",
        session_id: "s1",
        source: "runtime",
        text: "hello",
        messages: [],
        cursor: { offset: 0 },
        next_cursor: { offset: 5 },
        has_more: true,
        complete: false,
      }),
    ).toMatchObject({ has_more: true, next_cursor: { offset: 5 } });

    expect(parseAutonomyAgentRecord({ ...AGENT, status: "" })).toBeNull();
    expect(
      parseAgentListResult({ profile_id: "dev", agents: [{}] }),
    ).toBeNull();
    expect(parseAgentStatusReadResult({ session_id: "s1" })).toBeNull();
    expect(
      parseAgentOutputReadResult({
        agent_id: "agent_01",
        session_id: "s1",
        source: "runtime",
        text: "x",
        cursor: { offset: -1 },
        next_cursor: null,
        has_more: false,
        complete: true,
      }),
    ).toBeNull();
  });
});

describe("autonomy notifications", () => {
  it("dispatches each autonomy notification method", () => {
    const cases: Array<[string, unknown, string]> = [
      [
        "session/goal/updated",
        {
          session_id: "s1",
          goal: GOAL_RECORD,
          transition_actor: "user",
          generation: 2,
        },
        "goal_updated",
      ],
      [
        "session/goal/cleared",
        {
          session_id: "s1",
          cleared: true,
          goal: null,
          transition_actor: "user",
          generation: 3,
        },
        "goal_cleared",
      ],
      ["loop/updated", { session_id: "s1", loop: LOOP_RECORD }, "loop_updated"],
      ["loop/fired", { session_id: "s1", loop_id: "loop_01" }, "loop_fired"],
      [
        "monitor/updated",
        { session_id: "s1", monitor: MONITOR_RECORD },
        "monitor_updated",
      ],
      [
        "monitor/fired",
        { session_id: "s1", monitor_id: "monitor_01", line_count: 2 },
        "monitor_fired",
      ],
      [
        "monitor/expired",
        { session_id: "s1", monitor_id: "monitor_01", reason: "timeout" },
        "monitor_expired",
      ],
    ];
    for (const [method, params, kind] of cases) {
      expect(
        parseAutonomyNotification({
          jsonrpc: "2.0",
          method,
          params,
        })?.kind,
      ).toBe(kind);
    }
  });

  it("drops non-autonomy methods and malformed payloads", () => {
    expect(
      parseAutonomyNotification({
        jsonrpc: "2.0",
        method: "turn/started",
        params: {},
      }),
    ).toBeNull();
    expect(
      parseAutonomyNotification({
        jsonrpc: "2.0",
        method: "session/goal/updated",
        params: { session_id: "s1" },
      }),
    ).toBeNull();
  });
});

describe("rc12 wire shapes: json! emits explicit null for absent Option fields", () => {
  // Mirrors autonomy_loop_json / autonomy_monitor_json / autonomy_agent_json
  // (agent_orchestrator.rs): Option::None serializes as null,
  // the key is present. Decoders must treat null as absent for exactly these
  // audited fields and stay strict for required ones.
  const LOOP_WITH_NULLS = {
    loop_id: "loop_01",
    session_id: "s1",
    profile_id: "dev",
    prompt: "Check the deploy",
    mode: "self_paced",
    interval_seconds: null,
    status: "active",
    next_run_at_ms: null,
    last_run_at_ms: null,
    expires_at_ms: 1_700_086_400_000,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  const MONITOR_WITH_NULLS = {
    monitor_id: "monitor_01",
    session_id: "s1",
    profile_id: "dev",
    name: "watch-build",
    argv: ["./scripts/watch.sh"],
    filter_regex: null,
    mode: "stream",
    interval_seconds: null,
    batch_ms: 500,
    max_events_per_hour: 60,
    persistent: true,
    status: "active",
    pause_reason: null,
    goal_id: null,
    last_fired_at_ms: null,
    fires_used: 0,
    expires_at_ms: null,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  const AGENT_WITH_NULLS = {
    agent_id: "agent_01",
    parent_agent_id: null,
    session_id: "s1",
    task_id: null,
    path: "/repo/src/app.ts",
    role: "implementer",
    nickname: "impl-1",
    title: "impl-1",
    backend_kind: "builtin",
    status: "running",
    last_task: null,
    summary: null,
    output_tail: null,
    cwd: null,
    profile_id: "dev",
    artifact_count: 0,
    artifacts: [],
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  // Per-field null handling is exercised through one representative
  // nullable field per family; the full audited null-field set lives in
  // the parsers and in Core's autonomy_*_json serializers.
  it("accepts list/control/fire results carrying nulls", () => {
    const listed = parseMonitorListResult({
      session_id: "s1",
      profile_id: "dev",
      monitors: [MONITOR_WITH_NULLS],
    });
    expect(listed?.monitors).toHaveLength(1);
    expect(listed?.monitors[0]?.filter_regex).toBeUndefined();
    expect(listed?.monitors[0]?.persistent).toBe(true);

    const controlled = parseMonitorControlResult({
      session_id: "s1",
      profile_id: "dev",
      monitor_id: "monitor_01",
      monitor: {
        ...MONITOR_WITH_NULLS,
        status: "paused",
        pause_reason: "user",
      },
      ok: true,
      status: "paused",
      deleted: false,
    });
    expect(controlled?.monitor.pause_reason).toBe("user");

    const fired = parseLoopFireNowResult({
      session_id: "s1",
      profile_id: "dev",
      loop_id: "loop_01",
      loop: LOOP_WITH_NULLS,
      ok: true,
      status: "queued",
      fire: { queued: true, duplicate: false, continuation_id: 3 },
    });
    expect(fired?.loop.mode).toBe("self_paced");
    expect(fired?.loop.next_run_at_ms).toBeUndefined();

    const agent = parseAutonomyAgentRecord(AGENT_WITH_NULLS);
    expect(agent?.parent_agent_id).toBeUndefined();
    expect(
      parseAgentListResult({
        session_id: "s1",
        profile_id: "dev",
        agents: [AGENT_WITH_NULLS],
      })?.agents,
    ).toHaveLength(1);
  });

  it("stays strict where rc11 requires a value — null on required fields still fails", () => {
    expect(
      parseMonitorListResult({
        session_id: "s1",
        profile_id: "dev",
        monitors: [{ ...MONITOR_WITH_NULLS, status: null }],
      }),
    ).toBeNull();
    expect(
      parseAutonomyAgentRecord({ ...AGENT_WITH_NULLS, agent_id: null }),
    ).toBeNull();
    expect(
      parseLoopListResult({
        session_id: "s1",
        profile_id: "dev",
        loops: [{ ...LOOP_WITH_NULLS, loop_id: null }],
      }),
    ).toBeNull();
  });
});

describe("scoped list ownership (session_controls_target mirror)", () => {
  it("base-key matching mirrors Core: topic scope sees its base session", () => {
    expect(sessionControlsTarget("telegram:1#research", "telegram:1")).toBe(
      true,
    );
    expect(sessionControlsTarget("telegram:1", "telegram:1#research")).toBe(
      true,
    );
    expect(sessionControlsTarget("telegram:1#a", "telegram:1#b")).toBe(true);
    expect(sessionControlsTarget("telegram:1", "telegram:2")).toBe(false);
  });

  // Same guard across the three families: a scoped list keeps base/topic
  // children and drops foreign ones, and the envelope session must echo
  // the request exactly (a wrong or null echo is a protocol violation).
  it.each(["loop", "monitor", "agent"] as const)(
    "scopes a %s list to its base/topic children and enforces the envelope echo",
    async (family) => {
      const foreign = { session_id: "s2" };
      const rows = {
        loop: [
          { ...LOOP_RECORD, loop_id: "loop_01", session_id: "dev:local:tui" },
          {
            ...LOOP_RECORD,
            loop_id: "loop_02",
            session_id: "dev:local:tui#other",
          },
          { ...LOOP_RECORD, loop_id: "loop_03", ...foreign },
        ],
        monitor: [
          { ...MONITOR_RECORD, monitor_id: "m1", session_id: "dev:local:tui" },
          { ...MONITOR_RECORD, monitor_id: "m2", ...foreign },
        ],
        agent: [
          {
            agent_id: "a1",
            session_id: "dev:local:tui",
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
          },
          {
            agent_id: "a2",
            path: "/repo/src/app.ts",
            role: "implementer",
            nickname: "impl-2",
            backend_kind: "builtin",
            status: "running",
            profile_id: "dev",
            created_at_ms: 1_700_000_000_000,
            updated_at_ms: 1_700_000_000_000,
            artifact_count: 0,
            artifacts: [],
            ...foreign,
          },
        ],
      }[family];
      const list = (rpc: {
        request: () => Promise<Record<string, unknown>>;
      }) =>
        family === "loop"
          ? createAutonomyCommands(rpc).loop.listLoops("dev:local:tui")
          : family === "monitor"
            ? createAutonomyCommands(rpc).monitor.listMonitors("dev:local:tui")
            : createAutonomyCommands(rpc).agent.listAgents("dev:local:tui");
      const key =
        family === "loop"
          ? "loops"
          : family === "monitor"
            ? "monitors"
            : "agents";
      const idKey =
        family === "loop"
          ? "loop_id"
          : family === "monitor"
            ? "monitor_id"
            : "agent_id";

      const kept = await list({
        request: async () => ({
          session_id: "dev:local:tui",
          profile_id: "dev",
          [key]: rows,
        }),
      });
      // Base-session variants stay; foreign sessions drop.
      const keptRows = (
        kept as unknown as Record<string, Record<string, unknown>[]>
      )[key]!;
      expect(keptRows.map((entry) => entry[idKey])).toEqual(
        rows.slice(0, -1).map((row) => row[idKey as never]),
      );

      // Wrong echo, then null echo — both refuse.
      for (const session_id of ["s1", null]) {
        await expect(
          list({
            request: async () => ({
              session_id,
              profile_id: "dev",
              [key]: [],
            }),
          }),
        ).rejects.toThrow(/does not exactly match/);
      }
    },
  );

  it("accepts legal base/topic scope on single-resource controls with the exact resource id", async () => {
    // A topic-scoped request may control its base session's loop; the result
    // carries the loop's ACTUAL owner (the base session) and the exact id.
    const rpc = {
      request: async () => ({
        session_id: "dev:local:tui",
        loop_id: "loop_01",
        loop: {
          ...LOOP_RECORD,
          loop_id: "loop_01",
          session_id: "dev:local:tui",
        },
        ok: true,
        status: "paused",
      }),
    };
    await expect(
      createAutonomyCommands(rpc).loop.pauseLoop(
        "loop_01",
        "dev:local:tui#research",
      ),
    ).resolves.toMatchObject({ loop_id: "loop_01", status: "paused" });
  });

  it("rejects a single-resource control whose owner is outside the base/topic scope", async () => {
    const rpc = {
      request: async () => ({
        session_id: "telegram:2",
        loop_id: "loop_01",
        loop: { ...LOOP_RECORD, loop_id: "loop_01", session_id: "telegram:2" },
        ok: true,
        status: "paused",
      }),
    };
    await expect(
      createAutonomyCommands(rpc).loop.pauseLoop(
        "loop_01",
        "telegram:1#research",
      ),
    ).rejects.toThrow(/outside the requested base\/topic scope/);
  });

  it("rejects a single-resource control whose returned id differs from the request", async () => {
    const rpc = {
      request: async () => ({
        session_id: "s1",
        profile_id: "dev",
        monitor_id: "monitor_02",
        monitor: {
          ...MONITOR_RECORD,
          monitor_id: "monitor_02",
          session_id: "s1",
        },
        ok: true,
        status: "paused",
        deleted: false,
      }),
    };
    await expect(
      createAutonomyCommands(rpc).monitor.pauseMonitor("monitor_01", "s1"),
    ).rejects.toThrow(/does not match the requested id/);
  });

  // Same envelope/nested-record agreement guard for loop and monitor: the
  // nested record's id must match the envelope id, and its owner must match
  // the envelope session — otherwise the server answered about a resource
  // the client never requested.
  it.each(["loop", "monitor"] as const)(
    "rejects a %s control whose nested record id or owner disagrees with the envelope",
    async (family) => {
      const record = (patch: Record<string, unknown>) => ({
        ...(family === "loop" ? LOOP_RECORD : MONITOR_RECORD),
        ...patch,
      });
      const response = (nested: Record<string, unknown>) => ({
        session_id: "s1",
        profile_id: "dev",
        [family === "loop" ? "loop_id" : "monitor_id"]:
          family === "loop" ? "loop_01" : "monitor_01",
        [family]: nested,
        ok: true,
        status: "paused",
        ...(family === "monitor" ? { deleted: false } : {}),
      });
      const control = (
        rpc: { request: () => Promise<unknown> },
        scope = "s1",
      ) =>
        family === "loop"
          ? createAutonomyCommands(rpc).loop.pauseLoop("loop_01", scope)
          : createAutonomyCommands(rpc).monitor.pauseMonitor(
              "monitor_01",
              scope,
            );

      // Foreign, unrequested resource id inside a valid envelope.
      await expect(
        control({
          request: async () =>
            response(
              record(
                family === "loop"
                  ? { loop_id: "loop_02" }
                  : { monitor_id: "monitor_02" },
              ),
            ),
        }),
      ).rejects.toThrow(/does not match the envelope id/);

      // Nested owner from a different base session. The request targets
      // telegram:1 (matching the envelope), so the only violation is the
      // nested record's owner.
      await expect(
        control(
          {
            request: async () => ({
              ...response(record({ session_id: "telegram:2" })),
              session_id: "telegram:1",
            }),
          },
          "telegram:1",
        ),
      ).rejects.toThrow(/does not agree/);
    },
  );

  it("keeps an unscoped (profile-wide) list untouched", async () => {
    const rpc = {
      request: async () => ({
        session_id: null,
        profile_id: "dev",
        loops: [
          { ...LOOP_RECORD, loop_id: "loop_01", session_id: "s1" },
          { ...LOOP_RECORD, loop_id: "loop_02", session_id: "s2" },
        ],
      }),
    };
    const result = await createAutonomyCommands(rpc).loop.listLoops(null);
    expect(result.loops).toHaveLength(2);
  });
});
