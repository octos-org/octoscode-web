import { describe, expect, it } from "vitest";
import {
  actionArguments,
  actionArgumentsComplete,
  actionArgumentFields,
  mergeSkillJobs,
  skillJobsActive,
} from "./action-fields.ts";

describe("skill action arguments", () => {
  const schema = {
    type: "object",
    properties: {
      input_path: { type: "string" },
      attempts: { type: "integer" },
      publish: { type: "boolean" },
    },
    required: ["input_path", "attempts", "publish"],
  };

  it("builds typed arguments only after required fields are valid", () => {
    const fields = actionArgumentFields(schema);
    expect(fields).toEqual([
      { name: "input_path", type: "string" },
      { name: "attempts", type: "number" },
      { name: "publish", type: "boolean" },
    ]);
    expect(actionArgumentsComplete(fields, { input_path: "in.txt" })).toBe(
      false,
    );
    const values = { input_path: "in.txt", attempts: "2", publish: true };
    expect(actionArgumentsComplete(fields, values)).toBe(true);
    expect(actionArguments(fields, values)).toEqual({
      input_path: "in.txt",
      attempts: 2,
      publish: true,
    });
  });
});

describe("skill job projection", () => {
  const base = {
    batchId: "batch-1",
    actionId: "document.probe",
    skillId: "lifecycle-skill",
    createdAt: "2026-10-28T00:00:00Z",
    updatedAt: "2026-10-28T00:00:00Z",
  };
  it("replaces matching jobs, sorts recent first, and tracks active work", () => {
    const merged = mergeSkillJobs(
      [{ ...base, id: "job-1", status: "queued" }],
      [
        {
          ...base,
          id: "job-1",
          status: "succeeded",
          updatedAt: "2026-10-28T00:01:00Z",
        },
        {
          ...base,
          id: "job-2",
          status: "running",
          updatedAt: "2026-10-28T00:02:00Z",
        },
      ],
    );
    expect(merged.map((job) => job.id)).toEqual(["job-2", "job-1"]);
    expect(merged[1]?.status).toBe("succeeded");
    expect(skillJobsActive(merged)).toBe(true);
    expect(skillJobsActive([merged[1]!])).toBe(false);
  });
});
