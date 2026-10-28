import { describe, expect, it, vi } from "vitest";
import {
  createSkillActionCommands,
  parseSkillActionJobUpdated,
} from "../src/skill-actions.ts";
import {
  APPUI_SKILL_ACTION_METHODS,
  SKILL_ACTIONS_UI_FEATURE,
  SKILL_ACTION_JOBS_UI_FEATURE,
} from "../src/skill-methods.ts";
import { DEFAULT_UI_FEATURES } from "../src/client.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: Object.values(APPUI_SKILL_ACTION_METHODS),
  supported_features: [SKILL_ACTIONS_UI_FEATURE, SKILL_ACTION_JOBS_UI_FEATURE],
  supported_notifications: [],
};
const job = {
  job_id: "job-1",
  batch_id: "batch-1",
  profile_id: "coding",
  session_id: "session-1",
  action_id: "document.probe",
  skill_id: "lifecycle-skill",
  status: "queued",
  created_at: "2026-10-28T00:00:00Z",
  updated_at: "2026-10-28T00:00:00Z",
};
const action = {
  id: "document.probe",
  skill_id: "lifecycle-skill",
  label: "Run document probe",
  description: "Verify the document pipeline",
  tags: ["documents"],
  surfaces: ["settings"],
  input_schema: { type: "object", properties: {} },
  execution: "background",
  available: true,
};

describe("skill action protocol", () => {
  it("opts into both action feature families", () => {
    expect(DEFAULT_UI_FEATURES).toContain(SKILL_ACTIONS_UI_FEATURE);
    expect(DEFAULT_UI_FEATURES).toContain(SKILL_ACTION_JOBS_UI_FEATURE);
  });

  it("lists trusted actions and returns background jobs", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        profile_id: "coding",
        session_id: "session-1",
        count: 1,
        actions: [action],
      })
      .mockResolvedValueOnce({
        action_id: "document.probe",
        ok: true,
        execution: "background",
        batch_id: "batch-1",
        jobs: [job],
      });
    const commands = createSkillActionCommands(
      { request },
      "coding",
      "session-1",
      capabilities,
    );
    expect(await commands.list()).toHaveLength(1);
    const invoked = await commands.invoke("lifecycle-skill/document.probe", {});
    expect(invoked.execution).toBe("background");
    expect(invoked.jobs[0]?.id).toBe("job-1");
    expect(request).toHaveBeenLastCalledWith("skill/action/invoke", {
      profile_id: "coding",
      session_id: "session-1",
      action_id: "lifecycle-skill/document.probe",
      arguments: {},
    });
  });

  it("decodes synchronous results and live job updates", async () => {
    const request = vi.fn().mockResolvedValue({
      action_id: "document.probe",
      ok: true,
      results: [{ success: true, output: "protocol action fixture" }],
    });
    const commands = createSkillActionCommands(
      { request },
      "coding",
      "session-1",
      capabilities,
    );
    expect((await commands.invoke("document.probe")).results[0]?.output).toBe(
      "protocol action fixture",
    );
    expect(
      parseSkillActionJobUpdated(
        {
          jsonrpc: "2.0",
          method: "skill/action/job/updated",
          params: { profile_id: "coding", session_id: "session-1", job },
        },
        "coding",
        "session-1",
      )?.id,
    ).toBe("job-1");
    expect(
      parseSkillActionJobUpdated(
        {
          jsonrpc: "2.0",
          method: "skill/action/job/updated",
          params: { profile_id: "other", session_id: "session-1", job },
        },
        "coding",
        "session-1",
      ),
    ).toBeNull();
  });

  it("fails closed on wrong scope and missing negotiated features", async () => {
    const request = vi.fn().mockResolvedValue({
      job: { ...job, profile_id: "other" },
    });
    const commands = createSkillActionCommands(
      { request },
      "coding",
      "session-1",
      capabilities,
    );
    await expect(commands.readJob("job-1")).rejects.toThrow();
    const gatedRequest = vi.fn();
    const gated = createSkillActionCommands(
      { request: gatedRequest },
      "coding",
      "session-1",
      { ...capabilities, supported_features: [] },
    );
    await expect(gated.list()).rejects.toThrow(/not advertised/);
    expect(gatedRequest).not.toHaveBeenCalled();
  });
});
