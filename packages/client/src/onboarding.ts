import { isRecord } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";

/** AppUI transport extensions owned by octos-cli until Core exports them. */
export const APPUI_ONBOARDING_METHODS = {
  PROFILE_LOCAL_CREATE: CORE_UI_METHODS.PROFILE_LOCAL_CREATE,
  PROFILE_LLM_CATALOG: "profile/llm/catalog",
  PROFILE_LLM_DELETE: "profile/llm/delete",
  PROFILE_LLM_FETCH_MODELS: "profile/llm/fetch_models",
  PROFILE_LLM_LIST: "profile/llm/list",
  PROFILE_LLM_SELECT: "profile/llm/select",
  PROFILE_LLM_TEST: "profile/llm/test",
  PROFILE_LLM_UPSERT: "profile/llm/upsert",
} as const;

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

export interface LlmSelection {
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
export interface ProfileLlmConfiguredModel {
  family_id: string;
  model_id: string;
  route: ProfileLlmConfiguredRoute;
  has_api_key: boolean;
  selected: boolean;
  available: boolean;
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

  return {
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
  };
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
