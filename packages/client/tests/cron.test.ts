import { describe, expect, it, vi } from "vitest";
import {
  createCronCommands,
  CRON_CREATE,
  CRON_DELETE,
  parseCronList,
} from "../src/cron.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "../src/generated/core-contract.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.CRON_LIST,
    CORE_UI_METHODS.CRON_TOGGLE,
    CRON_CREATE,
    CRON_DELETE,
  ],
  supported_features: [CORE_UI_FEATURES.AUXILIARY_REST_TO_WS_V1],
  supported_notifications: [],
};
const job = {
  id: "cron-1",
  name: "Queue check",
  enabled: false,
  schedule: { every_ms: 1800000 },
  message: "check the queue",
  channel: "system",
  last_run: null,
  last_status: null,
  next_in: "30m",
  timezone: "UTC",
};

describe("cron protocol", () => {
  it("lists jobs and returns the toggled job", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        jobs: [job],
        count: 1,
        gateway_running: false,
        truncated: false,
      })
      .mockResolvedValueOnce({ job: { ...job, enabled: true } });
    const commands = createCronCommands({ request }, capabilities);
    expect((await commands.list()).jobs[0]?.enabled).toBe(false);
    expect((await commands.toggle("cron-1", true)).enabled).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, "cron/list", {});
    expect(request).toHaveBeenLastCalledWith("cron/toggle", {
      job_id: "cron-1",
      enabled: true,
    });
  });

  it("adds the optional current session to list and toggle", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        jobs: [job],
        count: 1,
        gateway_running: false,
        truncated: false,
      })
      .mockResolvedValueOnce({ job: { ...job, enabled: true } });
    const commands = createCronCommands({ request }, capabilities);
    await commands.list("coding:api:web-current");
    await commands.toggle("cron-1", true, "coding:api:web-current");
    expect(request).toHaveBeenNthCalledWith(1, "cron/list", {
      session_id: "coding:api:web-current",
    });
    expect(request).toHaveBeenNthCalledWith(2, "cron/toggle", {
      job_id: "cron-1",
      enabled: true,
      session_id: "coding:api:web-current",
    });
  });

  it("creates At, Every and Cron jobs with exact session scope", async () => {
    const created = {
      ...job,
      id: "server-generated",
      enabled: true,
      next_run: 1_800_000_000_000,
      last_error: "delivery refused",
    };
    const request = vi.fn().mockResolvedValue({ job: created });
    const commands = createCronCommands({ request }, capabilities);
    for (const schedule of [
      { kind: "At", at_ms: 1_800_000_000_000 },
      { kind: "Every", every_ms: 60_000 },
      { kind: "Cron", expr: "0 0 9 * * *" },
    ] as const) {
      expect(
        (
          await commands.create({
            session_id: "session-1",
            schedule,
            message: "check the queue",
            mode: "agent",
          })
        ).id,
      ).toBe("server-generated");
      expect(request).toHaveBeenLastCalledWith("cron/create", {
        session_id: "session-1",
        schedule,
        message: "check the queue",
        mode: "agent",
      });
    }
    const parsed = parseCronList({
      jobs: [created],
      count: 1,
      gateway_running: false,
    });
    expect(parsed?.jobs[0]).toMatchObject({
      nextRun: 1_800_000_000_000,
      lastError: "delivery refused",
      enabled: true,
    });
  });

  it("deletes by session and job id and accepts an idempotent result", async () => {
    const request = vi.fn().mockResolvedValue({ deleted: true });
    const commands = createCronCommands({ request }, capabilities);
    await commands.delete("session-1", "missing-job");
    expect(request).toHaveBeenCalledWith("cron/delete", {
      session_id: "session-1",
      job_id: "missing-job",
    });
  });

  it("keeps truncation and gateway ownership visible", () => {
    expect(
      parseCronList({
        jobs: [job],
        count: 8,
        gateway_running: true,
        truncated: true,
      }),
    ).toMatchObject({ count: 8, gatewayRunning: true, truncated: true });
  });

  it("fails closed without AUX", async () => {
    const request = vi.fn();
    const commands = createCronCommands(
      { request },
      { ...capabilities, supported_features: [] },
    );
    await expect(commands.list()).rejects.toThrow(/not advertised/);
    expect(request).not.toHaveBeenCalled();
  });
});
