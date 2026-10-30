import { describe, expect, it, vi } from "vitest";
import { createCronCommands, parseCronList } from "../src/cron.ts";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
} from "../src/generated/core-contract.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [CORE_UI_METHODS.CRON_LIST, CORE_UI_METHODS.CRON_TOGGLE],
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
    expect(request).toHaveBeenLastCalledWith("cron/toggle", {
      job_id: "cron-1",
      enabled: true,
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
