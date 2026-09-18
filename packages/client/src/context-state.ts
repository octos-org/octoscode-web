import { isRecord } from "./rpc.ts";

// Narrow AppUI extensions, audited against Core d51601d:
// crates/octos-cli/src/api/ui_protocol_transport.rs, handle_session_compact*.
export const APPUI_CONTEXT_METHODS = {
  COMPACT: "session/compact",
  SET_MODE: "session/compact/mode/set",
} as const;

export interface ContextState {
  session_id: string;
  generation: number;
  token_estimate: number;
  item_count: number;
  recovery_state: string;
  cache_epoch_id?: string;
  last_cache_invalidation_reason?: string;
  semantic_head_id?: string;
  semantic_head_kind?: string;
}

export interface ContextCompaction {
  status: string;
  input_generation: number;
  output_generation?: number;
  token_estimate_before: number;
  token_estimate_after?: number;
  trigger?: string;
  error?: string;
}

export interface ContextNormalization {
  generation: number;
  model_capability_id: string;
  prompt_message_count: number;
  token_estimate: number;
  repaired_count: number;
  dropped_count: number;
  synthetic_count: number;
  truncated_count: number;
}

export interface ContextSnapshot {
  state: ContextState;
  lastCompaction?: ContextCompaction;
  lastNormalization?: ContextNormalization;
  compacting?: { generation: number; thresholdTokens: number; trigger: string };
}

export interface CompactResult {
  session_id: string;
  compacted: boolean;
  status: string;
  reason?: string;
  input_generation: number;
  output_generation?: number;
  token_estimate_before: number;
  token_estimate_after?: number;
}

const diagnosticKeys = [
  "cache_epoch_id",
  "last_cache_invalidation_reason",
  "semantic_head_id",
  "semantic_head_kind",
] as const;
export const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const label = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 512;

export function parseContextState(
  value: unknown,
  sessionId: string,
): ContextState | null {
  if (
    !isRecord(value) ||
    value.session_id !== sessionId ||
    !count(value.generation) ||
    !count(value.token_estimate) ||
    !count(value.item_count) ||
    !label(value.recovery_state)
  )
    return null;
  if (diagnosticKeys.some((key) => value[key] != null && !label(value[key])))
    return null;
  return {
    session_id: sessionId,
    generation: value.generation,
    token_estimate: value.token_estimate,
    item_count: value.item_count,
    recovery_state: value.recovery_state,
    ...Object.fromEntries(
      diagnosticKeys.flatMap((key) =>
        label(value[key]) ? [[key, value[key]]] : [],
      ),
    ),
  };
}

export function parseCompaction(value: unknown): ContextCompaction | null {
  if (
    !isRecord(value) ||
    !label(value.status) ||
    !count(value.input_generation) ||
    !count(value.token_estimate_before)
  )
    return null;
  const optionalCounts = ["output_generation", "token_estimate_after"] as const;
  const optionalLabels = ["trigger", "error"] as const;
  if (
    optionalCounts.some((key) => value[key] != null && !count(value[key])) ||
    optionalLabels.some(
      (key) => value[key] != null && typeof value[key] !== "string",
    )
  )
    return null;
  return {
    status: value.status,
    input_generation: value.input_generation,
    token_estimate_before: value.token_estimate_before,
    ...Object.fromEntries(
      optionalCounts.flatMap((key) =>
        count(value[key]) ? [[key, value[key]]] : [],
      ),
    ),
    ...Object.fromEntries(
      optionalLabels.flatMap((key) =>
        typeof value[key] === "string" ? [[key, value[key].slice(0, 512)]] : [],
      ),
    ),
  };
}

export function parseNormalization(
  value: unknown,
): ContextNormalization | null {
  const keys = [
    "generation",
    "prompt_message_count",
    "token_estimate",
    "repaired_count",
    "dropped_count",
    "synthetic_count",
    "truncated_count",
  ] as const;
  if (
    !isRecord(value) ||
    !label(value.model_capability_id) ||
    keys.some((key) => !count(value[key]))
  )
    return null;
  return {
    model_capability_id: value.model_capability_id,
    ...Object.fromEntries(keys.map((key) => [key, value[key]])),
  } as ContextNormalization;
}

/** Optional lifecycle fields are strictly scoped and contain counts/labels only. */
export function parseContextSnapshot(
  value: unknown,
  sessionId: string,
): ContextSnapshot | null {
  if (!isRecord(value)) return null;
  const lifecycle = isRecord(value.context) ? value.context : undefined;
  const state = parseContextState(
    value.context_state ?? lifecycle?.state,
    sessionId,
  );
  if (!state) return null;
  const compaction = isRecord(lifecycle?.compaction)
    ? lifecycle.compaction
    : undefined;
  const lastCompaction = parseCompaction(compaction?.last);
  const lastNormalization = parseNormalization(lifecycle?.normalization);
  return {
    state,
    ...(lastCompaction ? { lastCompaction } : {}),
    ...(lastNormalization ? { lastNormalization } : {}),
  };
}
