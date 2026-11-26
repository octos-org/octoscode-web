// T-0687 (R8-F03): modified-only turns must not print "No output files"
// beside the file cards; a no-change turn keeps it. Static markup, no jsdom.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TurnSummary } from "./TurnSummary.tsx";
import type { TimelineEntry } from "./entry-model.ts";

const terminal: TimelineEntry = {
  id: "terminal:t1",
  kind: "system",
  title: "Turn complete",
  body: "",
  status: "info",
  turnId: "t1",
  latestTurnOutcome: "completed",
};
const tool = (id: string, title: string, path: string): TimelineEntry => ({
  id,
  kind: "tool",
  title,
  body: "",
  status: "complete",
  turnId: "t1",
  toolArguments: JSON.stringify({ path }),
});
const rendered = (entries: TimelineEntry[]) =>
  renderToStaticMarkup(createElement(TurnSummary, { turnId: "t1", entries }));

describe("TurnSummary output line", () => {
  it.each([
    {
      name: "modified-only turn: no contradicting empty line",
      entries: [tool("tool-1", "apply_patch", "calculator.py"), terminal],
      present: ["1 files changed"],
      absent: ["No output files"],
    },
    {
      name: "no-change turn keeps the honest empty line",
      entries: [terminal],
      present: ["No output files"],
      absent: [],
    },
    {
      name: "delivered files are listed",
      entries: [tool("tool-2", "write_file", "report.md"), terminal],
      present: ["Output files:", "report.md"],
      absent: ["No output files"],
    },
  ])("$name", ({ entries, present, absent }) => {
    const html = rendered(entries);
    for (const text of present) expect(html).toContain(text);
    for (const text of absent) expect(html).not.toContain(text);
  });
});
