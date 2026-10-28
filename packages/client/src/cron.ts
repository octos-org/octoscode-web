import { isRecord } from "./rpc.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "./generated/core-contract.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: unknown;
  message: string;
  channel?: string | null | undefined;
  lastRun?: string | null | undefined;
  lastStatus?: string | null | undefined;
  nextIn?: string | null | undefined;
  timezone?: string | null | undefined;
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
    nextIn: value.next_in as string | null | undefined,
    timezone: value.timezone as string | null | undefined,
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
    async list(): Promise<CronListResult> {
      available(CORE_UI_METHODS.CRON_LIST);
      const value = await client.request(CORE_UI_METHODS.CRON_LIST, {});
      const parsed = parseCronList(value);
      if (!parsed) throw new Error("Invalid cron job list");
      return parsed;
    },
    async toggle(jobId: string, enabled: boolean): Promise<CronJob> {
      available(CORE_UI_METHODS.CRON_TOGGLE);
      if (!text(jobId)) throw new Error("A cron job id is required");
      const value = await client.request(CORE_UI_METHODS.CRON_TOGGLE, {
        job_id: jobId,
        enabled,
      });
      if (!isRecord(value)) throw new Error("Invalid cron toggle result");
      const job = parseCronJob(value.job);
      if (!job || job.id !== jobId) {
        throw new Error("Invalid or mismatched cron job");
      }
      return job;
    },
  };
}
