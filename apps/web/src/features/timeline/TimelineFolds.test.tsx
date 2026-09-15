import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
import { ThinkingDisclosure } from "./ThinkingDisclosure.tsx";
import { ToolCallDisclosure } from "./ToolCallDisclosure.tsx";
import { TurnActivityIndicator } from "./TurnActivityIndicator.tsx";
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

describe("Timeline foldable rendering", () => {
  it("renders thinking collapsed with a one-line summary when showThinking", () => {
    const html = renderToStaticMarkup(
      <Timeline
        entries={[reasoningEntry]}
        connected
        showThinking
        folds={{}}
        onToggleFold={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
      />,
    );
    // Timeline renders upstream's native <details> disclosure: folded means
    // no `open` attribute; the one-line summary is the <summary> element and
    // the reasoning text lives only in the (natively hidden) body.
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*reasoningBlock/);
    const summary = summaryOf(html);
    expect(summary).toContain("Thought process");
    expect(summary).toContain("12 s · 6 words");
    expect(summary).not.toContain("let me think about this carefully");
    expect(html).toMatch(
      /<\/summary><div[^>]*reasoningBody[^>]*><pre[^>]*>let me think about this carefully<\/pre>/,
    );
  });

  it("renders no thinking at all when showThinking is off (no marker)", () => {
    const html = renderToStaticMarkup(
      <Timeline
        entries={[reasoningEntry, toolEntry]}
        connected
        showThinking={false}
        folds={{}}
        onToggleFold={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
      />,
    );
    expect(html).not.toContain("let me think about this carefully");
    expect(html).not.toContain("Thinking · ");
    expect(html).not.toContain("Thought process");
    expect(html).not.toContain("reasoningBlock");
    expect(html).not.toContain("thinking hidden");
    expect(html).toContain("cargo test");
  });

  it("renders tool calls folded with a one-line header", () => {
    const html = renderToStaticMarkup(
      <Timeline
        entries={[toolEntry]}
        connected
        showThinking
        folds={{}}
        onToggleFold={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
      />,
    );
    // Folded by default; the header line carries tool name, target, status
    // mark (check glyph + label) and duration.
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*toolBlock/);
    const summary = summaryOf(html);
    expect(summary).toContain("shell · cargo test");
    expect(summary).toMatch(/completedGlyph/);
    expect(summary).toMatch(/data-status="complete"[^>]*>Done · 3 s</);
    expect(summary).not.toContain("<pre");
  });

  it("exposes Expand all / Collapse all at the transcript top", () => {
    const html = renderToStaticMarkup(
      <Timeline
        entries={[toolEntry]}
        connected
        showThinking
        folds={{}}
        onToggleFold={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
      />,
    );
    const tools = html.indexOf("Expand all");
    expect(tools).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Expand all")).toBeLessThan(
      html.indexOf("shell · cargo test"),
    );
    expect(html).toContain("Collapse all");
  });

  it("keeps errors visible in the folded tool header", () => {
    const failing: TimelineEntry = { ...toolEntry, status: "error" };
    const html = renderToStaticMarkup(
      <Timeline
        entries={[failing]}
        connected
        showThinking
        folds={{}}
        onToggleFold={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
      />,
    );
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*toolBlock/);
    const summary = summaryOf(html);
    expect(summary).toContain("shell · cargo test");
    expect(summary).toMatch(/data-status="error"[^>]*aria-hidden="true"/);
    expect(summary).toMatch(/data-status="error"[^>]*>Failed · 3 s</);
    expect(summary).not.toMatch(/completedGlyph/);
  });
});

function summaryOf(html: string): string {
  return /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "";
}

describe("ThinkingDisclosure", () => {
  it("is a native disclosure button announcing expanded state", () => {
    const collapsed = renderToStaticMarkup(
      <ThinkingDisclosure
        entry={reasoningEntry}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(collapsed).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(collapsed).toMatch(/aria-controls="[^"]+"/);
    expect(collapsed).toContain("Thinking · 12 s · 6 words");
    const expanded = renderToStaticMarkup(
      <ThinkingDisclosure
        entry={reasoningEntry}
        expanded
        onToggle={() => {}}
      />,
    );
    expect(expanded).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(expanded).toContain("let me think about this carefully");
  });
});

describe("ToolCallDisclosure", () => {
  it("is a native disclosure button with the header line", () => {
    const collapsed = renderToStaticMarkup(
      <ToolCallDisclosure
        entry={toolEntry}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(collapsed).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(collapsed).toContain("shell · cargo test · ✓ · 3 s");
    expect(collapsed).not.toContain("<pre>");
    const expanded = renderToStaticMarkup(
      <ToolCallDisclosure entry={toolEntry} expanded onToggle={() => {}} />,
    );
    expect(expanded).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(expanded).toContain("<pre ");
    expect(expanded).toContain("</pre>");
  });

  it("shows the error glyph on the header line for failed calls", () => {
    const html = renderToStaticMarkup(
      <ToolCallDisclosure
        entry={{ ...toolEntry, status: "error" }}
        expanded={false}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("✗");
  });
});

describe("TurnActivityIndicator", () => {
  it("renders the animated glyph and status word while streaming", () => {
    const html = renderToStaticMarkup(
      <TurnActivityIndicator
        activity={{ label: "Thinking…", startedAtMs: 0, lastAtMs: 1_000 }}
      />,
    );
    expect(html).toContain("Thinking…");
    expect(html).toMatch(/class="[^"]*[Tt]hinking.?[Ss]pinner/);
    expect(html).toMatch(/role="status"/);
  });

  it("renders nothing once the turn ends", () => {
    expect(
      renderToStaticMarkup(<TurnActivityIndicator activity={null} />),
    ).toBe("");
  });

  it("announces the animated glyph as hidden from assistive tech", () => {
    const html = renderToStaticMarkup(
      <TurnActivityIndicator
        activity={{ label: "Running shell…", startedAtMs: 0, lastAtMs: 1 }}
      />,
    );
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html).toContain("Running shell…");
  });
});
