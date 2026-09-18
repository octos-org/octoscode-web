import { describe, expect, it } from "vitest";
import { backgroundSessionState } from "./background-session-status.ts";
import type { TimelineEntry } from "../timeline/model.ts";

const empty = { active: null, pending: [] };
const turn = { turnId: "next", text: "Continue" };
const entry = (
  id: string,
  status: TimelineEntry["status"] = "complete",
  kind: TimelineEntry["kind"] = "system",
): TimelineEntry => ({ id, status, kind, title: "Event", body: "" });

describe("confirmed background Session status", () => {
  it("keeps a never-run confirmed Session idle", () => {
    expect(backgroundSessionState(empty, false, [])).toBe("idle");
  });
  it("does not infer completion or failure from metadata, messages, tools or warnings", () => {
    expect(
      backgroundSessionState(empty, false, [
        entry("session:opened"),
        entry("hydrated:1", "complete", "assistant"),
        entry("tool:done", "complete", "tool"),
        entry("warning:1", "error"),
        entry("terminal:fake", "complete", "assistant"),
        entry("terminal:"),
      ]),
    ).toBe("idle");
  });
  it("uses the latest real terminal, regardless of later generic activity", () => {
    const completed = entry("terminal:one");
    const failed = entry("terminal:two", "error");
    expect(backgroundSessionState(empty, false, [completed])).toBe("completed");
    expect(backgroundSessionState(empty, false, [completed, failed])).toBe(
      "failed",
    );
    expect(
      backgroundSessionState(empty, false, [
        failed,
        completed,
        entry("warning:later", "error"),
      ]),
    ).toBe("completed");
  });
  it("prioritizes the interaction ledger even without a local queue head", () => {
    expect(backgroundSessionState(empty, true, [])).toBe("waiting");
    expect(
      backgroundSessionState({ active: turn, pending: [] }, true, [
        entry("terminal:old"),
      ]),
    ).toBe("waiting");
  });
  it("prioritizes current queued work over retained past terminal evidence", () => {
    expect(
      backgroundSessionState({ active: turn, pending: [] }, false, [
        entry("terminal:old", "error"),
      ]),
    ).toBe("running");
    expect(
      backgroundSessionState({ active: null, pending: [turn] }, false, [
        entry("terminal:old"),
      ]),
    ).toBe("running");
  });
});
