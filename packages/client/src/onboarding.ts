import { isRecord } from "./rpc.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";

/** AppUI transport extensions owned by octos-cli until Core exports them. */
export const APPUI_ONBOARDING_METHODS = {
  PROFILE_LOCAL_CREATE: CORE_UI_METHODS.PROFILE_LOCAL_CREATE,
  PROFILE_LLM_CATALOG: "profile/llm/catalog",
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
  profile_id: string;
  selection: LlmSelection;
  api_key: string;
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
