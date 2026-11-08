import { describe, expect, it } from "vitest";
import fixture from "./fixtures/ui-protocol-v1.json";
import {
  parseSessionStatusReadResult,
  parseTaskArtifactListResult,
  parseTaskListResult,
  parseTaskOutputReadResult,
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
