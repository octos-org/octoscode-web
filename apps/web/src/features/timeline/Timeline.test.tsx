import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
import { timelineFromHydrate } from "./model.ts";
import { AttachmentAccessContext } from "./attachment-access.ts";

describe("Timeline", () => {
  it("omits empty assistant rows without hiding useful system messages", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "assistant-empty",
            kind: "assistant",
            title: "Octos",
            body: "   ",
            status: "complete",
          },
          {
            id: "terminal",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
          },
        ]}
      />,
    );
    expect(html).not.toContain("entry-assistant");
    expect(html).not.toContain("No output yet");
    expect(html).toContain("Turn complete");
  });

  it("shows a file-only delivery as an attachment instead of hiding the row", () => {
    const entries = [
      {
        id: "delivery",
        kind: "assistant" as const,
        title: "Octos",
        body: "",
        status: "complete" as const,
        media: [
          "/work/new-octos/_build/p20-art.png",
          "/work/Single-Panel-Pilot-3p.pptx",
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <AttachmentAccessContext.Provider
        value={{ download: async () => new Blob() }}
      >
        <Timeline connected entries={entries} />
      </AttachmentAccessContext.Provider>,
    );
    expect(html).toContain("entry-assistant");
    expect(html).toContain('data-attachment="p20-art.png"');
    expect(html).toContain('data-attachment="Single-Panel-Pilot-3p.pptx"');
    expect(html).toContain('aria-label="Download Single-Panel-Pilot-3p.pptx"');
    // The server path is never rendered as message text.
    expect(html).not.toContain("Attachment:");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Download/);
  });

  it("shows an explicitly written file as a downloadable artifact", () => {
    const html = renderToStaticMarkup(
      <AttachmentAccessContext.Provider
        value={{ download: async () => new Blob() }}
      >
        <Timeline
          connected
          workspaceFileReadAvailable
          entries={[
            {
              id: "tool-write",
              kind: "tool",
              title: "write_file",
              body: "Successfully wrote report.md",
              status: "complete",
              artifactPath: "report.md",
            },
          ]}
        />
      </AttachmentAccessContext.Provider>,
    );
    expect(html).toContain('data-attachment="report.md"');
    expect(html).toContain("Download report.md");
  });

  it("keeps a refreshed artifact card only when Core supplies write_path", () => {
    const hydrated = (structured: boolean) =>
      timelineFromHydrate({
        session_id: "coding:local:main",
        cursor: { stream: "coding:local:main", seq: 2 },
        replayed_projection_envelopes: [
          {
            session_id: "coding:local:main",
            thread_id: "thread-1",
            turn_id: "turn-1",
            seq: 1,
            payload: {
              type: "tool_start",
              data: {
                tool_call_id: "write-report",
                name: "write_file",
                arguments_preview: `{"content":"${"x".repeat(2_000)}`,
                ...(structured ? { write_path: "report.md" } : {}),
              },
            },
          },
          {
            session_id: "coding:local:main",
            thread_id: "thread-1",
            turn_id: "turn-1",
            seq: 2,
            payload: {
              type: "tool_end",
              data: { tool_call_id: "write-report", status: "complete" },
            },
          },
        ],
      });
    const render = (structured: boolean) =>
      renderToStaticMarkup(
        <AttachmentAccessContext.Provider
          value={{ download: async () => new Blob() }}
        >
          <Timeline
            connected
            workspaceFileReadAvailable
            entries={hydrated(structured)}
          />
        </AttachmentAccessContext.Provider>,
      );
    expect(render(true)).toContain('data-attachment="report.md"');
    expect(render(false)).not.toContain('data-attachment="report.md"');
  });

  it("does not offer workspace artifacts without the read capability", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "tool-write",
            kind: "tool",
            title: "write_file",
            body: "Successfully wrote report.md",
            status: "complete",
            artifactPath: "report.md",
          },
        ]}
      />,
    );
    expect(html).not.toContain('data-attachment="report.md"');
  });

  it("disables downloads when no Session can serve files", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "delivery",
            kind: "assistant",
            title: "Octos",
            body: "Here is the deck",
            status: "complete",
            media: ["/work/deck.pptx"],
          },
        ]}
      />,
    );
    expect(html).toContain("Here is the deck");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Download/);
  });

  it("does not translate a hydrated system role as a theme label", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "system:hydrated",
            kind: "system",
            title: "system",
            body: "Hydrated notice",
            status: "complete",
            turnId: "turn-1",
          },
        ]}
      />,
    );
    expect(html).toContain("<strong>system</strong>");
    expect(html).not.toContain("<strong>跟随系统</strong>");
  });

  it("expands failed steps and renders a complete turn summary", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={[
          {
            id: "tool:failed",
            kind: "tool",
            title: "write_file",
            body: "permission denied",
            toolArguments: '{"path":"report.md"}',
            status: "error",
            turnId: "turn-1",
            startedAtMs: 1000,
            endedAtMs: 2000,
          },
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            startedAtMs: 1000,
            endedAtMs: 4000,
            turnUsage: { input: 12, output: 9 },
          },
        ]}
      />,
    );
    expect(html).toContain("Write file report.md");
    expect(html).toContain("write_file");
    expect(html).toContain("permission denied");
    expect(html).toContain("⚠ 1 steps failed");
    expect(html).toContain("Duration 3s");
    expect(html).toContain("12 tokens in · 9 tokens out");
    expect(html).toMatch(/<details[^>]*open/);
  });

  it("announces the timeline via a log landmark (a11y finding 4)", () => {
    const html = renderToStaticMarkup(
      <Timeline
        entries={[
          {
            id: "user-1",
            kind: "user",
            title: "You",
            body: "hello",
            status: "complete",
            turnId: "turn-1",
          },
        ]}
        connected
      />,
    );

    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Conversation timeline"');
  });
});
