import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { APPUI_RESEARCH_METHODS } from "./research-methods.ts";

/** Public lane configuration only; credentials are never part of this state. */
export interface ResearchLane {
  key: string;
  provider: string;
  model: string | null;
  apiKeyEnv: string | null;
  baseUrl: string | null;
  description: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  apiType: string | null;
}
export interface ResearchLanes {
  profileId: string;
  lanes: ResearchLane[];
}
export interface ResearchLaneMutation extends ResearchLanes {
  applied: boolean;
  restartRequired: boolean;
}
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 8192;
const name = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const nullableU32 = (v: unknown): v is number | null =>
  v === null ||
  (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff);

export function parseResearchLanes(
  value: unknown,
  profileId: string,
): ResearchLanes | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    !Array.isArray(value.sub_providers) ||
    value.sub_providers.length > 10000
  )
    return null;
  const lanes: ResearchLane[] = [];
  const keys = new Set<string>();
  for (const row of value.sub_providers) {
    if (
      !isRecord(row) ||
      !name(row.key) ||
      keys.has(row.key) ||
      !name(row.provider) ||
      !nullableText(row.model) ||
      !nullableText(row.api_key_env) ||
      !nullableText(row.base_url) ||
      !nullableText(row.description) ||
      !nullableText(row.api_type) ||
      !nullableU32(row.default_context_window) ||
      !nullableU32(row.max_output_tokens)
    )
      return null;
    keys.add(row.key);
    lanes.push({
      key: row.key,
      provider: row.provider,
      model: row.model,
      apiKeyEnv: row.api_key_env,
      baseUrl: row.base_url,
      description: row.description,
      contextWindow: row.default_context_window,
      maxOutputTokens: row.max_output_tokens,
      apiType: row.api_type,
    });
  }
  return { profileId, lanes };
}

export function parseResearchLaneMutation(
  value: unknown,
  profileId: string,
): ResearchLaneMutation | null {
  const parsed = parseResearchLanes(value, profileId);
  if (
    !parsed ||
    !isRecord(value) ||
    typeof value.applied !== "boolean" ||
    typeof value.restart_required !== "boolean"
  )
    return null;
  return {
    ...parsed,
    applied: value.applied,
    restartRequired: value.restart_required,
  };
}

/** Explicit whitelist: spreading a draft must not copy arbitrary fields/secrets to the wire. */
export function researchLaneParams(lane: ResearchLane) {
  if (
    !name(lane.key) ||
    !name(lane.provider) ||
    !nullableText(lane.model) ||
    !nullableText(lane.apiKeyEnv) ||
    !nullableText(lane.baseUrl) ||
    !nullableText(lane.description) ||
    !nullableText(lane.apiType) ||
    !nullableU32(lane.contextWindow) ||
    !nullableU32(lane.maxOutputTokens)
  )
    throw new Error("Invalid research lane");
  return {
    key: lane.key.trim(),
    provider: lane.provider.trim(),
    model: lane.model,
    api_key_env: lane.apiKeyEnv,
    base_url: lane.baseUrl,
    description: lane.description,
    default_context_window: lane.contextWindow,
    max_output_tokens: lane.maxOutputTokens,
    api_type: lane.apiType,
  };
}

export function createResearchCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  profileId: string,
  capabilities: UiProtocolCapabilities,
) {
  function available(method: string) {
    if (!name(profileId)) throw new Error("A confirmed Profile is required");
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
  }
  function mutation(value: unknown): ResearchLaneMutation {
    const parsed = parseResearchLaneMutation(value, profileId);
    if (!parsed)
      throw new Error(
        "Invalid or wrong-profile research mutation receipt; refresh before retrying",
      );
    return parsed;
  }
  return {
    async list(): Promise<ResearchLanes> {
      available(APPUI_RESEARCH_METHODS.LIST);
      const value = await client.request(APPUI_RESEARCH_METHODS.LIST, {
        profile_id: profileId,
      });
      const parsed = parseResearchLanes(value, profileId);
      if (!parsed) throw new Error("Invalid or wrong-profile research lanes");
      return parsed;
    },
    async upsert(
      lane: ResearchLane,
      apiKey?: string,
    ): Promise<ResearchLaneMutation> {
      available(APPUI_RESEARCH_METHODS.UPSERT);
      const subProvider = researchLaneParams(lane);
      if (apiKey && !lane.apiKeyEnv?.trim())
        throw new Error(
          "An API key environment name is required for a new credential",
        );
      try {
        const result = mutation(
          await client.request(APPUI_RESEARCH_METHODS.UPSERT, {
            profile_id: profileId,
            sub_provider: subProvider,
            ...(apiKey ? { api_key: apiKey } : {}),
          }),
        );
        if (
          result.applied &&
          !result.lanes.some((candidate) => candidate.key === subProvider.key)
        )
          throw new Error(
            "Research save receipt omitted the requested lane; refresh before retrying",
          );
        return result;
      } catch (cause) {
        // Providers/transports can echo input in errors. Never retain the submitted credential.
        if (apiKey)
          throw new Error(
            "Could not confirm the credential-bearing lane save. Refresh before retrying; the server may have applied it.",
          );
        throw new Error(
          cause instanceof Error ? cause.message : "Research save failed",
        );
      }
    },
    async remove(key: string): Promise<ResearchLaneMutation> {
      available(APPUI_RESEARCH_METHODS.REMOVE);
      if (!name(key)) throw new Error("A lane key is required");
      const result = mutation(
        await client.request(APPUI_RESEARCH_METHODS.REMOVE, {
          profile_id: profileId,
          key,
        }),
      );
      if (result.applied && result.lanes.some((lane) => lane.key === key))
        throw new Error(
          "Research removal receipt still contains the requested lane; refresh before retrying",
        );
      return result;
    },
  };
}
