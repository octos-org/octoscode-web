import type {
  AgentArtifactListResult,
  AgentArtifactReadResult,
  AgentOutputReadResult,
  AutonomyAgentRecord,
  AutonomyCapabilities,
  AutonomyGoalRecord,
  AutonomyLoopRecord,
  AutonomyMonitorRecord,
  AutonomyNotification,
} from "./client-contract.ts";
import { goalEventGenerationAdmits } from "./client-contract.ts";

/**
 * View-model for the autonomy surface. Everything here is derived from
 * server-validated results; the controller only ever stores records whose
 * owning session matched the request.
 */
export interface AutonomyRuntimeState {
  /** Session this state is bound to (multi-session isolation). */
  sessionId: string | null;
  capabilities: AutonomyCapabilities;
  goal: AutonomyGoalRecord | null;
  goalGeneration: number;
  goalError: string | null;
  goalBusy: boolean;
  loops: AutonomyLoopRecord[];
  loopsError: string | null;
  loopsBusy: boolean;
  pendingLoopIds: ReadonlySet<string>;
  monitors: AutonomyMonitorRecord[];
  monitorsError: string | null;
  monitorsBusy: boolean;
  pendingMonitorIds: ReadonlySet<string>;
  agents: AutonomyAgentRecord[];
  agentsError: string | null;
  agentsBusy: boolean;
  agentOutput: AgentOutputReadResult | null;
  agentOutputError: string | null;
  agentOutputBusy: boolean;
  agentStatus: AutonomyAgentRecord | null;
  agentArtifacts: AgentArtifactListResult | null;
  agentArtifact: AgentArtifactReadResult | null;
  agentDetailBusy: boolean;
  pendingAgentIds: ReadonlySet<string>;
  /** Latest background activity line, kept visible across session switches. */
  activity: string | null;
}

export const EMPTY_AUTONOMY: AutonomyRuntimeState = {
  sessionId: null,
  capabilities: {
    goalGet: false,
    goalSet: false,
    goalClear: false,
    loopCreate: false,
    loopList: false,
    loopDelete: false,
    loopPause: false,
    loopResume: false,
    loopFireNow: false,
    monitorCreate: false,
    monitorList: false,
    monitorPause: false,
    monitorResume: false,
    monitorDelete: false,
    agentList: false,
    agentStatusRead: false,
    agentOutputRead: false,
    agentArtifactList: false,
    agentArtifactRead: false,
    agentInterrupt: false,
    agentClose: false,
  },
  goal: null,
  goalGeneration: 0,
  goalError: null,
  goalBusy: false,
  loops: [],
  loopsError: null,
  loopsBusy: false,
  pendingLoopIds: new Set<string>(),
  monitors: [],
  monitorsError: null,
  monitorsBusy: false,
  pendingMonitorIds: new Set<string>(),
  agents: [],
  agentsError: null,
  agentsBusy: false,
  agentOutput: null,
  agentOutputError: null,
  agentOutputBusy: false,
  agentStatus: null,
  agentArtifacts: null,
  agentArtifact: null,
  agentDetailBusy: false,
  pendingAgentIds: new Set<string>(),
  activity: null,
};

export function resetAutonomyForSession(
  sessionId: string | null,
): AutonomyRuntimeState {
  return { ...EMPTY_AUTONOMY, sessionId };
}

export function describeGoalStatus(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "budget_limited":
      return "Budget limited";
    case "complete":
      return "Complete";
    case "blocked":
      return "Blocked";
    default:
      return status;
  }
}

export function formatGoalBudget(goal: AutonomyGoalRecord): string | null {
  if (goal.token_budget <= 0) return null;
  return `${formatTokens(goal.tokens_used)} / ${formatTokens(goal.token_budget)} tokens`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(value);
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatInterval(seconds: number | undefined): string {
  if (seconds === undefined) return "self-paced";
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return hours === 1 ? "hourly" : `every ${hours}h`;
    }
    return minutes === 1 ? "every minute" : `every ${minutes}m`;
  }
  return `every ${seconds}s`;
}

export function formatTimestamp(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString();
}

export function monitorIsControllable(monitor: AutonomyMonitorRecord): boolean {
  return monitor.status === "active" || monitor.status === "paused";
}

export function loopIsControllable(record: AutonomyLoopRecord): boolean {
  return record.status === "active" || record.status === "paused";
}

/**
 * Per-operation request tracker. Each op-id owns an independent monotonic
 * token, so concurrent operations in different families never invalidate
 * each other; `invalidateAll` is reserved for session/authority resets.
 */
export class OperationTracker {
  #tokens = new Map<string, number>();

  begin(opId: string): number {
    const next = (this.#tokens.get(opId) ?? 0) + 1;
    this.#tokens.set(opId, next);
    return next;
  }

  /** Invalidate every in-flight operation (session switch / reset). */
  invalidateAll(): void {
    for (const key of this.#tokens.keys()) {
      this.#tokens.set(key, (this.#tokens.get(key) ?? 0) + 1);
    }
  }

  isCurrent(opId: string, token: number): boolean {
    return this.#tokens.get(opId) === token;
  }
}

export type BudgetInput =
  { kind: "omit" } | { kind: "set"; value: number } | { kind: "invalid" };

/**
 * Strict optional token-budget parsing: blank omits the field entirely (the
 * server applies its own default); any other value must be a positive safe
 * integer. `Number("1e6")` is 1_000_000 — correct, unlike parseInt which
 * would silently truncate to 1.
 */
export function parseBudgetInput(raw: string): BudgetInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "omit" };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { kind: "invalid" };
  }
  return { kind: "set", value };
}

/**
 * Monitor argv is an explicit JSON array of arguments. No shell-style
 * whitespace splitting (it breaks quoted args) and no implicit shell
 * execution — the array is passed verbatim as the probe's argv.
 */
export function parseArgvJsonInput(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    return null;
  }
  return parsed as string[];
}

/**
 * Pure notification reducer for the autonomy surface.
 *
 * Multi-session contract: an event whose session differs from the owning
 * session only refreshes the background-activity line — it can never mutate
 * the selected session's goal/loop/monitor/agent state. Goal events are
 * admitted strictly by #1959 generation so a late pre-clear update cannot
 * resurrect a cleared goal.
 */
export function applyAutonomyNotification(
  state: AutonomyRuntimeState,
  notification: AutonomyNotification,
  owningSession: string | null,
): AutonomyRuntimeState {
  const sessionId = notification.event.session_id;
  if (sessionId !== owningSession || state.sessionId !== owningSession) {
    return {
      ...state,
      activity: `Background autonomy in session ${sessionId}`,
    };
  }
  switch (notification.kind) {
    case "goal_updated": {
      const event = notification.event;
      if (!goalEventGenerationAdmits(state.goalGeneration, event.generation)) {
        return state;
      }
      return {
        ...state,
        goal: event.goal,
        goalGeneration: event.generation,
        goalError: null,
      };
    }
    case "goal_cleared": {
      const event = notification.event;
      if (!goalEventGenerationAdmits(state.goalGeneration, event.generation)) {
        return state;
      }
      return {
        ...state,
        goal: event.cleared ? null : state.goal,
        goalGeneration: event.generation,
        activity: event.cleared ? "Session goal cleared" : state.activity,
      };
    }
    case "loop_updated": {
      const event = notification.event;
      return {
        ...state,
        loops: event.deleted
          ? state.loops.filter((entry) => entry.loop_id !== event.loop.loop_id)
          : upsertLoop(state.loops, event.loop),
      };
    }
    case "loop_fired": {
      const event = notification.event;
      return {
        ...state,
        activity: `Loop ${event.loop_id} fired`,
        loops: event.loop ? upsertLoop(state.loops, event.loop) : state.loops,
      };
    }
    case "loop_completed": {
      const event = notification.event;
      return {
        ...state,
        activity: `Loop ${event.loop_id} completed`,
        loops: event.loop ? upsertLoop(state.loops, event.loop) : state.loops,
      };
    }
    case "monitor_updated": {
      const event = notification.event;
      return {
        ...state,
        monitors: event.deleted
          ? state.monitors.filter(
              (entry) => entry.monitor_id !== event.monitor.monitor_id,
            )
          : upsertMonitor(state.monitors, event.monitor),
      };
    }
    case "monitor_fired": {
      const event = notification.event;
      const firedAtMs = event.fired_at_ms;
      return {
        ...state,
        activity: `Monitor ${event.monitor_id} fired`,
        monitors:
          firedAtMs === undefined
            ? state.monitors
            : state.monitors.map((entry) =>
                entry.monitor_id === event.monitor_id
                  ? { ...entry, last_fired_at_ms: firedAtMs }
                  : entry,
              ),
      };
    }
    case "monitor_expired": {
      const event = notification.event;
      return {
        ...state,
        activity: `Monitor ${event.monitor_id} expired`,
        monitors: state.monitors.map((entry) =>
          entry.monitor_id === event.monitor_id
            ? { ...entry, status: event.status ?? "expired" }
            : entry,
        ),
      };
    }
    case "agent_updated": {
      const event = notification.event;
      return { ...state, agents: upsertAgent(state.agents, event.agent) };
    }
  }
}

function upsertLoop(
  loops: AutonomyLoopRecord[],
  record: AutonomyLoopRecord,
): AutonomyLoopRecord[] {
  const index = loops.findIndex((entry) => entry.loop_id === record.loop_id);
  if (index < 0) return [record, ...loops];
  const next = loops.slice();
  next[index] = record;
  return next;
}

function upsertMonitor(
  monitors: AutonomyMonitorRecord[],
  record: AutonomyMonitorRecord,
): AutonomyMonitorRecord[] {
  const index = monitors.findIndex(
    (entry) => entry.monitor_id === record.monitor_id,
  );
  if (index < 0) return [record, ...monitors];
  const next = monitors.slice();
  next[index] = record;
  return next;
}

function upsertAgent(
  agents: AutonomyAgentRecord[],
  agent: AutonomyAgentRecord,
): AutonomyAgentRecord[] {
  const index = agents.findIndex((entry) => entry.agent_id === agent.agent_id);
  if (index < 0) return [...agents, agent];
  const next = agents.slice();
  next[index] = agent;
  return next;
}
