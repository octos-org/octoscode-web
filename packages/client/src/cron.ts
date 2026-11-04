import { isRecord } from "./rpc.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export const CRON_CREATE = "cron/create";
export const CRON_DELETE = "cron/delete";

export type CronCreateSchedule =
  | { kind: "At"; at_ms: number }
  | { kind: "Every"; every_ms: number }
  | { kind: "Cron"; expr: string };

export interface CronCreateParams {
  session_id: string;
  schedule: CronCreateSchedule;
  message: string;
  deliver?: boolean;
  channel?: string;
  chat_id?: string;
  mode?: "agent" | "notify";
  timezone?: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: unknown;
  message: string;
  channel?: string | null | undefined;
  lastRun?: string | null | undefined;
  lastStatus?: string | null | undefined;
  lastError?: string | null | undefined;
  nextRun?: number | null | undefined;
  nextIn?: string | null | undefined;
  timezone?: string | null | undefined;
  /** The Session a run delivers to; absent on jobs not created from one. */
  originSessionId?: string | undefined;
}
export interface CronListResult {
  jobs: CronJob[];
  count: number;
  gatewayRunning: boolean;
  truncated: boolean;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 8192;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullable = (value: unknown) =>
  value === undefined || value === null || text(value);
const nullableTimestamp = (value: unknown) =>
  value === undefined || value === null || count(value);

export function parseCronJob(value: unknown): CronJob | null {
  if (
    !isRecord(value) ||
    !text(value.id) ||
    !text(value.name) ||
    typeof value.enabled !== "boolean" ||
    !text(value.message) ||
    !nullable(value.channel) ||
    !nullable(value.last_run) ||
    !nullable(value.last_status) ||
    !nullable(value.last_error) ||
    !nullableTimestamp(value.next_run) ||
    !nullable(value.next_in) ||
    !nullable(value.timezone)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    schedule: value.schedule,
    message: value.message,
    channel: value.channel as string | null | undefined,
    lastRun: value.last_run as string | null | undefined,
    lastStatus: value.last_status as string | null | undefined,
    lastError: value.last_error as string | null | undefined,
    nextRun: value.next_run as number | null | undefined,
    nextIn: value.next_in as string | null | undefined,
    timezone: value.timezone as string | null | undefined,
    ...(isRecord(value.origin) && text(value.origin.session_id)
      ? { originSessionId: value.origin.session_id }
      : {}),
  };
}

export function parseCronList(value: unknown): CronListResult | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.jobs) ||
    !count(value.count) ||
    typeof value.gateway_running !== "boolean" ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean")
  ) {
    return null;
  }
  const jobs = value.jobs.map(parseCronJob);
  return jobs.some((job) => job === null)
    ? null
    : {
        jobs: jobs as CronJob[],
        count: value.count,
        gatewayRunning: value.gateway_running,
        truncated: value.truncated === true,
      };
}

export function createCronCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  capabilities: UiProtocolCapabilities,
) {
  function available(method: string) {
    if (
      !supportsFeature(
        capabilities,
        CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1,
      ) ||
      !supportsMethod(capabilities, method)
    ) {
      throw new Error(`${method} is not advertised by this server`);
    }
  }
  return {
    async list(sessionId?: string): Promise<CronListResult> {
      available(CORE_UI_METHODS.CRON_LIST);
      const value = await client.request(
        CORE_UI_METHODS.CRON_LIST,
        sessionId ? { session_id: sessionId } : {},
      );
      const parsed = parseCronList(value);
      if (!parsed) throw new Error("Invalid cron job list");
      return parsed;
    },
    async toggle(
      jobId: string,
      enabled: boolean,
      sessionId?: string,
    ): Promise<CronJob> {
      available(CORE_UI_METHODS.CRON_TOGGLE);
      if (!text(jobId)) throw new Error("A cron job id is required");
      const value = await client.request(CORE_UI_METHODS.CRON_TOGGLE, {
        job_id: jobId,
        enabled,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      if (!isRecord(value)) throw new Error("Invalid cron toggle result");
      const job = parseCronJob(value.job);
      if (!job || job.id !== jobId) {
        throw new Error("Invalid or mismatched cron job");
      }
      return job;
    },
    async create(params: CronCreateParams): Promise<CronJob> {
      available(CRON_CREATE);
      if (!text(params.session_id) || !params.message.trim()) {
        throw new Error("A session and non-empty cron message are required");
      }
      const value = await client.request(CRON_CREATE, params);
      if (!isRecord(value)) throw new Error("Invalid cron create result");
      const job = parseCronJob(value.job);
      if (!job) throw new Error("Invalid cron job returned by create");
      return job;
    },
    async delete(sessionId: string, jobId: string): Promise<void> {
      available(CRON_DELETE);
      if (!text(sessionId) || !text(jobId)) {
        throw new Error("A session and cron job id are required");
      }
      const value = await client.request(CRON_DELETE, {
        session_id: sessionId,
        job_id: jobId,
      });
      if (!isRecord(value) || value.deleted !== true) {
        throw new Error("Invalid cron delete result");
      }
    },
  };
}
