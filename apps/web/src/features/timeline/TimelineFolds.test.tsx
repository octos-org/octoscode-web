import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
import { TurnActivityIndicator } from "./TurnActivityIndicator.tsx";
import { collapseAll } from "./folds.ts";
import type { TimelineEntry } from "./model.ts";

const reasoningEntry: TimelineEntry = {
  id: "reasoning:turn-1",
  kind: "reasoning",
  title: "Reasoning",
  body: "let me think about this carefully",
  status: "complete",
  turnId: "turn-1",
  startedAtMs: 0,
  endedAtMs: 12_400,
};

const toolEntry: TimelineEntry = {
  id: "tool:call-1",
  kind: "tool",
  title: "shell",
  body: '{"cmd": "cargo test"}',
  status: "complete",
  turnId: "turn-1",
  startedAtMs: 0,
  endedAtMs: 3_400,
};

const failedEntry: TimelineEntry = {
  ...toolEntry,
  id: "tool:call-2",
  status: "error",
};

/** The `<details>` block of one timeline entry, and its one-line summary. */
function block(html: string, id: string): { tag: string; summary: string } {
  const start = html.indexOf(`<details data-timeline-entry="${id}"`);
  expect(start, id).toBeGreaterThanOrEqual(0);
  const rest = html.slice(start);
  return {
    tag: /^<details\b[^>]*>/.exec(rest)?.[0] ?? "",
    summary: /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(rest)?.[1] ?? "",
  };
}
const isOpen = (tag: string): boolean => /\sopen=""/.test(tag);

describe("Timeline foldable rendering", () => {
  it("folds thinking and steps by default behind one-line summaries, under Expand all / Collapse all, and Collapse all keeps a failed step folded", () => {
    const render = (folds: Record<string, boolean>) =>
      renderToStaticMarkup(
        <Timeline
          entries={[reasoningEntry, toolEntry, failedEntry]}
          connected
          showThinking
          folds={folds}
          onToggleFold={() => {}}
          onExpandAll={() => {}}
          onCollapseAll={() => {}}
        />,
      );
    const html = render({});
    // Upstream's native <details>: folded means no `open`; the reasoning text
    // lives only in the (natively hidden) body, never in the summary.
    const thinking = block(html, reasoningEntry.id);
    expect(isOpen(thinking.tag)).toBe(false);
    expect(thinking.summary).toContain("Thought process");
    expect(thinking.summary).toContain("12 s · 6 words");
    expect(thinking.summary).not.toContain("let me think about this carefully");
    expect(html).toContain("let me think about this carefully</pre>");
    // A step's header carries a human title, its status word and duration.
    const tool = block(html, toolEntry.id);
    expect(isOpen(tool.tag)).toBe(false);
    expect(tool.summary).toContain("Run command cargo test");
    expect(tool.summary).toMatch(/data-status="complete"[^>]*>Done · 3 s</);
    expect(tool.summary).not.toContain("<pre");
    // The raw error stays folded; the header still says it failed.
    const failed = block(html, failedEntry.id);
    expect(isOpen(failed.tag)).toBe(false);
    expect(failed.summary).toMatch(/data-status="error"[^>]*>Failed · 3 s</);
    // Expand all / Collapse all sit at the transcript top.
    expect(html.indexOf("Expand all")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Expand all")).toBeLessThan(
      html.indexOf("Thought process"),
    );
    expect(html).toContain("Collapse all");
    expect(render(collapseAll({}))).not.toMatch(/<details[^>]*open/);
  });
});

describe("TurnActivityIndicator", () => {
  it("is a status whose animated glyph is hidden from assistive tech, and is gone once the turn ends", () => {
    const html = renderToStaticMarkup(
      <TurnActivityIndicator
        activity={{ label: "Running shell…", startedAtMs: 0, lastAtMs: 1 }}
      />,
    );
    expect(html).toMatch(/role="status"/);
    expect(html).toContain("Running shell…");
    expect(html).toMatch(/aria-hidden="true"[^>]*>◠</);
    expect(
      renderToStaticMarkup(<TurnActivityIndicator activity={null} />),
    ).toBe("");
  });
});
