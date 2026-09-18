import { isRecord, type RpcNotification } from "./rpc.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import {
  isNonEmptyString,
  isNonNegativeInteger,
  isStringArray,
} from "./wire-decoders.ts";

/**
 * Narrow, fail-closed decoders for the M15/#1977 autonomy surface:
 * `session/goal/*`, `loop/*`, `monitor/*` and native agent inspection/control.
 *
 * Sources: crates/octos-core/src/ui_protocol.rs (events, capability map) and
 * crates/octos-cli/src/api/ui_protocol_transport.rs (raw param structs and
 * the autonomy dispatch/gating table). Only exact server payload shapes are
 * accepted; anything else parses to null and callers must fail closed.
 * Per AGENTS.md this is a narrow vertical-slice guard — generated contracts
 * remain the intended source of truth.
 */

// ---------------------------------------------------------------------------
// Capability gating — mirror of autonomy_method_available (transport) and
// method_required_feature (ui_protocol.rs): a method is usable only when the
// server advertises BOTH the method and its gating feature.
// ---------------------------------------------------------------------------

function supportsMethodWithFeature(
  capabilities: UiProtocolCapabilities,
  method: string,
  feature: string,
): boolean {
  return (
    capabilities.supported_methods.includes(method) &&
    (capabilities.supported_features?.includes(feature) ?? false)
  );
}

export interface AutonomyCapabilities {
  goalGet: boolean;
  goalSet: boolean;
  goalClear: boolean;
  loopCreate: boolean;
  loopList: boolean;
  loopDelete: boolean;
  loopPause: boolean;
  loopResume: boolean;
  loopFireNow: boolean;
  monitorCreate: boolean;
  monitorList: boolean;
  monitorPause: boolean;
  monitorResume: boolean;
  monitorDelete: boolean;
  agentList: boolean;
  agentStatusRead: boolean;
  agentOutputRead: boolean;
  agentArtifactList: boolean;
  agentArtifactRead: boolean;
  agentInterrupt: boolean;
  agentClose: boolean;
}

export const AUTONOMY_UNSUPPORTED: AutonomyCapabilities = {
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
};

export function parseAutonomyCapabilities(
  capabilities: UiProtocolCapabilities | undefined,
): AutonomyCapabilities {
  if (!capabilities) return { ...AUTONOMY_UNSUPPORTED };
  const goal = (method: string) =>
    supportsMethodWithFeature(
      capabilities,
      method,
      CORE_UI_FEATURES.CODING_GOAL_RUNTIME_V1,
    );
  const loop = (method: string) =>
    supportsMethodWithFeature(
      capabilities,
      method,
      CORE_UI_FEATURES.CODING_LOOP_RUNTIME_V1,
    );
  const monitor = (method: string) =>
    supportsMethodWithFeature(
      capabilities,
      method,
      CORE_UI_FEATURES.CODING_MONITOR_RUNTIME_V1,
    );
  const agent = (method: string) =>
    supportsMethodWithFeature(
      capabilities,
      method,
      CORE_UI_FEATURES.CODING_AGENT_CONTROL_V1,
    );
  return {
    goalGet: goal(CORE_UI_METHODS.SESSION_GOAL_GET),
    goalSet: goal(CORE_UI_METHODS.SESSION_GOAL_SET),
    goalClear: goal(CORE_UI_METHODS.SESSION_GOAL_CLEAR),
    loopCreate: loop(CORE_UI_METHODS.LOOP_CREATE),
    loopList: loop(CORE_UI_METHODS.LOOP_LIST),
    loopDelete: loop(CORE_UI_METHODS.LOOP_DELETE),
    loopPause: loop(CORE_UI_METHODS.LOOP_PAUSE),
    loopResume: loop(CORE_UI_METHODS.LOOP_RESUME),
    loopFireNow: loop(CORE_UI_METHODS.LOOP_FIRE_NOW),
    monitorCreate: monitor(CORE_UI_METHODS.MONITOR_CREATE),
    monitorList: monitor(CORE_UI_METHODS.MONITOR_LIST),
    monitorPause: monitor(CORE_UI_METHODS.MONITOR_PAUSE),
    monitorResume: monitor(CORE_UI_METHODS.MONITOR_RESUME),
    monitorDelete: monitor(CORE_UI_METHODS.MONITOR_DELETE),
    agentList: agent(CORE_UI_METHODS.AGENT_LIST),
    agentStatusRead: agent(CORE_UI_METHODS.AGENT_STATUS_READ),
    agentOutputRead: agent(CORE_UI_METHODS.AGENT_OUTPUT_READ),
    agentArtifactList: agent(CORE_UI_METHODS.AGENT_ARTIFACT_LIST),
    agentArtifactRead: agent(CORE_UI_METHODS.AGENT_ARTIFACT_READ),
    agentInterrupt: agent(CORE_UI_METHODS.AGENT_INTERRUPT),
    agentClose: agent(CORE_UI_METHODS.AGENT_CLOSE),
  };
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Multi-session ownership check for RPC results: the result must name the
 * exact session that issued the request. The server additionally allows
 * base-key matches (session_controls_target); the browser client only ever
 * speaks with its own wire session id, so strict equality is the fail-closed
 * choice — a foreign session's result must never repaint the selection.
 */
export function autonomySessionOwnsResult(
  expectedSessionId: string,
  resultSessionId: unknown,
): boolean {
  return (
    typeof resultSessionId === "string" && resultSessionId === expectedSessionId
  );
}

function isU64(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isOptionalU64(value: unknown): value is number | undefined {
  return value === undefined || isU64(value);
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

/**
 * rc11 wire truth: the RPC-result emitters (`autonomy_goal_json`,
 * `autonomy_loop_json`, `autonomy_monitor_json`, `autonomy_agent_json`)
 * build results with `json!`, which serializes Rust `Option::None` as an
 * explicit JSON `null` — it does NOT omit the key. (The typed notification
 * structs in ui_protocol.rs use `skip_serializing_if` and omit instead.)
 * Absent and null are therefore equivalent for exactly the audited nullable
 * fields below; normalizing null to absent is NOT a general relaxation —
 * required fields stay strictly required.
 */
function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function isOptionalU64OrNull(
  value: unknown,
): value is number | null | undefined {
  return isAbsent(value) || isU64(value);
}

function isOptionalTimestampOrNull(
  value: unknown,
): value is number | null | undefined {
  return isAbsent(value) || isTimestamp(value);
}

function isOptionalNonEmptyStringOrNull(
  value: unknown,
): value is string | null | undefined {
  return isAbsent(value) || isNonEmptyString(value);
}

function isOptionalStringOrNull(
  value: unknown,
): value is string | null | undefined {
  return isAbsent(value) || typeof value === "string";
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isOptionalTimestamp(value: unknown): value is number | undefined {
  return value === undefined || isTimestamp(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

// ---------------------------------------------------------------------------
// Goal records and RPC payloads
// ---------------------------------------------------------------------------

/** Mirrors UiGoalRecord / autonomy_goal_json. */
export interface AutonomyGoalRecord {
  profile_id?: string;
  goal_id: string;
  objective: string;
  status: string;
  token_budget: number;
  tokens_used: number;
  time_used_seconds: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export function parseAutonomyGoalRecord(
  value: unknown,
): AutonomyGoalRecord | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.goal_id) ||
    typeof value.objective !== "string" ||
    !isNonEmptyString(value.status) ||
    !isU64(value.token_budget) ||
    !isU64(value.tokens_used) ||
    !isU64(value.time_used_seconds) ||
    !isTimestamp(value.created_at_ms) ||
    !isTimestamp(value.updated_at_ms) ||
    !isOptionalNonEmptyString(value.profile_id)
  ) {
    return null;
  }
  return {
    goal_id: value.goal_id,
    objective: value.objective,
    status: value.status,
    token_budget: value.token_budget,
    tokens_used: value.tokens_used,
    time_used_seconds: value.time_used_seconds,
    created_at_ms: value.created_at_ms,
    updated_at_ms: value.updated_at_ms,
    ...(value.profile_id === undefined ? {} : { profile_id: value.profile_id }),
  };
}

export interface SessionGoalGetParams {
  session_id: string;
}

export interface SessionGoalGetResult {
  session_id: string;
  profile_id: string;
  goal: AutonomyGoalRecord | null;
}

/**
 * `session/goal/set` params. `token_budget` is forwarded ONLY when the user
 * explicitly set one — never defaulted or invented (the backend applies its
 * own default when the field is absent). Status/transition_actor are
 * similarly optional and validated client-side to the server's enum.
 */
export interface SessionGoalSetParams {
  session_id: string;
  objective: string;
  profile_id?: string;
  status?: string;
  token_budget?: number;
  transition_actor?: string;
}

export interface SessionGoalSetResult {
  session_id: string;
  profile_id: string;
  goal: AutonomyGoalRecord;
  generation: number;
  transition_actor: string;
}

export interface SessionGoalClearParams {
  session_id: string;
}

export interface SessionGoalClearResult {
  session_id: string;
  profile_id: string;
  cleared: boolean;
  goal: null;
  generation: number;
  transition_actor: string;
}

export function parseSessionGoalGetResult(
  value: unknown,
): SessionGoalGetResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !(value.goal === null || isRecord(value.goal))
  ) {
    return null;
  }
  const goal = value.goal === null ? null : parseAutonomyGoalRecord(value.goal);
  if (value.goal !== null && goal === null) return null;
  return { session_id: value.session_id, profile_id: value.profile_id, goal };
}

/** Server-side goal status enum (set_goal validation). */
export const GOAL_STATUSES = [
  "active",
  "paused",
  "budget_limited",
  "complete",
  "blocked",
] as const;

/** Server-side transition actor enum (set_goal validation). */
export const GOAL_TRANSITION_ACTORS = ["user", "backend", "model"] as const;

/** Native /goal pause, resume and stop map to these goal/set states. */
export type GoalTransitionStatus = "paused" | "active" | "complete";

/**
 * Client-side objective guard. The server enforces MAX_OBJECTIVE_BYTES on
 * bytes; the browser uses a conservative character bound so an over-long
 * objective fails before the wire instead of after.
 */
export const GOAL_MAX_OBJECTIVE_CHARS = 4_000;

export function buildSessionGoalSetParams(
  params: SessionGoalSetParams,
): SessionGoalSetParams | null {
  if (!isNonEmptyString(params.session_id)) return null;
  const objective = params.objective.trim();
  if (objective.length === 0 || objective.length > GOAL_MAX_OBJECTIVE_CHARS) {
    return null;
  }
  if (
    params.token_budget !== undefined &&
    (!Number.isSafeInteger(params.token_budget) || params.token_budget <= 0)
  ) {
    return null;
  }
  if (
    params.status !== undefined &&
    !GOAL_STATUSES.includes(params.status as (typeof GOAL_STATUSES)[number])
  ) {
    return null;
  }
  if (
    params.transition_actor !== undefined &&
    !GOAL_TRANSITION_ACTORS.includes(
      params.transition_actor as (typeof GOAL_TRANSITION_ACTORS)[number],
    )
  ) {
    return null;
  }
  if (params.profile_id !== undefined && params.profile_id.trim() === "") {
    return null;
  }
  return {
    session_id: params.session_id,
    objective,
    ...(params.profile_id === undefined
      ? {}
      : { profile_id: params.profile_id }),
    ...(params.status === undefined ? {} : { status: params.status }),
    ...(params.token_budget === undefined
      ? {}
      : { token_budget: params.token_budget }),
    ...(params.transition_actor === undefined
      ? {}
      : { transition_actor: params.transition_actor }),
  };
}

export function parseSessionGoalSetResult(
  value: unknown,
): SessionGoalSetResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !isU64(value.generation) ||
    !isNonEmptyString(value.transition_actor)
  ) {
    return null;
  }
  const goal = parseAutonomyGoalRecord(value.goal);
  if (!goal) return null;
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    goal,
    generation: value.generation,
    transition_actor: value.transition_actor,
  };
}

export function parseSessionGoalClearResult(
  value: unknown,
): SessionGoalClearResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    typeof value.cleared !== "boolean" ||
    value.goal !== null ||
    !isU64(value.generation) ||
    !isNonEmptyString(value.transition_actor)
  ) {
    return null;
  }
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    cleared: value.cleared,
    goal: null,
    generation: value.generation,
    transition_actor: value.transition_actor,
  };
}

// ---------------------------------------------------------------------------
// Goal notifications — #1959 generation ordering
// ---------------------------------------------------------------------------

export interface SessionGoalUpdatedEvent {
  session_id: string;
  profile_id?: string;
  goal: AutonomyGoalRecord;
  transition_actor: string;
  generation: number;
}

export interface SessionGoalClearedEvent {
  session_id: string;
  profile_id?: string;
  cleared: boolean;
  goal: AutonomyGoalRecord | null;
  transition_actor: string;
  generation: number;
}

export function parseSessionGoalUpdated(
  value: unknown,
): SessionGoalUpdatedEvent | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.transition_actor) ||
    !isU64(value.generation) ||
    !isOptionalNonEmptyString(value.profile_id)
  ) {
    return null;
  }
  const goal = parseAutonomyGoalRecord(value.goal);
  if (!goal) return null;
  return {
    session_id: value.session_id,
    transition_actor: value.transition_actor,
    generation: value.generation,
    goal,
    ...(value.profile_id === undefined ? {} : { profile_id: value.profile_id }),
  };
}

export function parseSessionGoalCleared(
  value: unknown,
): SessionGoalClearedEvent | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.transition_actor) ||
    !isU64(value.generation) ||
    typeof value.cleared !== "boolean" ||
    !isOptionalNonEmptyString(value.profile_id) ||
    !(value.goal === null || isRecord(value.goal))
  ) {
    return null;
  }
  const goal = value.goal === null ? null : parseAutonomyGoalRecord(value.goal);
  if (value.goal !== null && goal === null) return null;
  return {
    session_id: value.session_id,
    transition_actor: value.transition_actor,
    generation: value.generation,
    cleared: value.cleared,
    goal,
    ...(value.profile_id === undefined ? {} : { profile_id: value.profile_id }),
  };
}

/**
 * #1959 generation admission, mirroring the native TUI's
 * goal_event_generation_admits. `0` means an older backend that does not
 * stamp generations — always apply. Otherwise an event applies only when its
 * generation is strictly greater than the last applied goal event for the
 * same session, so a late pre-clear SessionGoalUpdated can never resurrect a
 * chip that a newer clear (or update) already superseded.
 */
export function goalEventGenerationAdmits(
  lastAppliedGeneration: number,
  eventGeneration: number,
): boolean {
  if (eventGeneration === 0) return true;
  if (lastAppliedGeneration === 0) return true;
  return eventGeneration > lastAppliedGeneration;
}

// ---------------------------------------------------------------------------
// Loop records and RPC payloads
// ---------------------------------------------------------------------------

/** Mirrors UiLoopRecord / autonomy_loop_json. */
export interface AutonomyLoopRecord {
  loop_id: string;
  session_id: string;
  profile_id?: string;
  prompt: string;
  mode: string;
  interval_seconds?: number;
  status: string;
  next_run_at_ms?: number;
  last_run_at_ms?: number;
  expires_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
}

function parseLoopRecord(value: unknown): AutonomyLoopRecord | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.loop_id) ||
    !isNonEmptyString(value.session_id) ||
    typeof value.prompt !== "string" ||
    !isNonEmptyString(value.mode) ||
    !isNonEmptyString(value.status) ||
    !isOptionalU64OrNull(value.interval_seconds) ||
    !isOptionalTimestampOrNull(value.next_run_at_ms) ||
    !isOptionalTimestampOrNull(value.last_run_at_ms) ||
    !isTimestamp(value.expires_at_ms) ||
    !isTimestamp(value.created_at_ms) ||
    !isTimestamp(value.updated_at_ms) ||
    !isOptionalNonEmptyStringOrNull(value.profile_id)
  ) {
    return null;
  }
  return {
    loop_id: value.loop_id,
    session_id: value.session_id,
    prompt: value.prompt,
    mode: value.mode,
    status: value.status,
    expires_at_ms: value.expires_at_ms,
    created_at_ms: value.created_at_ms,
    updated_at_ms: value.updated_at_ms,
    ...(isAbsent(value.interval_seconds)
      ? {}
      : { interval_seconds: value.interval_seconds }),
    ...(isAbsent(value.next_run_at_ms)
      ? {}
      : { next_run_at_ms: value.next_run_at_ms }),
    ...(isAbsent(value.last_run_at_ms)
      ? {}
      : { last_run_at_ms: value.last_run_at_ms }),
    ...(isAbsent(value.profile_id) ? {} : { profile_id: value.profile_id }),
  };
}

export interface LoopCreateParams {
  session_id: string;
  prompt?: string;
  /** Wire alias `command` — the `/loop <text>` shorthand, incl. interval. */
  command?: string;
  interval_seconds?: number;
  mode?: "fixed_interval" | "self_paced" | "maintenance";
}

/** Mirrors master_continuation_enqueue_json. */
export interface LoopFireOutcome {
  queued: boolean;
  duplicate?: boolean;
  continuation_id?: number;
  dedupe_key?: string;
  reason?: string;
  priority?: number;
  message?: string;
}

export interface LoopCreateResult {
  session_id: string;
  profile_id: string;
  loop_id: string;
  loop: AutonomyLoopRecord;
  ok: boolean;
  status: string;
  created: boolean;
  fire: LoopFireOutcome | null;
}

export interface LoopListParams {
  session_id?: string;
  profile_id?: string;
}

export interface LoopListResult {
  session_id: string | null;
  profile_id: string;
  loops: AutonomyLoopRecord[];
}

export interface LoopControlParams {
  loop_id: string;
  session_id?: string;
  profile_id?: string;
}

export interface LoopDeleteResult {
  session_id: string;
  loop_id: string;
  loop: AutonomyLoopRecord;
  ok: boolean;
  status: string;
  deleted: boolean;
  reaped_cron_job_ids: string[];
}

export interface LoopPauseResumeResult {
  session_id: string;
  loop_id: string;
  loop: AutonomyLoopRecord;
  ok: boolean;
  status: string;
}

export interface LoopFireNowResult {
  session_id: string;
  profile_id: string;
  loop_id: string;
  loop: AutonomyLoopRecord;
  ok: boolean;
  status: string;
  fire: LoopFireOutcome | null;
}

export const LOOP_MIN_INTERVAL_SECONDS = 60;
export const LOOP_MAX_INTERVAL_SECONDS = 86_400;
export const LOOP_MAX_PROMPT_BYTES = 8_192;

export function buildLoopCreateParams(
  params: LoopCreateParams,
): LoopCreateParams | null {
  if (!isNonEmptyString(params.session_id)) return null;
  if (
    params.mode !== undefined &&
    !["fixed_interval", "self_paced", "maintenance"].includes(params.mode)
  )
    return null;
  if (params.interval_seconds !== undefined) {
    if (
      !Number.isSafeInteger(params.interval_seconds) ||
      params.interval_seconds < LOOP_MIN_INTERVAL_SECONDS ||
      params.interval_seconds > LOOP_MAX_INTERVAL_SECONDS
    ) {
      return null;
    }
  }
  if (
    params.mode === "fixed_interval" &&
    params.interval_seconds === undefined
  ) {
    return null;
  }
  if (
    (params.prompt !== undefined &&
      (typeof params.prompt !== "string" ||
        (params.prompt.trim() === "" && params.mode !== "maintenance") ||
        new TextEncoder().encode(params.prompt.trim()).length >
          LOOP_MAX_PROMPT_BYTES)) ||
    (params.command !== undefined && params.command.trim() === "")
  ) {
    return null;
  }
  if (
    params.prompt === undefined &&
    params.command === undefined &&
    params.mode !== "maintenance"
  )
    return null;
  return {
    session_id: params.session_id,
    ...(params.prompt === undefined ? {} : { prompt: params.prompt }),
    ...(params.command === undefined ? {} : { command: params.command }),
    ...(params.interval_seconds === undefined
      ? {}
      : { interval_seconds: params.interval_seconds }),
    ...(params.mode === undefined ? {} : { mode: params.mode }),
  };
}

export function buildLoopControlParams(
  params: LoopControlParams,
): LoopControlParams | null {
  if (!isNonEmptyString(params.loop_id)) return null;
  if (
    (params.session_id !== undefined && !isNonEmptyString(params.session_id)) ||
    (params.profile_id !== undefined && params.profile_id.trim() === "")
  ) {
    return null;
  }
  return {
    loop_id: params.loop_id,
    ...(params.session_id === undefined
      ? {}
      : { session_id: params.session_id }),
    ...(params.profile_id === undefined
      ? {}
      : { profile_id: params.profile_id }),
  };
}

function parseLoopFireOutcome(value: unknown): LoopFireOutcome | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.queued !== "boolean") return null;
  if (
    (value.duplicate !== undefined && typeof value.duplicate !== "boolean") ||
    (value.continuation_id !== undefined && !isU64(value.continuation_id)) ||
    (value.dedupe_key !== undefined && typeof value.dedupe_key !== "string") ||
    (value.reason !== undefined && typeof value.reason !== "string") ||
    (value.priority !== undefined && !isU64(value.priority)) ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    return null;
  }
  return {
    queued: value.queued,
    ...(value.duplicate === undefined ? {} : { duplicate: value.duplicate }),
    ...(value.continuation_id === undefined
      ? {}
      : { continuation_id: value.continuation_id }),
    ...(value.dedupe_key === undefined ? {} : { dedupe_key: value.dedupe_key }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.priority === undefined ? {} : { priority: value.priority }),
    ...(value.message === undefined ? {} : { message: value.message }),
  };
}

export function parseLoopCreateResult(value: unknown): LoopCreateResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !isNonEmptyString(value.loop_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status) ||
    value.created !== true
  ) {
    return null;
  }
  const loop = parseLoopRecord(value.loop);
  if (!loop) return null;
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    loop_id: value.loop_id,
    loop,
    ok: value.ok,
    status: value.status,
    created: value.created,
    fire: parseLoopFireOutcome(value.fire),
  };
}

export function parseLoopListResult(value: unknown): LoopListResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.profile_id) ||
    !Array.isArray(value.loops) ||
    (value.session_id !== undefined &&
      value.session_id !== null &&
      !isNonEmptyString(value.session_id))
  ) {
    return null;
  }
  const loops = value.loops.map(parseLoopRecord);
  if (loops.some((entry) => entry === null)) return null;
  return {
    session_id:
      value.session_id === undefined || value.session_id === null
        ? null
        : value.session_id,
    profile_id: value.profile_id,
    loops: loops as AutonomyLoopRecord[],
  };
}

export function parseLoopDeleteResult(value: unknown): LoopDeleteResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.loop_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status) ||
    value.deleted !== true ||
    !Array.isArray(value.reaped_cron_job_ids) ||
    !isStringArray(value.reaped_cron_job_ids)
  ) {
    return null;
  }
  const loop = parseLoopRecord(value.loop);
  if (!loop) return null;
  return {
    session_id: value.session_id,
    loop_id: value.loop_id,
    loop,
    ok: value.ok,
    status: value.status,
    deleted: value.deleted,
    reaped_cron_job_ids: value.reaped_cron_job_ids,
  };
}

export function parseLoopPauseResumeResult(
  value: unknown,
): LoopPauseResumeResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.loop_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status)
  ) {
    return null;
  }
  const loop = parseLoopRecord(value.loop);
  if (!loop) return null;
  return {
    session_id: value.session_id,
    loop_id: value.loop_id,
    loop,
    ok: value.ok,
    status: value.status,
  };
}

export function parseLoopFireNowResult(
  value: unknown,
): LoopFireNowResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !isNonEmptyString(value.loop_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status)
  ) {
    return null;
  }
  const loop = parseLoopRecord(value.loop);
  if (!loop) return null;
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    loop_id: value.loop_id,
    loop,
    ok: value.ok,
    status: value.status,
    fire: parseLoopFireOutcome(value.fire),
  };
}

// ---------------------------------------------------------------------------
// Monitor records and RPC payloads (#1977)
// ---------------------------------------------------------------------------

/** Mirrors UiMonitorRecord / autonomy_monitor_json. */
export interface AutonomyMonitorRecord {
  monitor_id: string;
  session_id: string;
  profile_id?: string;
  name: string;
  argv: string[];
  filter_regex?: string;
  mode: string;
  interval_seconds?: number;
  batch_ms: number;
  max_events_per_hour: number;
  persistent: boolean;
  status: string;
  pause_reason?: string;
  goal_id?: string;
  last_fired_at_ms?: number;
  fires_used: number;
  expires_at_ms?: number;
  created_at_ms: number;
  updated_at_ms: number;
}

function parseMonitorRecord(value: unknown): AutonomyMonitorRecord | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.monitor_id) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.name) ||
    !isStringArray(value.argv) ||
    !isNonEmptyString(value.mode) ||
    !isU64(value.batch_ms) ||
    !isU64(value.max_events_per_hour) ||
    typeof value.persistent !== "boolean" ||
    !isNonEmptyString(value.status) ||
    !isU64(value.fires_used) ||
    !isTimestamp(value.created_at_ms) ||
    !isTimestamp(value.updated_at_ms) ||
    !isOptionalStringOrNull(value.filter_regex) ||
    !isOptionalU64OrNull(value.interval_seconds) ||
    !isOptionalTimestampOrNull(value.last_fired_at_ms) ||
    !isOptionalTimestampOrNull(value.expires_at_ms) ||
    !isOptionalNonEmptyStringOrNull(value.pause_reason) ||
    !isOptionalNonEmptyStringOrNull(value.goal_id) ||
    !isOptionalNonEmptyStringOrNull(value.profile_id)
  ) {
    return null;
  }
  return {
    monitor_id: value.monitor_id,
    session_id: value.session_id,
    name: value.name,
    argv: value.argv,
    mode: value.mode,
    batch_ms: value.batch_ms,
    max_events_per_hour: value.max_events_per_hour,
    persistent: value.persistent,
    status: value.status,
    fires_used: value.fires_used,
    created_at_ms: value.created_at_ms,
    updated_at_ms: value.updated_at_ms,
    ...(isAbsent(value.filter_regex)
      ? {}
      : { filter_regex: value.filter_regex }),
    ...(isAbsent(value.interval_seconds)
      ? {}
      : { interval_seconds: value.interval_seconds }),
    ...(isAbsent(value.last_fired_at_ms)
      ? {}
      : { last_fired_at_ms: value.last_fired_at_ms }),
    ...(isAbsent(value.expires_at_ms)
      ? {}
      : { expires_at_ms: value.expires_at_ms }),
    ...(isAbsent(value.pause_reason)
      ? {}
      : { pause_reason: value.pause_reason }),
    ...(isAbsent(value.goal_id) ? {} : { goal_id: value.goal_id }),
    ...(isAbsent(value.profile_id) ? {} : { profile_id: value.profile_id }),
  };
}

export type MonitorMode = "poll" | "stream";

export interface MonitorCreateParams {
  session_id: string;
  name: string;
  argv: string[];
  filter_regex?: string;
  mode?: MonitorMode;
  interval_seconds?: number;
  batch_ms?: number;
  timeout_secs?: number;
  persistent?: boolean;
  max_events_per_hour?: number;
  goal_id?: string;
}

export interface MonitorCreateResult {
  session_id: string;
  profile_id: string;
  monitor_id: string;
  monitor: AutonomyMonitorRecord;
  ok: boolean;
  status: string;
  created: boolean;
}

export interface MonitorListResult {
  session_id: string | null;
  profile_id: string;
  monitors: AutonomyMonitorRecord[];
}

export interface MonitorControlParams {
  monitor_id: string;
  session_id?: string;
  profile_id?: string;
}

export interface MonitorControlResult {
  session_id: string;
  profile_id: string;
  monitor_id: string;
  monitor: AutonomyMonitorRecord;
  ok: boolean;
  status: string;
  deleted: boolean;
}

export function buildMonitorCreateParams(
  params: MonitorCreateParams,
): MonitorCreateParams | null {
  if (
    !isNonEmptyString(params.session_id) ||
    !isNonEmptyString(params.name) ||
    !isStringArray(params.argv) ||
    params.argv.length === 0
  ) {
    return null;
  }
  if (
    (params.filter_regex !== undefined &&
      typeof params.filter_regex !== "string") ||
    (params.batch_ms !== undefined && !isU64(params.batch_ms)) ||
    (params.timeout_secs !== undefined && !isU64(params.timeout_secs)) ||
    (params.max_events_per_hour !== undefined &&
      !isU64(params.max_events_per_hour)) ||
    (params.persistent !== undefined &&
      typeof params.persistent !== "boolean") ||
    (params.goal_id !== undefined && typeof params.goal_id !== "string") ||
    (params.interval_seconds !== undefined && !isU64(params.interval_seconds))
  ) {
    return null;
  }
  // An unknown mode is a typed server error, never a silent poll fallback —
  // reject it before the wire (transport, #1977 blocker 6).
  if (
    params.mode !== undefined &&
    params.mode !== "poll" &&
    params.mode !== "stream"
  ) {
    return null;
  }
  return {
    session_id: params.session_id,
    name: params.name.trim(),
    argv: params.argv,
    ...(params.filter_regex === undefined
      ? {}
      : { filter_regex: params.filter_regex }),
    ...(params.mode === undefined ? {} : { mode: params.mode }),
    ...(params.interval_seconds === undefined
      ? {}
      : { interval_seconds: params.interval_seconds }),
    ...(params.batch_ms === undefined ? {} : { batch_ms: params.batch_ms }),
    ...(params.timeout_secs === undefined
      ? {}
      : { timeout_secs: params.timeout_secs }),
    ...(params.persistent === undefined
      ? {}
      : { persistent: params.persistent }),
    ...(params.max_events_per_hour === undefined
      ? {}
      : { max_events_per_hour: params.max_events_per_hour }),
    ...(params.goal_id === undefined ? {} : { goal_id: params.goal_id }),
  };
}

export function buildMonitorControlParams(
  params: MonitorControlParams,
): MonitorControlParams | null {
  if (!isNonEmptyString(params.monitor_id)) return null;
  if (
    (params.session_id !== undefined && !isNonEmptyString(params.session_id)) ||
    (params.profile_id !== undefined && params.profile_id.trim() === "")
  ) {
    return null;
  }
  return {
    monitor_id: params.monitor_id,
    ...(params.session_id === undefined
      ? {}
      : { session_id: params.session_id }),
    ...(params.profile_id === undefined
      ? {}
      : { profile_id: params.profile_id }),
  };
}

export function parseMonitorCreateResult(
  value: unknown,
): MonitorCreateResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !isNonEmptyString(value.monitor_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status) ||
    value.created !== true
  ) {
    return null;
  }
  const monitor = parseMonitorRecord(value.monitor);
  if (!monitor) return null;
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    monitor_id: value.monitor_id,
    monitor,
    ok: value.ok,
    status: value.status,
    created: value.created,
  };
}

export function parseMonitorListResult(
  value: unknown,
): MonitorListResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.profile_id) ||
    !Array.isArray(value.monitors) ||
    (value.session_id !== undefined &&
      value.session_id !== null &&
      !isNonEmptyString(value.session_id))
  ) {
    return null;
  }
  const monitors = value.monitors.map(parseMonitorRecord);
  if (monitors.some((entry) => entry === null)) return null;
  return {
    session_id:
      value.session_id === undefined || value.session_id === null
        ? null
        : value.session_id,
    profile_id: value.profile_id,
    monitors: monitors as AutonomyMonitorRecord[],
  };
}

export function parseMonitorControlResult(
  value: unknown,
): MonitorControlResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.profile_id) ||
    !isNonEmptyString(value.monitor_id) ||
    value.ok !== true ||
    !isNonEmptyString(value.status) ||
    typeof value.deleted !== "boolean"
  ) {
    return null;
  }
  const monitor = parseMonitorRecord(value.monitor);
  if (!monitor) return null;
  return {
    session_id: value.session_id,
    profile_id: value.profile_id,
    monitor_id: value.monitor_id,
    monitor,
    ok: value.ok,
    status: value.status,
    deleted: value.deleted,
  };
}

// ---------------------------------------------------------------------------
// Agent inspection and control payloads
// ---------------------------------------------------------------------------

export interface AutonomyAgentArtifact {
  id: string;
  title: string;
  kind: string;
  status: string;
  path?: string;
}

/** Mirrors UiAgentRecord / autonomy_agent_json (fields the UI renders). */
export interface AutonomyAgentRecord {
  agent_id: string;
  session_id: string;
  path: string;
  role: string;
  nickname: string;
  backend_kind: string;
  status: string;
  profile_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  artifact_count: number;
  artifacts: AutonomyAgentArtifact[];
  parent_agent_id?: string;
  task_id?: string;
  title?: string;
  last_task?: string;
  summary?: string;
  output_tail?: string;
  cwd?: string;
}

export function parseAgentArtifact(
  value: unknown,
): AutonomyAgentArtifact | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.kind) ||
    !isNonEmptyString(value.status) ||
    !isOptionalStringOrNull(value.path)
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    kind: value.kind,
    status: value.status,
    ...(isAbsent(value.path) ? {} : { path: value.path }),
  };
}

export function parseAutonomyAgentRecord(
  value: unknown,
): AutonomyAgentRecord | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.agent_id) ||
    !isNonEmptyString(value.session_id) ||
    typeof value.path !== "string" ||
    !isNonEmptyString(value.role) ||
    !isNonEmptyString(value.nickname) ||
    !isNonEmptyString(value.backend_kind) ||
    !isNonEmptyString(value.status) ||
    !isNonEmptyString(value.profile_id) ||
    !isTimestamp(value.created_at_ms) ||
    !isTimestamp(value.updated_at_ms) ||
    !isU64(value.artifact_count) ||
    !Array.isArray(value.artifacts) ||
    !isOptionalNonEmptyStringOrNull(value.parent_agent_id) ||
    !isOptionalNonEmptyStringOrNull(value.task_id) ||
    !isOptionalNonEmptyStringOrNull(value.title) ||
    !isOptionalNonEmptyStringOrNull(value.last_task) ||
    !isOptionalNonEmptyStringOrNull(value.summary) ||
    !isOptionalStringOrNull(value.output_tail) ||
    !isOptionalStringOrNull(value.cwd)
  ) {
    return null;
  }
  const artifacts = value.artifacts.map(parseAgentArtifact);
  if (artifacts.some((entry) => entry === null)) return null;
  return {
    agent_id: value.agent_id,
    session_id: value.session_id,
    path: value.path,
    role: value.role,
    nickname: value.nickname,
    backend_kind: value.backend_kind,
    status: value.status,
    profile_id: value.profile_id,
    created_at_ms: value.created_at_ms,
    updated_at_ms: value.updated_at_ms,
    artifact_count: value.artifact_count,
    artifacts: artifacts as AutonomyAgentArtifact[],
    ...(isAbsent(value.parent_agent_id)
      ? {}
      : { parent_agent_id: value.parent_agent_id }),
    ...(isAbsent(value.task_id) ? {} : { task_id: value.task_id }),
    ...(isAbsent(value.title) ? {} : { title: value.title }),
    ...(isAbsent(value.last_task) ? {} : { last_task: value.last_task }),
    ...(isAbsent(value.summary) ? {} : { summary: value.summary }),
    ...(isAbsent(value.output_tail) ? {} : { output_tail: value.output_tail }),
    ...(isAbsent(value.cwd) ? {} : { cwd: value.cwd }),
  };
}

export interface AgentListResult {
  session_id: string | null;
  profile_id: string;
  agents: AutonomyAgentRecord[];
}

export interface AgentStatusReadResult {
  session_id: string;
  agent: AutonomyAgentRecord;
}

/** Native artifact read accepts an ID or a path; never send two selectors. */
export type AgentArtifactSelector =
  { artifactId: string; path?: never } | { path: string; artifactId?: never };

export interface AgentArtifactListResult {
  session_id: string;
  agent_id: string;
  artifacts: AutonomyAgentArtifact[];
}

export interface AgentArtifactReadResult {
  session_id: string;
  agent_id: string;
  artifact: AutonomyAgentArtifact;
  /** Only the top-level read content is returned: Core redacts it here. */
  content: string | null;
}

/** Pinned orchestrator update_agent_terminal_status returns no nested agent. */
export interface AgentControlResult {
  session_id: string;
  agent_id: string;
  status: "interrupted" | "closed";
  ok: true;
  interrupted: boolean;
  closed: boolean;
  already_terminal: boolean;
}

export function parseAgentArtifactListResult(
  value: unknown,
): AgentArtifactListResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.agent_id) ||
    !Array.isArray(value.artifacts)
  )
    return null;
  const artifacts = value.artifacts.map(parseAgentArtifact);
  if (artifacts.some((artifact) => artifact === null)) return null;
  return {
    session_id: value.session_id,
    agent_id: value.agent_id,
    artifacts: artifacts as AutonomyAgentArtifact[],
  };
}

export function parseAgentArtifactReadResult(
  value: unknown,
): AgentArtifactReadResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.agent_id) ||
    !(value.content === null || typeof value.content === "string")
  )
    return null;
  const artifact = parseAgentArtifact(value.artifact);
  if (!artifact) return null;
  return {
    session_id: value.session_id,
    agent_id: value.agent_id,
    artifact,
    content: value.content,
  };
}

export function parseAgentControlResult(
  value: unknown,
): AgentControlResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.agent_id) ||
    value.ok !== true ||
    (value.status !== "interrupted" && value.status !== "closed") ||
    typeof value.already_terminal !== "boolean" ||
    value.interrupted !== (value.status === "interrupted") ||
    value.closed !== (value.status === "closed")
  )
    return null;
  return {
    session_id: value.session_id,
    agent_id: value.agent_id,
    status: value.status,
    ok: true,
    interrupted: value.interrupted,
    closed: value.closed,
    already_terminal: value.already_terminal,
  };
}

export interface AgentOutputCursor {
  offset: number;
}

export interface AgentOutputReadParams {
  agent_id: string;
  session_id?: string;
  cursor?: AgentOutputCursor;
  limit?: number;
}

export interface AgentOutputReadResult {
  agent_id: string;
  session_id: string;
  source: string;
  text: string;
  cursor: AgentOutputCursor | null;
  next_cursor: AgentOutputCursor | null;
  has_more: boolean;
  complete: boolean;
}

export function parseAgentListResult(value: unknown): AgentListResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.profile_id) ||
    !Array.isArray(value.agents) ||
    (value.session_id !== undefined &&
      value.session_id !== null &&
      !isNonEmptyString(value.session_id))
  ) {
    return null;
  }
  const agents = value.agents.map(parseAutonomyAgentRecord);
  if (agents.some((entry) => entry === null)) return null;
  return {
    session_id:
      value.session_id === undefined || value.session_id === null
        ? null
        : value.session_id,
    profile_id: value.profile_id,
    agents: agents as AutonomyAgentRecord[],
  };
}

export function parseAgentStatusReadResult(
  value: unknown,
): AgentStatusReadResult | null {
  if (!isRecord(value) || !isNonEmptyString(value.session_id)) return null;
  const agent = parseAutonomyAgentRecord(value.agent);
  if (!agent) return null;
  return { session_id: value.session_id, agent };
}

function parseAgentOutputCursor(value: unknown): AgentOutputCursor | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !isU64(value.offset)) return null;
  return { offset: value.offset };
}

export function parseAgentOutputReadResult(
  value: unknown,
): AgentOutputReadResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.agent_id) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.source) ||
    typeof value.text !== "string" ||
    typeof value.has_more !== "boolean" ||
    typeof value.complete !== "boolean"
  ) {
    return null;
  }
  const cursor = parseAgentOutputCursor(value.cursor);
  const nextCursor = parseAgentOutputCursor(value.next_cursor);
  if (
    (value.cursor !== null && value.cursor !== undefined && cursor === null) ||
    (value.next_cursor !== null &&
      value.next_cursor !== undefined &&
      nextCursor === null)
  ) {
    return null;
  }
  return {
    agent_id: value.agent_id,
    session_id: value.session_id,
    source: value.source,
    text: value.text,
    cursor,
    next_cursor: nextCursor,
    has_more: value.has_more,
    complete: value.complete,
  };
}

// ---------------------------------------------------------------------------
// Autonomy notifications
// ---------------------------------------------------------------------------

export interface LoopUpdatedEvent {
  session_id: string;
  profile_id?: string;
  loop_id?: string;
  loop: AutonomyLoopRecord;
  ok?: boolean;
  status?: string;
  deleted?: boolean;
}

export interface LoopFiredEvent {
  session_id: string;
  profile_id?: string;
  loop_id: string;
  loop?: AutonomyLoopRecord;
  fire?: LoopFireOutcome | null;
  ok?: boolean;
  status?: string;
}

export interface LoopCompletedEvent {
  session_id: string;
  profile_id?: string;
  loop_id: string;
  loop?: AutonomyLoopRecord;
  status?: string;
  completed_at_ms?: number;
  error?: string;
}

export interface MonitorUpdatedEvent {
  session_id: string;
  profile_id?: string;
  monitor_id?: string;
  monitor: AutonomyMonitorRecord;
  ok?: boolean;
  status?: string;
  deleted?: boolean;
}

export interface MonitorFiredEvent {
  session_id: string;
  profile_id?: string;
  monitor_id: string;
  name?: string;
  line_count?: number;
  fired_at_ms?: number;
}

export interface MonitorExpiredEvent {
  session_id: string;
  profile_id?: string;
  monitor_id: string;
  monitor?: AutonomyMonitorRecord;
  status?: string;
  expired_at_ms?: number;
  reason?: string;
}

export interface AgentUpdatedEvent {
  session_id: string;
  agent: AutonomyAgentRecord;
}

export type AutonomyNotification =
  | { kind: "goal_updated"; event: SessionGoalUpdatedEvent }
  | { kind: "goal_cleared"; event: SessionGoalClearedEvent }
  | { kind: "loop_updated"; event: LoopUpdatedEvent }
  | { kind: "loop_fired"; event: LoopFiredEvent }
  | { kind: "loop_completed"; event: LoopCompletedEvent }
  | { kind: "monitor_updated"; event: MonitorUpdatedEvent }
  | { kind: "monitor_fired"; event: MonitorFiredEvent }
  | { kind: "monitor_expired"; event: MonitorExpiredEvent }
  | { kind: "agent_updated"; event: AgentUpdatedEvent };

function parseOptionalNested<T>(
  value: unknown,
  parse: (input: unknown) => T | null,
): T | undefined | null {
  if (value === undefined || value === null) return undefined;
  return parse(value);
}

/** Permission scope and identity agreement are different: an envelope and
 * its nested snapshot describe ONE resource, even when requests may control
 * a sibling topic. Optional envelope IDs, when supplied, must agree too. */
function nestedRecordAgrees(
  envelopeSessionId: unknown,
  envelopeId: unknown,
  nestedSessionId: string,
  nestedId: string,
): boolean {
  return (
    envelopeSessionId === nestedSessionId &&
    (envelopeId === undefined || envelopeId === nestedId)
  );
}

export function parseAutonomyNotification(
  notification: RpcNotification,
): AutonomyNotification | null {
  if (!isRecord(notification.params)) return null;
  const value = notification.params;
  switch (notification.method) {
    case CORE_UI_METHODS.SESSION_GOAL_UPDATED: {
      const event = parseSessionGoalUpdated(value);
      return event ? { kind: "goal_updated", event } : null;
    }
    case CORE_UI_METHODS.SESSION_GOAL_CLEARED: {
      const event = parseSessionGoalCleared(value);
      return event ? { kind: "goal_cleared", event } : null;
    }
    case CORE_UI_METHODS.LOOP_UPDATED: {
      const loop = parseLoopRecord(value.loop);
      if (
        !isNonEmptyString(value.session_id) ||
        !loop ||
        !nestedRecordAgrees(
          value.session_id,
          value.loop_id,
          loop.session_id,
          loop.loop_id,
        ) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalNonEmptyString(value.loop_id) ||
        !isOptionalBoolean(value.ok) ||
        !isOptionalNonEmptyString(value.status) ||
        !isOptionalBoolean(value.deleted)
      ) {
        return null;
      }
      return {
        kind: "loop_updated",
        event: {
          session_id: value.session_id,
          loop,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(value.loop_id === undefined ? {} : { loop_id: value.loop_id }),
          ...(value.ok === undefined ? {} : { ok: value.ok }),
          ...(value.status === undefined ? {} : { status: value.status }),
          ...(value.deleted === undefined ? {} : { deleted: value.deleted }),
        },
      };
    }
    case CORE_UI_METHODS.LOOP_FIRED: {
      if (
        !isNonEmptyString(value.session_id) ||
        !isNonEmptyString(value.loop_id) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalBoolean(value.ok) ||
        !isOptionalNonEmptyString(value.status)
      ) {
        return null;
      }
      const loop = parseOptionalNested(value.loop, parseLoopRecord);
      if (loop === null) return null;
      if (
        loop &&
        !nestedRecordAgrees(
          value.session_id,
          value.loop_id,
          loop.session_id,
          loop.loop_id,
        )
      )
        return null;
      const fire = parseOptionalNested(value.fire, parseLoopFireOutcome);
      if (fire === null) return null;
      return {
        kind: "loop_fired",
        event: {
          session_id: value.session_id,
          loop_id: value.loop_id,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(loop === undefined ? {} : { loop }),
          ...(fire === undefined ? {} : { fire }),
          ...(value.ok === undefined ? {} : { ok: value.ok }),
          ...(value.status === undefined ? {} : { status: value.status }),
        },
      };
    }
    case CORE_UI_METHODS.LOOP_COMPLETED: {
      if (
        !isNonEmptyString(value.session_id) ||
        !isNonEmptyString(value.loop_id) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalNonEmptyString(value.status) ||
        !isOptionalTimestamp(value.completed_at_ms) ||
        (value.error !== undefined && typeof value.error !== "string")
      ) {
        return null;
      }
      const loop = parseOptionalNested(value.loop, parseLoopRecord);
      if (loop === null) return null;
      if (
        loop &&
        !nestedRecordAgrees(
          value.session_id,
          value.loop_id,
          loop.session_id,
          loop.loop_id,
        )
      )
        return null;
      return {
        kind: "loop_completed",
        event: {
          session_id: value.session_id,
          loop_id: value.loop_id,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(loop === undefined ? {} : { loop }),
          ...(value.status === undefined ? {} : { status: value.status }),
          ...(value.completed_at_ms === undefined
            ? {}
            : { completed_at_ms: value.completed_at_ms }),
          ...(value.error === undefined ? {} : { error: value.error }),
        },
      };
    }
    case CORE_UI_METHODS.MONITOR_UPDATED: {
      const monitor = parseMonitorRecord(value.monitor);
      if (
        !isNonEmptyString(value.session_id) ||
        !monitor ||
        !nestedRecordAgrees(
          value.session_id,
          value.monitor_id,
          monitor.session_id,
          monitor.monitor_id,
        ) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalNonEmptyString(value.monitor_id) ||
        !isOptionalBoolean(value.ok) ||
        !isOptionalNonEmptyString(value.status) ||
        !isOptionalBoolean(value.deleted)
      ) {
        return null;
      }
      return {
        kind: "monitor_updated",
        event: {
          session_id: value.session_id,
          monitor,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(value.monitor_id === undefined
            ? {}
            : { monitor_id: value.monitor_id }),
          ...(value.ok === undefined ? {} : { ok: value.ok }),
          ...(value.status === undefined ? {} : { status: value.status }),
          ...(value.deleted === undefined ? {} : { deleted: value.deleted }),
        },
      };
    }
    case CORE_UI_METHODS.MONITOR_FIRED: {
      if (
        !isNonEmptyString(value.session_id) ||
        !isNonEmptyString(value.monitor_id) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalNonEmptyString(value.name) ||
        !isOptionalU64(value.line_count) ||
        !isOptionalTimestamp(value.fired_at_ms)
      ) {
        return null;
      }
      return {
        kind: "monitor_fired",
        event: {
          session_id: value.session_id,
          monitor_id: value.monitor_id,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(value.name === undefined ? {} : { name: value.name }),
          ...(value.line_count === undefined
            ? {}
            : { line_count: value.line_count }),
          ...(value.fired_at_ms === undefined
            ? {}
            : { fired_at_ms: value.fired_at_ms }),
        },
      };
    }
    case CORE_UI_METHODS.MONITOR_EXPIRED: {
      if (
        !isNonEmptyString(value.session_id) ||
        !isNonEmptyString(value.monitor_id) ||
        !isOptionalNonEmptyString(value.profile_id) ||
        !isOptionalNonEmptyString(value.status) ||
        !isOptionalTimestamp(value.expired_at_ms) ||
        (value.reason !== undefined && typeof value.reason !== "string")
      ) {
        return null;
      }
      const monitor = parseOptionalNested(value.monitor, parseMonitorRecord);
      if (monitor === null) return null;
      if (
        monitor &&
        !nestedRecordAgrees(
          value.session_id,
          value.monitor_id,
          monitor.session_id,
          monitor.monitor_id,
        )
      )
        return null;
      return {
        kind: "monitor_expired",
        event: {
          session_id: value.session_id,
          monitor_id: value.monitor_id,
          ...(value.profile_id === undefined
            ? {}
            : { profile_id: value.profile_id }),
          ...(monitor === undefined ? {} : { monitor }),
          ...(value.status === undefined ? {} : { status: value.status }),
          ...(value.expired_at_ms === undefined
            ? {}
            : { expired_at_ms: value.expired_at_ms }),
          ...(value.reason === undefined ? {} : { reason: value.reason }),
        },
      };
    }
    case CORE_UI_METHODS.AGENT_UPDATED: {
      if (!isNonEmptyString(value.session_id)) return null;
      const agent = parseAutonomyAgentRecord(value.agent);
      if (!agent) return null;
      if (
        !nestedRecordAgrees(
          value.session_id,
          value.agent_id,
          agent.session_id,
          agent.agent_id,
        )
      )
        return null;
      return {
        kind: "agent_updated",
        event: { session_id: value.session_id, agent },
      };
    }
    default:
      return null;
  }
}

/** Methods whose notifications the autonomy surface consumes. */
export const AUTONOMY_NOTIFICATION_METHODS: readonly string[] = [
  CORE_UI_METHODS.SESSION_GOAL_UPDATED,
  CORE_UI_METHODS.SESSION_GOAL_CLEARED,
  CORE_UI_METHODS.LOOP_UPDATED,
  CORE_UI_METHODS.LOOP_FIRED,
  CORE_UI_METHODS.LOOP_COMPLETED,
  CORE_UI_METHODS.MONITOR_UPDATED,
  CORE_UI_METHODS.MONITOR_FIRED,
  CORE_UI_METHODS.MONITOR_EXPIRED,
  CORE_UI_METHODS.AGENT_UPDATED,
];

// ---------------------------------------------------------------------------
// Narrow RPC facade — the single integration seam for the host app.
//
// `OctosUiClient.request` stays private by design. The host injects the
// minimal adapter below (structurally `{ request: (method, params) =>
// this.request(method, params) }`) and receives fully typed, fail-closed
// commands: client-side param validation, result parsing, and an owning-
// session check on every result.
// ---------------------------------------------------------------------------

/** Minimal adapter the host app injects; no client internals leak through. */
export interface AutonomyRpc {
  request(method: string, params: unknown): Promise<unknown>;
}

export class AutonomyProtocolError extends Error {
  constructor(method: string, reason: string) {
    super(`${method} failed: ${reason}`);
    this.name = "AutonomyProtocolError";
  }
}

async function validatedRequest<T>(
  rpc: AutonomyRpc,
  method: string,
  params: unknown,
  parse: (value: unknown) => T | null,
): Promise<T> {
  const result = await rpc.request(method, params);
  const parsed = parse(result);
  if (!parsed) {
    throw new AutonomyProtocolError(method, "invalid result payload");
  }
  return parsed;
}

function requireSessionMatch(
  method: string,
  expected: string,
  actual: string,
): void {
  if (actual !== expected) {
    throw new AutonomyProtocolError(
      method,
      `result session ${JSON.stringify(actual)} does not match owning session ${JSON.stringify(expected)}`,
    );
  }
}

/** Mirrors SessionKey::base_key — strip the `#topic` suffix. */
function sessionBaseKey(sessionId: string): string {
  const topicIndex = sessionId.indexOf("#");
  return topicIndex === -1 ? sessionId : sessionId.slice(0, topicIndex);
}

/**
 * Mirrors Core's `session_controls_target`: exact match, or base-key match
 * so a topic-scoped request may see its base session's records (and only
 * those).
 */
export function sessionControlsTarget(
  requested: string,
  target: string,
): boolean {
  return (
    requested === target || sessionBaseKey(requested) === sessionBaseKey(target)
  );
}

/**
 * Scoped list envelopes MUST exactly echo the requested session (rc11
 * `list_*` results carry `request.session_id`). A wrong or null envelope is
 * a protocol error — never silently reinterpreted before child projection.
 */
function requireListEnvelope(
  method: string,
  resultSessionId: string | null,
  sessionId: string,
): void {
  if (resultSessionId !== sessionId) {
    throw new AutonomyProtocolError(
      method,
      `list envelope session ${JSON.stringify(resultSessionId)} does not exactly match the requested session`,
    );
  }
}

/**
 * Single-resource guard (rc11 `ensure_*_scope` mirror): the server enforces
 * profile; the client verifies the result's ACTUAL owner session lies in
 * the requester's base/topic scope and that the resource id is exactly the
 * one requested. A single read returns the resource's real owner — it must
 * NOT be forced to look like the querying topic.
 */
function requireResourceScope(
  method: string,
  sessionId: string,
  actualSessionId: string,
  resourceLabel: string,
  requestedId: string,
  actualId: string,
): void {
  if (!sessionControlsTarget(sessionId, actualSessionId)) {
    throw new AutonomyProtocolError(
      method,
      `${resourceLabel} owner session ${JSON.stringify(actualSessionId)} is outside the requested base/topic scope`,
    );
  }
  if (actualId !== requestedId) {
    throw new AutonomyProtocolError(
      method,
      `${resourceLabel} id ${JSON.stringify(actualId)} does not match the requested id`,
    );
  }
}

/**
 * Nested-record agreement for control results: the envelope's resource id
 * and the nested `loop`/`monitor` record's id must match EXACTLY, and the
 * nested record's owner session must exactly match the envelope's session.
 * Base/topic scope applies only to request permission. Without this, a foreign
 * nested record (right shape, wrong resource) would pass the envelope check
 * and be upserted into the selected session's state.
 */
function requireNestedRecordAgreement(
  method: string,
  label: string,
  envelopeSessionId: string,
  envelopeId: string,
  nestedSessionId: string,
  nestedId: string,
): void {
  if (nestedId !== envelopeId) {
    throw new AutonomyProtocolError(
      method,
      `nested ${label} id ${JSON.stringify(nestedId)} does not match the envelope id ${JSON.stringify(envelopeId)}`,
    );
  }
  if (envelopeSessionId !== nestedSessionId) {
    throw new AutonomyProtocolError(
      method,
      `nested ${label} owner session ${JSON.stringify(nestedSessionId)} does not agree with envelope session ${JSON.stringify(envelopeSessionId)}`,
    );
  }
}

/**
 * #Scope guard for scoped lists. The server already filters by
 * `session_controls_target` (agent_orchestrator.rs list_* guards), but the
 * client re-validates every returned child so a wrong-session or
 * profile-wide response can never populate the selected session's state.
 */
function filterLoopListScope(
  result: LoopListResult,
  sessionId: string | null,
): LoopListResult {
  if (sessionId === null) return result;
  return {
    ...result,
    loops: result.loops.filter((entry) =>
      sessionControlsTarget(sessionId, entry.session_id),
    ),
  };
}

function filterMonitorListScope(
  result: MonitorListResult,
  sessionId: string | null,
): MonitorListResult {
  if (sessionId === null) return result;
  return {
    ...result,
    monitors: result.monitors.filter((entry) =>
      sessionControlsTarget(sessionId, entry.session_id),
    ),
  };
}

function filterAgentListScope(
  result: AgentListResult,
  sessionId: string | null,
): AgentListResult {
  if (sessionId === null) return result;
  return {
    ...result,
    agents: result.agents.filter((entry) =>
      sessionControlsTarget(sessionId, entry.session_id),
    ),
  };
}

/** Raw (session-per-call) autonomy commands over an injected adapter. */
export interface AutonomyCommands {
  capabilitiesFrom: (
    capabilities: UiProtocolCapabilities | undefined,
  ) => AutonomyCapabilities;
  goal: {
    readGoal(sessionId: string): Promise<SessionGoalGetResult>;
    setGoal(
      sessionId: string,
      objective: string,
      tokenBudget?: number,
    ): Promise<SessionGoalSetResult>;
    clearGoal(sessionId: string): Promise<SessionGoalClearResult>;
    transitionGoal(
      sessionId: string,
      objective: string,
      status: GoalTransitionStatus,
    ): Promise<SessionGoalSetResult>;
  };
  loop: {
    createLoop(params: LoopCreateParams): Promise<LoopCreateResult>;
    listLoops(sessionId: string | null): Promise<LoopListResult>;
    deleteLoop(loopId: string, sessionId: string): Promise<LoopDeleteResult>;
    pauseLoop(
      loopId: string,
      sessionId: string,
    ): Promise<LoopPauseResumeResult>;
    resumeLoop(
      loopId: string,
      sessionId: string,
    ): Promise<LoopPauseResumeResult>;
    fireLoopNow(loopId: string, sessionId: string): Promise<LoopFireNowResult>;
  };
  monitor: {
    createMonitor(params: MonitorCreateParams): Promise<MonitorCreateResult>;
    listMonitors(sessionId: string | null): Promise<MonitorListResult>;
    pauseMonitor(
      monitorId: string,
      sessionId: string,
    ): Promise<MonitorControlResult>;
    resumeMonitor(
      monitorId: string,
      sessionId: string,
    ): Promise<MonitorControlResult>;
    deleteMonitor(
      monitorId: string,
      sessionId: string,
    ): Promise<MonitorControlResult>;
  };
  agent: {
    listAgents(sessionId: string | null): Promise<AgentListResult>;
    readAgentStatus(
      agentId: string,
      sessionId: string,
    ): Promise<AgentStatusReadResult>;
    readAgentOutput(
      agentId: string,
      sessionId: string,
      cursor?: AgentOutputCursor,
    ): Promise<AgentOutputReadResult>;
    listAgentArtifacts(
      agentId: string,
      sessionId: string,
    ): Promise<AgentArtifactListResult>;
    readAgentArtifact(
      agentId: string,
      sessionId: string,
      selector: AgentArtifactSelector,
    ): Promise<AgentArtifactReadResult>;
    interruptAgent(
      agentId: string,
      sessionId: string,
    ): Promise<AgentControlResult>;
    closeAgent(agentId: string, sessionId: string): Promise<AgentControlResult>;
  };
}

/** Session-bound, capability-gated commands (host `contextCommands` shape). */
export interface SessionAutonomyCommands {
  /** Owning session for ownership validation of results/notifications. */
  readonly sessionId: string;
  capabilities: AutonomyCapabilities;
  goal: {
    read(): Promise<SessionGoalGetResult>;
    set(objective: string, tokenBudget?: number): Promise<SessionGoalSetResult>;
    clear(): Promise<SessionGoalClearResult>;
    /** Caller first reads a fresh goal and fences authority before this write. */
    transition(
      objective: string,
      status: GoalTransitionStatus,
    ): Promise<SessionGoalSetResult>;
  };
  loop: {
    create(
      params: Omit<LoopCreateParams, "session_id">,
    ): Promise<LoopCreateResult>;
    list(): Promise<LoopListResult>;
    pause(loopId: string): Promise<LoopPauseResumeResult>;
    resume(loopId: string): Promise<LoopPauseResumeResult>;
    delete(loopId: string): Promise<LoopDeleteResult>;
    fireNow(loopId: string): Promise<LoopFireNowResult>;
  };
  monitor: {
    create(
      params: Omit<MonitorCreateParams, "session_id">,
    ): Promise<MonitorCreateResult>;
    list(): Promise<MonitorListResult>;
    pause(monitorId: string): Promise<MonitorControlResult>;
    resume(monitorId: string): Promise<MonitorControlResult>;
    delete(monitorId: string): Promise<MonitorControlResult>;
  };
  agent: {
    list(): Promise<AgentListResult>;
    readStatus(agentId: string): Promise<AgentStatusReadResult>;
    readOutput(
      agentId: string,
      cursor?: AgentOutputCursor,
    ): Promise<AgentOutputReadResult>;
    listArtifacts(agentId: string): Promise<AgentArtifactListResult>;
    readArtifact(
      agentId: string,
      selector: AgentArtifactSelector,
    ): Promise<AgentArtifactReadResult>;
    interrupt(agentId: string): Promise<AgentControlResult>;
    close(agentId: string): Promise<AgentControlResult>;
  };
}

export function createAutonomyCommands(rpc: AutonomyRpc): AutonomyCommands {
  const request = validatedRequest;
  const writeGoal = async (
    sessionId: string,
    objective: string,
    status: GoalTransitionStatus,
    tokenBudget?: number,
  ): Promise<SessionGoalSetResult> => {
    const params = buildSessionGoalSetParams({
      session_id: sessionId,
      objective,
      status,
      transition_actor: "user",
      ...(tokenBudget === undefined ? {} : { token_budget: tokenBudget }),
    });
    if (!params)
      throw new AutonomyProtocolError(
        CORE_UI_METHODS.SESSION_GOAL_SET,
        "invalid goal set params",
      );
    const result = await request(
      rpc,
      CORE_UI_METHODS.SESSION_GOAL_SET,
      params,
      parseSessionGoalSetResult,
    );
    requireSessionMatch(
      CORE_UI_METHODS.SESSION_GOAL_SET,
      sessionId,
      result.session_id,
    );
    return result;
  };
  const agentRequest = async <
    T extends { session_id: string; agent_id: string },
  >(
    method: string,
    agentId: string,
    sessionId: string,
    parse: (value: unknown) => T | null,
    extra: Record<string, unknown> = {},
  ): Promise<T> => {
    if (!isNonEmptyString(agentId) || !isNonEmptyString(sessionId)) {
      throw new AutonomyProtocolError(method, "invalid agent request params");
    }
    const result = await request(
      rpc,
      method,
      { ...extra, agent_id: agentId, session_id: sessionId },
      parse,
    );
    requireResourceScope(
      method,
      sessionId,
      result.session_id,
      "agent",
      agentId,
      result.agent_id,
    );
    return result;
  };
  const agentControl = async (
    agentId: string,
    sessionId: string,
    status: "interrupted" | "closed",
  ) => {
    const method =
      status === "interrupted"
        ? CORE_UI_METHODS.AGENT_INTERRUPT
        : CORE_UI_METHODS.AGENT_CLOSE;
    const result = await agentRequest(
      method,
      agentId,
      sessionId,
      parseAgentControlResult,
    );
    if (result.status !== status)
      throw new AutonomyProtocolError(
        method,
        "agent control returned a different transition",
      );
    return result;
  };
  const loopControl = async <
    T extends {
      session_id: string;
      loop_id: string;
      loop: { session_id: string; loop_id: string };
    },
  >(
    method: string,
    loopId: string,
    sessionId: string,
    parse: (value: unknown) => T | null,
  ): Promise<T> => {
    const params = buildLoopControlParams({
      loop_id: loopId,
      session_id: sessionId,
    });
    if (!params) {
      throw new AutonomyProtocolError(method, "invalid loop control params");
    }
    const result = await request(rpc, method, params, parse);
    requireResourceScope(
      method,
      sessionId,
      result.session_id,
      "loop",
      loopId,
      result.loop_id,
    );
    requireNestedRecordAgreement(
      method,
      "loop",
      result.session_id,
      result.loop_id,
      result.loop.session_id,
      result.loop.loop_id,
    );
    return result;
  };
  const monitorControl = async (
    method: string,
    monitorId: string,
    sessionId: string,
  ): Promise<MonitorControlResult> => {
    const params = buildMonitorControlParams({
      monitor_id: monitorId,
      session_id: sessionId,
    });
    if (!params) {
      throw new AutonomyProtocolError(method, "invalid monitor control params");
    }
    const result = await request(
      rpc,
      method,
      params,
      parseMonitorControlResult,
    );
    requireResourceScope(
      method,
      sessionId,
      result.session_id,
      "monitor",
      monitorId,
      result.monitor_id,
    );
    requireNestedRecordAgreement(
      method,
      "monitor",
      result.session_id,
      result.monitor_id,
      result.monitor.session_id,
      result.monitor.monitor_id,
    );
    return result;
  };
  return {
    capabilitiesFrom: (caps) => parseAutonomyCapabilities(caps),
    goal: {
      async readGoal(sessionId) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.SESSION_GOAL_GET,
          { session_id: sessionId },
          parseSessionGoalGetResult,
        );
        requireSessionMatch(
          CORE_UI_METHODS.SESSION_GOAL_GET,
          sessionId,
          result.session_id,
        );
        return result;
      },
      async setGoal(sessionId, objective, tokenBudget) {
        return writeGoal(sessionId, objective, "active", tokenBudget);
      },
      async transitionGoal(sessionId, objective, status) {
        if (
          status !== "active" &&
          status !== "paused" &&
          status !== "complete"
        ) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.SESSION_GOAL_SET,
            "invalid goal transition",
          );
        }
        return writeGoal(sessionId, objective, status);
      },
      async clearGoal(sessionId) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.SESSION_GOAL_CLEAR,
          { session_id: sessionId },
          parseSessionGoalClearResult,
        );
        requireSessionMatch(
          CORE_UI_METHODS.SESSION_GOAL_CLEAR,
          sessionId,
          result.session_id,
        );
        return result;
      },
    },
    loop: {
      async createLoop(params) {
        const built = buildLoopCreateParams(params);
        if (!built) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.LOOP_CREATE,
            "invalid loop create params",
          );
        }
        const result = await request(
          rpc,
          CORE_UI_METHODS.LOOP_CREATE,
          built,
          parseLoopCreateResult,
        );
        requireSessionMatch(
          CORE_UI_METHODS.LOOP_CREATE,
          params.session_id,
          result.session_id,
        );
        return result;
      },
      async listLoops(sessionId) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.LOOP_LIST,
          sessionId === null ? {} : { session_id: sessionId },
          parseLoopListResult,
        );
        if (sessionId !== null) {
          requireListEnvelope(
            CORE_UI_METHODS.LOOP_LIST,
            result.session_id,
            sessionId,
          );
        }
        return filterLoopListScope(result, sessionId);
      },
      deleteLoop: (loopId, sessionId) =>
        loopControl(
          CORE_UI_METHODS.LOOP_DELETE,
          loopId,
          sessionId,
          parseLoopDeleteResult,
        ),
      pauseLoop: (loopId, sessionId) =>
        loopControl(
          CORE_UI_METHODS.LOOP_PAUSE,
          loopId,
          sessionId,
          parseLoopPauseResumeResult,
        ),
      resumeLoop: (loopId, sessionId) =>
        loopControl(
          CORE_UI_METHODS.LOOP_RESUME,
          loopId,
          sessionId,
          parseLoopPauseResumeResult,
        ),
      fireLoopNow: (loopId, sessionId) =>
        loopControl(
          CORE_UI_METHODS.LOOP_FIRE_NOW,
          loopId,
          sessionId,
          parseLoopFireNowResult,
        ),
    },
    monitor: {
      async createMonitor(params) {
        const built = buildMonitorCreateParams(params);
        if (!built) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.MONITOR_CREATE,
            "invalid monitor create params",
          );
        }
        const result = await request(
          rpc,
          CORE_UI_METHODS.MONITOR_CREATE,
          built,
          parseMonitorCreateResult,
        );
        requireSessionMatch(
          CORE_UI_METHODS.MONITOR_CREATE,
          params.session_id,
          result.session_id,
        );
        return result;
      },
      async listMonitors(sessionId) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.MONITOR_LIST,
          sessionId === null ? {} : { session_id: sessionId },
          parseMonitorListResult,
        );
        if (sessionId !== null) {
          requireListEnvelope(
            CORE_UI_METHODS.MONITOR_LIST,
            result.session_id,
            sessionId,
          );
        }
        return filterMonitorListScope(result, sessionId);
      },
      pauseMonitor: (monitorId, sessionId) =>
        monitorControl(CORE_UI_METHODS.MONITOR_PAUSE, monitorId, sessionId),
      resumeMonitor: (monitorId, sessionId) =>
        monitorControl(CORE_UI_METHODS.MONITOR_RESUME, monitorId, sessionId),
      deleteMonitor: (monitorId, sessionId) =>
        monitorControl(CORE_UI_METHODS.MONITOR_DELETE, monitorId, sessionId),
    },
    agent: {
      async listAgents(sessionId) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.AGENT_LIST,
          sessionId === null ? {} : { session_id: sessionId },
          parseAgentListResult,
        );
        if (sessionId !== null) {
          requireListEnvelope(
            CORE_UI_METHODS.AGENT_LIST,
            result.session_id,
            sessionId,
          );
        }
        return filterAgentListScope(result, sessionId);
      },
      async readAgentStatus(agentId, sessionId) {
        if (!isNonEmptyString(agentId) || !isNonEmptyString(sessionId)) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.AGENT_STATUS_READ,
            "invalid agent request params",
          );
        }
        const result = await request(
          rpc,
          CORE_UI_METHODS.AGENT_STATUS_READ,
          { agent_id: agentId, session_id: sessionId },
          parseAgentStatusReadResult,
        );
        requireResourceScope(
          CORE_UI_METHODS.AGENT_STATUS_READ,
          sessionId,
          result.session_id,
          "agent",
          agentId,
          result.agent.agent_id,
        );
        requireNestedRecordAgreement(
          CORE_UI_METHODS.AGENT_STATUS_READ,
          "agent",
          result.session_id,
          agentId,
          result.agent.session_id,
          result.agent.agent_id,
        );
        return result;
      },
      async readAgentOutput(agentId, sessionId, cursor) {
        const result = await request(
          rpc,
          CORE_UI_METHODS.AGENT_OUTPUT_READ,
          {
            agent_id: agentId,
            session_id: sessionId,
            ...(cursor === undefined ? {} : { cursor }),
          },
          parseAgentOutputReadResult,
        );
        requireResourceScope(
          CORE_UI_METHODS.AGENT_OUTPUT_READ,
          sessionId,
          result.session_id,
          "agent",
          agentId,
          result.agent_id,
        );
        return result;
      },
      async listAgentArtifacts(agentId, sessionId) {
        return agentRequest(
          CORE_UI_METHODS.AGENT_ARTIFACT_LIST,
          agentId,
          sessionId,
          parseAgentArtifactListResult,
        );
      },
      async readAgentArtifact(agentId, sessionId, selector) {
        const byId =
          isNonEmptyString(selector.artifactId) && selector.path === undefined;
        const byPath =
          isNonEmptyString(selector.path) && selector.artifactId === undefined;
        if (!byId && !byPath)
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.AGENT_ARTIFACT_READ,
            "exactly one artifact selector is required",
          );
        const result = await agentRequest(
          CORE_UI_METHODS.AGENT_ARTIFACT_READ,
          agentId,
          sessionId,
          parseAgentArtifactReadResult,
          byId ? { artifact_id: selector.artifactId } : { path: selector.path },
        );
        if (byId && result.artifact.id !== selector.artifactId) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.AGENT_ARTIFACT_READ,
            "artifact id does not match the request",
          );
        }
        if (
          byPath &&
          result.artifact.path !== undefined &&
          result.artifact.path !== selector.path
        ) {
          throw new AutonomyProtocolError(
            CORE_UI_METHODS.AGENT_ARTIFACT_READ,
            "artifact path does not match the request",
          );
        }
        return result;
      },
      async interruptAgent(agentId, sessionId) {
        return agentControl(agentId, sessionId, "interrupted");
      },
      async closeAgent(agentId, sessionId) {
        return agentControl(agentId, sessionId, "closed");
      },
    },
  };
}

/**
 * Session-bound, capability-gated facade matching the host client's planned
 * `contextCommands(sessionId, capabilities)` factory. Every command checks
 * its advertised method+feature gate BEFORE the wire (fail closed) and then
 * reuses the raw commands, which enforce owning-session result matching.
 */
export function createSessionAutonomyCommands(
  rpc: AutonomyRpc,
  sessionId: string,
  capabilities: UiProtocolCapabilities | undefined,
): SessionAutonomyCommands {
  const commands = createAutonomyCommands(rpc);
  const gates = parseAutonomyCapabilities(capabilities);
  const requireGate = (advertised: boolean, method: string): void => {
    if (!advertised) {
      throw new AutonomyProtocolError(
        method,
        "method is not advertised by the server",
      );
    }
  };
  return {
    sessionId,
    capabilities: gates,
    goal: {
      async read() {
        requireGate(gates.goalGet, CORE_UI_METHODS.SESSION_GOAL_GET);
        return commands.goal.readGoal(sessionId);
      },
      async set(objective, tokenBudget) {
        requireGate(gates.goalSet, CORE_UI_METHODS.SESSION_GOAL_SET);
        return commands.goal.setGoal(sessionId, objective, tokenBudget);
      },
      async clear() {
        requireGate(gates.goalClear, CORE_UI_METHODS.SESSION_GOAL_CLEAR);
        return commands.goal.clearGoal(sessionId);
      },
      async transition(objective, status) {
        requireGate(gates.goalGet, CORE_UI_METHODS.SESSION_GOAL_GET);
        requireGate(gates.goalSet, CORE_UI_METHODS.SESSION_GOAL_SET);
        return commands.goal.transitionGoal(sessionId, objective, status);
      },
    },
    loop: {
      async create(params) {
        requireGate(gates.loopCreate, CORE_UI_METHODS.LOOP_CREATE);
        return commands.loop.createLoop({ ...params, session_id: sessionId });
      },
      async list() {
        requireGate(gates.loopList, CORE_UI_METHODS.LOOP_LIST);
        return commands.loop.listLoops(sessionId);
      },
      async pause(loopId) {
        requireGate(gates.loopPause, CORE_UI_METHODS.LOOP_PAUSE);
        return commands.loop.pauseLoop(loopId, sessionId);
      },
      async resume(loopId) {
        requireGate(gates.loopResume, CORE_UI_METHODS.LOOP_RESUME);
        return commands.loop.resumeLoop(loopId, sessionId);
      },
      async delete(loopId) {
        requireGate(gates.loopDelete, CORE_UI_METHODS.LOOP_DELETE);
        return commands.loop.deleteLoop(loopId, sessionId);
      },
      async fireNow(loopId) {
        requireGate(gates.loopFireNow, CORE_UI_METHODS.LOOP_FIRE_NOW);
        return commands.loop.fireLoopNow(loopId, sessionId);
      },
    },
    monitor: {
      async create(params) {
        requireGate(gates.monitorCreate, CORE_UI_METHODS.MONITOR_CREATE);
        return commands.monitor.createMonitor({
          ...params,
          session_id: sessionId,
        });
      },
      async list() {
        requireGate(gates.monitorList, CORE_UI_METHODS.MONITOR_LIST);
        return commands.monitor.listMonitors(sessionId);
      },
      async pause(monitorId) {
        requireGate(gates.monitorPause, CORE_UI_METHODS.MONITOR_PAUSE);
        return commands.monitor.pauseMonitor(monitorId, sessionId);
      },
      async resume(monitorId) {
        requireGate(gates.monitorResume, CORE_UI_METHODS.MONITOR_RESUME);
        return commands.monitor.resumeMonitor(monitorId, sessionId);
      },
      async delete(monitorId) {
        requireGate(gates.monitorDelete, CORE_UI_METHODS.MONITOR_DELETE);
        return commands.monitor.deleteMonitor(monitorId, sessionId);
      },
    },
    agent: {
      async list() {
        requireGate(gates.agentList, CORE_UI_METHODS.AGENT_LIST);
        return commands.agent.listAgents(sessionId);
      },
      async readStatus(agentId) {
        requireGate(gates.agentStatusRead, CORE_UI_METHODS.AGENT_STATUS_READ);
        return commands.agent.readAgentStatus(agentId, sessionId);
      },
      async readOutput(agentId, cursor) {
        requireGate(gates.agentOutputRead, CORE_UI_METHODS.AGENT_OUTPUT_READ);
        return commands.agent.readAgentOutput(agentId, sessionId, cursor);
      },
      async listArtifacts(agentId) {
        requireGate(
          gates.agentArtifactList,
          CORE_UI_METHODS.AGENT_ARTIFACT_LIST,
        );
        return commands.agent.listAgentArtifacts(agentId, sessionId);
      },
      async readArtifact(agentId, selector) {
        requireGate(
          gates.agentArtifactRead,
          CORE_UI_METHODS.AGENT_ARTIFACT_READ,
        );
        return commands.agent.readAgentArtifact(agentId, sessionId, selector);
      },
      async interrupt(agentId) {
        requireGate(gates.agentInterrupt, CORE_UI_METHODS.AGENT_INTERRUPT);
        return commands.agent.interruptAgent(agentId, sessionId);
      },
      async close(agentId) {
        requireGate(gates.agentClose, CORE_UI_METHODS.AGENT_CLOSE);
        return commands.agent.closeAgent(agentId, sessionId);
      },
    },
  };
}
