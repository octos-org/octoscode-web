import { describe, expect, it } from "vitest";
import fixture from "./fixtures/ui-protocol-v1.json";
import {
  parsePlanUpdated,
  parseSessionStatusReadResult,
  parseTaskArtifactListResult,
  parseTaskListResult,
  parseTaskOutputReadResult,
  parseTaskUpdated,
} from "../src/index.ts";

describe("supervised coding contract", () => {
  it("decodes pinned task, output, artifact, and runtime fixtures", () => {
    expect(parseTaskListResult(fixture.task_list.result)).toEqual(
      fixture.task_list.result,
    );
    expect(parseTaskOutputReadResult(fixture.task_output_read.result)).toEqual(
      fixture.task_output_read.result,
    );
    expect(
      parseTaskArtifactListResult(fixture.task_artifact_list.result),
    ).toEqual(fixture.task_artifact_list.result);
    expect(
      parseSessionStatusReadResult(fixture.session_status_read.result),
    ).toEqual(fixture.session_status_read.result);
  });

  it("parses live task and plan notifications", () => {
    expect(
      parseTaskUpdated({
        jsonrpc: "2.0",
        method: "task/updated",
        params: {
          session_id: "coding:local:main",
          task_id: "00000000-0000-4000-8000-000000000099",
          title: "Tests",
          state: "completed",
          role: "test_worker",
          artifact_count: 1,
        },
      }),
    ).toMatchObject({ state: "completed", role: "test_worker" });
    expect(
      parsePlanUpdated({
        jsonrpc: "2.0",
        method: "plan/updated",
        params: {
          session_id: "coding:local:main",
          turn_id: "turn-1",
          plan: {
            title: "Verify",
            updated_at_ms: 42,
            items: [
              { id: "check", title: "Run checks", status: "in_progress" },
            ],
          },
        },
      }),
    ).toMatchObject({ title: "Verify", items: [{ status: "in_progress" }] });
  });

  it("rejects unsafe task ids and unknown plan statuses", () => {
    expect(
      parseTaskListResult({
        ...fixture.task_list.result,
        tasks: [{ ...fixture.task_list.result.tasks[0], id: "task-prose" }],
      }),
    ).toBeNull();
    expect(
      parsePlanUpdated({
        jsonrpc: "2.0",
        method: "plan/updated",
        params: {
          session_id: "s1",
          plan: {
            updated_at_ms: 1,
            items: [{ id: "x", title: "X", status: "future" }],
          },
        },
      }),
    ).toBeNull();
  });

  it("tolerates the legacy unresolved-model status shape without hiding malformed siblings", () => {
    expect(
      parseSessionStatusReadResult({
        session_id: "s1",
        model: { model: null, provider: null, selected: true },
      }),
    ).toEqual({ session_id: "s1", mcp_servers: [] });
    expect(
      parseSessionStatusReadResult({
        session_id: "s1",
        model: { model: null, provider: 42 },
      }),
    ).toBeNull();
  });
});
