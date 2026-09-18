import { isRecord } from "./rpc.ts";

export interface LocalProfileCreateParams {
  requested_id?: string;
  name: string;
  username?: string;
  email?: string;
  make_default?: boolean;
}

export interface LocalProfileCreateResult {
  profile_id: string;
  user_id: string;
  name: string;
  created: boolean;
  runtime_mode: string;
}

export interface LlmCatalogEndpoint {
  id: string;
  label?: string;
  base_url?: string;
  api_key_env?: string;
  api_type?: string;
}

export interface LlmCatalogModel {
  id: string;
  endpoints: LlmCatalogEndpoint[];
}

export interface LlmCatalogFamily {
  id: string;
  env: string;
  models: LlmCatalogModel[];
}

export interface LlmCatalogResult {
  families: LlmCatalogFamily[];
}

export interface LlmRouteSelection {
  route_id: string;
  label?: string;
  base_url?: string;
  api_key_env: string;
  api_type: string;
}

/** rc11's closed, per-model configuration schema; null and omission inherit. */
export interface LlmInferenceOverrides {
  temperature?: number | null;
  top_p?: number | null;
  context_window?: number | null;
  reasoning_effort?: "none" | "low" | "medium" | "high" | "max" | null;
  model_hints?: {
    uses_completion_tokens?: boolean;
    fixed_temperature?: boolean;
    lacks_vision?: boolean;
    merge_system_messages?: boolean;
    reasoning_style?:
      | "none"
      | "effort"
      | "effort_and_thinking_toggle"
      | "effort_max_only"
      | "effort_low_high_max"
      | "thinking_toggle";
  } | null;
}

export interface LlmSelection extends LlmInferenceOverrides {
  family_id: string;
  model_id: string;
  route: LlmRouteSelection;
}

export interface LlmProvisionParams {
  profile_id?: string;
  selection: LlmSelection;
  /** Omit to reuse the secret already saved for selection.route.api_key_env. */
  api_key?: string;
  set_primary?: boolean;
}

export interface LlmTestResult {
  profile_id: string;
  applied: boolean;
  message: string;
  error?: string;
}

export interface LlmUpsertResult {
  profile_id: string;
  applied: boolean;
}

/** Reads profile configuration, rather than the session-scoped model picker. */
export interface ProfileLlmConfigReadParams {
  profile_id?: string;
}

export interface ProfileLlmConfiguredRoute {
  route_id?: string;
  label?: string;
  base_url?: string;
  api_key_env?: string;
  api_type?: string;
}

/** A secret-free projection of one configured primary or fallback model. */
export interface ProfileLlmConfiguredModel extends LlmInferenceOverrides {
  family_id: string;
  model_id: string;
  route: ProfileLlmConfiguredRoute;
  has_api_key: boolean;
  selected: boolean;
  available: boolean;
  /** The read contains configuration this client's closed write schema cannot preserve. */
  edit_blocked?: true;
}

export interface ProfileLlmConfigResult {
  profile_id: string;
  primary: ProfileLlmConfiguredModel | null;
  fallbacks: ProfileLlmConfiguredModel[];
}

export interface LlmModelFetchSelection {
  family_id: string;
  route: LlmRouteSelection;
}

export interface LlmFetchModelsParams {
  profile_id?: string;
  selection: LlmModelFetchSelection;
  /** Omit to reuse the secret already saved for selection.route.api_key_env. */
  api_key?: string;
}

export interface LlmFetchModelsResult {
  profile_id: string;
  family_id: string;
  models: string[];
  reason?: string;
}

export interface ProfileLlmDeleteParams {
  profile_id?: string;
  family_id: string;
  model_id: string;
  route_id: string;
}

export interface ProfileLlmDeleteResult extends ProfileLlmConfigResult {
  applied: boolean;
}

export interface ProfileLlmListParams {
  session_id: string;
  profile_id?: string;
}

export interface ProfileLlmModel {
  model: string;
  provider: string;
  title: string;
  family?: string;
  route?: string;
  selected: boolean;
  available: boolean;
}

export interface ProfileLlmListResult {
  session_id: string;
  models: ProfileLlmModel[];
}

export interface ProfileLlmSelectParams extends ProfileLlmListParams {
  family_id: string;
  model_id: string;
  route_id?: string;
}

export interface ProfileLlmSelectResult {
  session_id: string;
  selected: ProfileLlmModel;
  applied: boolean;
  restart_required?: boolean;
  runtime_policy_stamp?: unknown;
}

const MAX_FAMILIES = 100;
const MAX_MODELS = 500;
const MAX_ENDPOINTS = 50;
const MAX_TEXT = 4_096;

export function parseLocalProfileCreateResult(
  value: unknown,
): LocalProfileCreateResult | null {
  if (!isRecord(value)) return null;
  const profileId = text(value.profile_id);
  const userId = text(value.user_id);
  const name = text(value.name);
  const runtimeMode = text(value.runtime_mode);
  if (
    !profileId ||
    !userId ||
    !name ||
    !runtimeMode ||
    typeof value.created !== "boolean"
  ) {
    return null;
  }
  return {
    profile_id: profileId,
    user_id: userId,
    name,
    created: value.created,
    runtime_mode: runtimeMode,
  };
}

export function parseLlmCatalogResult(value: unknown): LlmCatalogResult | null {
  if (!isRecord(value) || !isRecord(value.families)) return null;
  const familyEntries = Object.entries(value.families);
  if (familyEntries.length === 0 || familyEntries.length > MAX_FAMILIES) {
    return null;
  }
  let modelCount = 0;
  const families: LlmCatalogFamily[] = [];
  for (const [familyId, source] of familyEntries) {
    if (!text(familyId) || !isRecord(source) || !Array.isArray(source.models)) {
      return null;
    }
    modelCount += source.models.length;
    if (modelCount > MAX_MODELS) return null;
    const env = boundedString(source.env);
    if (env === null) return null;
    const models: LlmCatalogModel[] = [];
    for (const modelSource of source.models) {
      if (!isRecord(modelSource)) return null;
      const id = text(modelSource.id);
      if (!id) return null;
      const endpointSources = modelSource.endpoints ?? [];
      if (
        !Array.isArray(endpointSources) ||
        endpointSources.length > MAX_ENDPOINTS
      ) {
        return null;
      }
      const endpoints: LlmCatalogEndpoint[] = [];
      for (const endpointSource of endpointSources) {
        if (!isRecord(endpointSource)) return null;
        const endpointId = text(endpointSource.id);
        if (!endpointId) return null;
        const label = optionalText(endpointSource.label);
        const baseUrl = optionalText(endpointSource.base_url);
        const apiKeyEnv = optionalText(endpointSource.api_key_env);
        const apiType = optionalText(endpointSource.api_type);
        if ([label, baseUrl, apiKeyEnv, apiType].includes(null)) return null;
        endpoints.push({
          id: endpointId,
          ...(label ? { label } : {}),
          ...(baseUrl ? { base_url: baseUrl } : {}),
          ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {}),
          ...(apiType ? { api_type: apiType } : {}),
        });
      }
      models.push({ id, endpoints });
    }
    if (models.length) families.push({ id: familyId, env, models });
  }
  return families.length ? { families } : null;
}

export function parseLlmTestResult(value: unknown): LlmTestResult | null {
  if (!isRecord(value)) return null;
  const profileId = text(value.profile_id);
  const message = text(value.message);
  if (!profileId || !message || typeof value.applied !== "boolean") return null;
  const error = value.error === undefined ? undefined : text(value.error);
  if (value.error !== undefined && error === null) return null;
  return {
    profile_id: profileId,
    applied: value.applied,
    message,
    ...(error ? { error } : {}),
  };
}

export function parseLlmUpsertResult(value: unknown): LlmUpsertResult | null {
  if (!isRecord(value)) return null;
  const profileId = text(value.profile_id);
  if (!profileId || typeof value.applied !== "boolean") return null;
  return { profile_id: profileId, applied: value.applied };
}

export function parseProfileLlmConfigResult(
  value: unknown,
): ProfileLlmConfigResult | null {
  const parsed = parseProfileLlmConfig(value);
  if (!parsed) return null;
  return parsed;
}

export function parseLlmFetchModelsResult(
  value: unknown,
): LlmFetchModelsResult | null {
  if (!isRecord(value) || !Array.isArray(value.models)) return null;
  const profileId = text(value.profile_id);
  const familyId = text(value.family_id);
  const reason = optionalText(value.reason);
  if (
    !profileId ||
    !familyId ||
    reason === null ||
    value.models.length > MAX_MODELS
  ) {
    return null;
  }
  const models: string[] = [];
  for (const source of value.models) {
    const model = text(source);
    if (!model) return null;
    models.push(model);
  }
  return {
    profile_id: profileId,
    family_id: familyId,
    models,
    ...(reason ? { reason } : {}),
  };
}

export function parseProfileLlmDeleteResult(
  value: unknown,
): ProfileLlmDeleteResult | null {
  if (!isRecord(value) || typeof value.applied !== "boolean") return null;
  const config = parseProfileLlmConfig(value);
  if (!config) return null;
  return { ...config, applied: value.applied };
}

export function parseProfileLlmListResult(
  value: unknown,
): ProfileLlmListResult | null {
  if (!isRecord(value) || !Array.isArray(value.models)) return null;
  const sessionId = text(value.session_id);
  if (!sessionId || value.models.length > MAX_MODELS) return null;
  const models: ProfileLlmModel[] = [];
  for (const source of value.models) {
    const model = parseProfileLlmModel(source);
    if (!model) return null;
    models.push(model);
  }
  return { session_id: sessionId, models };
}

export function parseProfileLlmSelectResult(
  value: unknown,
): ProfileLlmSelectResult | null {
  if (!isRecord(value) || typeof value.applied !== "boolean") return null;
  const sessionId = text(value.session_id);
  const selected = parseProfileLlmModel(value.selected);
  const restartRequired = value.restart_required;
  if (
    !sessionId ||
    !selected ||
    (restartRequired !== undefined && typeof restartRequired !== "boolean")
  ) {
    return null;
  }
  return {
    session_id: sessionId,
    selected,
    applied: value.applied,
    ...(restartRequired === undefined
      ? {}
      : { restart_required: restartRequired }),
    ...(value.runtime_policy_stamp === undefined
      ? {}
      : { runtime_policy_stamp: value.runtime_policy_stamp }),
  };
}

function parseProfileLlmModel(value: unknown): ProfileLlmModel | null {
  if (!isRecord(value)) return null;
  const model = text(value.model);
  const provider = text(value.provider);
  const title = text(value.title);
  const family = optionalText(value.family);
  const route = optionalText(value.route);
  if (
    !model ||
    !provider ||
    !title ||
    family === null ||
    route === null ||
    typeof value.selected !== "boolean" ||
    typeof value.available !== "boolean"
  ) {
    return null;
  }
  return {
    model,
    provider,
    title,
    ...(family ? { family } : {}),
    ...(route ? { route } : {}),
    selected: value.selected,
    available: value.available,
  };
}

function parseProfileLlmConfig(value: unknown): ProfileLlmConfigResult | null {
  if (!isRecord(value) || !Array.isArray(value.fallbacks)) return null;
  const profileId = text(value.profile_id);
  if (!profileId || value.fallbacks.length > MAX_MODELS) return null;

  let primary: ProfileLlmConfiguredModel | null = null;
  if (value.primary !== null) {
    primary = parseProfileLlmConfiguredModel(value.primary);
    if (!primary || !primary.selected) return null;
  }

  const fallbacks: ProfileLlmConfiguredModel[] = [];
  for (const source of value.fallbacks) {
    const fallback = parseProfileLlmConfiguredModel(source);
    if (!fallback || fallback.selected) return null;
    fallbacks.push(fallback);
  }
  return { profile_id: profileId, primary, fallbacks };
}

function parseProfileLlmConfiguredModel(
  value: unknown,
): ProfileLlmConfiguredModel | null {
  if (!isRecord(value) || !isRecord(value.route)) return null;
  const familyId = text(value.family_id);
  const modelId = text(value.model_id);
  if (
    !familyId ||
    !modelId ||
    typeof value.has_api_key !== "boolean" ||
    typeof value.selected !== "boolean" ||
    typeof value.available !== "boolean"
  ) {
    return null;
  }
  const routeId = optionalText(value.route.route_id);
  const label = optionalText(value.route.label);
  const baseUrl = optionalText(value.route.base_url);
  const apiKeyEnv = optionalText(value.route.api_key_env);
  const apiType = optionalText(value.route.api_type);
  if ([routeId, label, baseUrl, apiKeyEnv, apiType].includes(null)) return null;

  const inference = parseLlmInferenceOverrides(
    Object.fromEntries(
      INFERENCE_KEYS.filter((key) => Object.hasOwn(value, key)).map((key) => [
        key,
        value[key],
      ]),
    ),
  );
  if (!inference) return null;
  const editBlocked =
    Object.keys(value).some(
      (key) =>
        !CONFIGURED_KEYS.includes(key) &&
        !((key === "cost_per_m" || key === "strong") && value[key] === null),
    ) || Object.keys(value.route).some((key) => !ROUTE_KEYS.includes(key));

  return {
    ...inference,
    family_id: familyId,
    model_id: modelId,
    route: {
      ...(routeId ? { route_id: routeId } : {}),
      ...(label ? { label } : {}),
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {}),
      ...(apiType ? { api_type: apiType } : {}),
    },
    has_api_key: value.has_api_key,
    selected: value.selected,
    available: value.available,
    ...(editBlocked ? { edit_blocked: true as const } : {}),
  };
}

const INFERENCE_KEYS = [
  "temperature",
  "top_p",
  "context_window",
  "reasoning_effort",
  "model_hints",
] as const;
const ROUTE_KEYS = ["route_id", "label", "base_url", "api_key_env", "api_type"];
// rc11 configured_provider_json includes redundant display/address fields.
// cost_per_m / strong are outside the accepted write schema. rc11 preserves
// existing same-address QoS, but the client cannot negotiate that guarantee;
// conservatively keep those configured entries edit-ineligible.
const CONFIGURED_KEYS: readonly string[] = [
  "provider",
  "model",
  "family_id",
  "model_id",
  "route",
  "route_id",
  "base_url",
  "api_key_env",
  "has_api_key",
  "selected",
  "available",
  "temperature",
  "top_p",
  "context_window",
  "reasoning_effort",
  "model_hints",
];
const HINT_BOOLEAN_KEYS = [
  "uses_completion_tokens",
  "fixed_temperature",
  "lacks_vision",
  "merge_system_messages",
] as const;
const REASONING_STYLES = [
  "none",
  "effort",
  "effort_and_thinking_toggle",
  "effort_max_only",
  "effort_low_high_max",
  "thinking_toggle",
];

/** Copies only Core-accepted fields; never a provider request-body passthrough. */
export function parseLlmInferenceOverrides(
  value: unknown,
): LlmInferenceOverrides | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !(INFERENCE_KEYS as readonly string[]).includes(key),
    )
  )
    return null;
  const result: LlmInferenceOverrides = {};
  for (const key of ["temperature", "top_p", "context_window"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (item === null) {
      result[key] = null;
      continue;
    }
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    if (
      key === "context_window"
        ? !Number.isInteger(item) || item < 1 || item > 0xffffffff
        : item < 0 || item > (key === "temperature" ? 2 : 1)
    )
      return null;
    result[key] = item;
  }
  if (Object.hasOwn(value, "reasoning_effort")) {
    const item = value.reasoning_effort;
    if (
      item !== null &&
      item !== "none" &&
      item !== "low" &&
      item !== "medium" &&
      item !== "high" &&
      item !== "max"
    )
      return null;
    result.reasoning_effort = item;
  }
  if (Object.hasOwn(value, "model_hints")) {
    const hints = value.model_hints;
    if (hints === null) result.model_hints = null;
    else {
      if (
        !isRecord(hints) ||
        Object.keys(hints).some(
          (key) =>
            key !== "reasoning_style" &&
            !(HINT_BOOLEAN_KEYS as readonly string[]).includes(key),
        )
      )
        return null;
      const parsed: NonNullable<LlmInferenceOverrides["model_hints"]> = {};
      for (const key of HINT_BOOLEAN_KEYS) {
        if (!Object.hasOwn(hints, key)) continue;
        const item = hints[key];
        if (typeof item !== "boolean") return null;
        parsed[key] = item;
      }
      if (Object.hasOwn(hints, "reasoning_style")) {
        const style = hints.reasoning_style;
        if (typeof style !== "string" || !REASONING_STYLES.includes(style))
          return null;
        parsed.reasoning_style = style as NonNullable<
          LlmInferenceOverrides["model_hints"]
        >["reasoning_style"] &
          string;
      }
      result.model_hints = parsed;
    }
  }
  return result;
}

function text(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TEXT
    ? value
    : null;
}

function boundedString(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value);
}
