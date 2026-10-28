import { isRecord, type RpcNotification } from "./rpc.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import { CORE_UI_METHODS } from "./generated/core-contract.ts";
import {
  APPUI_SKILL_ACTION_METHODS,
  SKILL_ACTIONS_UI_FEATURE,
  SKILL_ACTION_JOBS_UI_FEATURE,
} from "./skill-methods.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export type SkillActionExecution = "sync" | "background";
export type SkillActionJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "abandoned";

export interface SkillAction {
  id: string;
  skillId: string;
  label: string;
  description?: string | undefined;
  tags: string[];
  surfaces: string[];
  inputSchema: unknown;
  execution: SkillActionExecution;
  available: boolean;
  unavailableReason?: string | undefined;
}

export interface SkillActionJob {
  id: string;
  batchId: string;
  actionId: string;
  skillId: string;
  status: SkillActionJobStatus;
  output?: string | undefined;
  error?: string | undefined;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SkillActionInvocation {
  ok: boolean;
  execution: SkillActionExecution;
  results: { success: boolean; output: string }[];
  jobs: SkillActionJob[];
  batchId?: string | undefined;
}

const JOB_STATUSES = new Set<SkillActionJobStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "abandoned",
]);
const boundedText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 8192;
const text = (value: unknown): value is string =>
  boundedText(value) && value.trim().length > 0;
const nullableText = (value: unknown) =>
  value === undefined || value === null || boundedText(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseSkillActions(
  value: unknown,
  profileId: string,
  sessionId: string,
): SkillAction[] | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    value.session_id !== sessionId ||
    !Array.isArray(value.actions) ||
    !count(value.count) ||
    value.count !== value.actions.length
  ) {
    return null;
  }
  const result: SkillAction[] = [];
  const ids = new Set<string>();
  for (const row of value.actions) {
    if (
      !isRecord(row) ||
      !text(row.id) ||
      ids.has(row.id) ||
      !text(row.skill_id) ||
      !text(row.label) ||
      !nullableText(row.description) ||
      !Array.isArray(row.tags) ||
      !row.tags.every(text) ||
      !Array.isArray(row.surfaces) ||
      !row.surfaces.every(text) ||
      (row.execution !== "sync" && row.execution !== "background") ||
      typeof row.available !== "boolean" ||
      !nullableText(row.unavailable_reason)
    ) {
      return null;
    }
    ids.add(row.id);
    result.push({
      id: row.id,
      skillId: row.skill_id,
      label: row.label,
      description: row.description as string | undefined,
      tags: row.tags,
      surfaces: row.surfaces,
      inputSchema: row.input_schema,
      execution: row.execution,
      available: row.available,
      unavailableReason: row.unavailable_reason as string | undefined,
    });
  }
  return result;
}

export function parseSkillActionJob(
  value: unknown,
  profileId: string,
  sessionId: string,
): SkillActionJob | null {
  if (
    !isRecord(value) ||
    !text(value.job_id) ||
    !text(value.batch_id) ||
    value.profile_id !== profileId ||
    value.session_id !== sessionId ||
    !text(value.action_id) ||
    !text(value.skill_id) ||
    !JOB_STATUSES.has(value.status as SkillActionJobStatus) ||
    !nullableText(value.output) ||
    !nullableText(value.error) ||
    !text(value.created_at) ||
    !text(value.updated_at)
  ) {
    return null;
  }
  return {
    id: value.job_id,
    batchId: value.batch_id,
    actionId: value.action_id,
    skillId: value.skill_id,
    status: value.status as SkillActionJobStatus,
    output: value.output as string | undefined,
    error: value.error as string | undefined,
    result: value.result,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

export function parseSkillActionJobs(
  value: unknown,
  profileId: string,
  sessionId: string,
): SkillActionJob[] | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    value.session_id !== sessionId ||
    !Array.isArray(value.jobs) ||
    !count(value.count) ||
    value.count !== value.jobs.length
  ) {
    return null;
  }
  const jobs = value.jobs.map((job) =>
    parseSkillActionJob(job, profileId, sessionId),
  );
  return jobs.some((job) => job === null) ? null : (jobs as SkillActionJob[]);
}

export function parseSkillActionInvocation(
  value: unknown,
  actionId: string,
  profileId: string,
  sessionId: string,
): SkillActionInvocation | null {
  if (
    !isRecord(value) ||
    value.action_id !== actionId ||
    typeof value.ok !== "boolean" ||
    (value.execution !== undefined && value.execution !== "background")
  ) {
    return null;
  }
  if (value.execution === "background") {
    const jobs = parseSkillActionJobs(
      {
        profile_id: profileId,
        session_id: sessionId,
        count: Array.isArray(value.jobs) ? value.jobs.length : -1,
        jobs: value.jobs,
      },
      profileId,
      sessionId,
    );
    if (!jobs || !text(value.batch_id)) return null;
    return {
      ok: value.ok,
      execution: "background",
      results: [],
      jobs,
      batchId: value.batch_id,
    };
  }
  if (!Array.isArray(value.results)) return null;
  const results: { success: boolean; output: string }[] = [];
  for (const row of value.results) {
    if (
      !isRecord(row) ||
      typeof row.success !== "boolean" ||
      !boundedText(row.output)
    ) {
      return null;
    }
    results.push({ success: row.success, output: row.output });
  }
  return { ok: value.ok, execution: "sync", results, jobs: [] };
}

export function parseSkillActionJobUpdated(
  notification: RpcNotification,
  profileId: string,
  sessionId: string,
): SkillActionJob | null {
  if (notification.method !== CORE_UI_METHODS.SKILL_ACTION_JOB_UPDATED) {
    return null;
  }
  const value = notification.params;
  return isRecord(value) &&
    value.profile_id === profileId &&
    value.session_id === sessionId
    ? parseSkillActionJob(value.job, profileId, sessionId)
    : null;
}

export function createSkillActionCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  profileId: string,
  sessionId: string,
  capabilities: UiProtocolCapabilities,
) {
  function available(method: string, jobs: boolean) {
    if (!text(profileId) || !text(sessionId)) {
      throw new Error("A confirmed Profile and Session are required");
    }
    if (
      !supportsFeature(
        capabilities,
        jobs ? SKILL_ACTION_JOBS_UI_FEATURE : SKILL_ACTIONS_UI_FEATURE,
      ) ||
      !supportsMethod(capabilities, method)
    ) {
      throw new Error(`${method} is not advertised by this server`);
    }
  }
  return {
    async list(): Promise<SkillAction[]> {
      available(APPUI_SKILL_ACTION_METHODS.LIST, false);
      const value = await client.request(APPUI_SKILL_ACTION_METHODS.LIST, {
        profile_id: profileId,
        session_id: sessionId,
      });
      const parsed = parseSkillActions(value, profileId, sessionId);
      if (!parsed) throw new Error("Invalid or wrong-scope skill actions");
      return parsed;
    },
    async invoke(
      actionId: string,
      argumentsValue: Record<string, unknown> = {},
    ): Promise<SkillActionInvocation> {
      available(APPUI_SKILL_ACTION_METHODS.INVOKE, false);
      if (!text(actionId) || !isRecord(argumentsValue)) {
        throw new Error("A valid action and argument object are required");
      }
      const value = await client.request(APPUI_SKILL_ACTION_METHODS.INVOKE, {
        profile_id: profileId,
        session_id: sessionId,
        action_id: actionId,
        arguments: argumentsValue,
      });
      const bareId = actionId.split("/").at(-1) ?? actionId;
      const parsed = parseSkillActionInvocation(
        value,
        bareId,
        profileId,
        sessionId,
      );
      if (!parsed) throw new Error("Invalid skill action invocation result");
      return parsed;
    },
    async listJobs(actionId?: string): Promise<SkillActionJob[]> {
      available(APPUI_SKILL_ACTION_METHODS.JOB_LIST, true);
      const value = await client.request(APPUI_SKILL_ACTION_METHODS.JOB_LIST, {
        profile_id: profileId,
        session_id: sessionId,
        ...(actionId ? { action_id: actionId } : {}),
      });
      const parsed = parseSkillActionJobs(value, profileId, sessionId);
      if (!parsed) throw new Error("Invalid or wrong-scope skill action jobs");
      return parsed;
    },
    async readJob(jobId: string): Promise<SkillActionJob> {
      available(APPUI_SKILL_ACTION_METHODS.JOB_READ, true);
      if (!text(jobId)) throw new Error("A skill action job id is required");
      const value = await client.request(APPUI_SKILL_ACTION_METHODS.JOB_READ, {
        profile_id: profileId,
        session_id: sessionId,
        job_id: jobId,
      });
      if (!isRecord(value)) throw new Error("Invalid skill action job");
      const parsed = parseSkillActionJob(value.job, profileId, sessionId);
      if (!parsed || parsed.id !== jobId) {
        throw new Error("Invalid or mismatched skill action job");
      }
      return parsed;
    },
  };
}
