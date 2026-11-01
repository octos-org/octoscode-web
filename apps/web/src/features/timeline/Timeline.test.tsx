import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
import { timelineFromHydrate } from "./model.ts";
import { AttachmentAccessContext } from "./attachment-access.ts";
import { collapseAll } from "./folds.ts";
import { loadChineseCatalog, UiTextProvider } from "../preferences/ui-text.tsx";

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

  it("keeps a completed turn calm when a step failed on the way", () => {
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
            id: "tool:retry",
            kind: "tool",
            title: "write_file",
            body: "written",
            toolArguments: '{"path":"report.md"}',
            status: "complete",
            turnId: "turn-1",
            startedAtMs: 2000,
            endedAtMs: 3000,
          },
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            latestTurnOutcome: "completed",
            startedAtMs: 1000,
            endedAtMs: 4000,
            turnUsage: { input: 12, output: 9 },
          },
        ]}
      />,
    );
    expect(html).toContain("Write file report.md");
    expect(html).toContain("permission denied");
    expect(html).toContain("Retried automatically 1 times");
    expect(html).not.toContain("steps failed");
    expect(html).toContain('data-retried-steps="1"');
    expect(html).toContain('data-outcome="complete"');
    expect(html).toContain("Duration 3s");
    expect(html).toContain("12 tokens in · 9 tokens out");
    // The raw error is folded by default.
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it("names a failure the turn never recovered from without a warning card", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "tool:failed",
            kind: "tool",
            title: "write_file",
            body: "permission denied",
            status: "error",
            turnId: "turn-1",
          },
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            latestTurnOutcome: "completed",
          },
        ]}
      />,
    );
    expect(html).toContain("1 steps failed");
    expect(html).not.toContain("⚠");
    expect(html).not.toContain("Retried automatically");
    expect(html).toContain('data-outcome="complete"');
  });

  it("warns only when the turn itself failed", () => {
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
            status: "error",
            turnId: "turn-1",
          },
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn failed",
            body: "provider error",
            status: "error",
            turnId: "turn-1",
            latestTurnOutcome: "failed",
          },
        ]}
      />,
    );
    expect(html).toContain("⚠ 1 steps failed");
    expect(html).toContain('data-outcome="failed"');
    expect(html).toContain("provider error");
  });

  it("drops a zero duration from the turn summary", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            latestTurnOutcome: "completed",
            startedAtMs: 5000,
            endedAtMs: 5000,
          },
        ]}
      />,
    );
    expect(html).not.toContain("Duration");
    expect(html).toContain("0 files changed");
  });

  it("folds a finished turn's steps into one disclosure and lifts its files out", () => {
    const entries = [
      {
        id: "reasoning:1",
        kind: "reasoning" as const,
        title: "Thinking",
        body: "Look at the folder",
        status: "complete" as const,
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 1000,
      },
      {
        id: "tool:list",
        kind: "tool" as const,
        title: "write_file",
        body: "Read-only file system",
        status: "error" as const,
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 1000,
      },
      {
        id: "tool:write",
        kind: "tool" as const,
        title: "write_file",
        body: "written",
        toolArguments: '{"path":"report.md"}',
        status: "complete" as const,
        turnId: "turn-1",
        artifactPath: "/work/report.md",
        startedAtMs: 1000,
        endedAtMs: 6000,
      },
      {
        id: "terminal:turn-1",
        kind: "system" as const,
        title: "Turn complete",
        body: "",
        status: "complete" as const,
        turnId: "turn-1",
        latestTurnOutcome: "completed",
      },
    ];
    const html = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={entries}
        workspaceFileReadAvailable
      />,
    );
    expect(html).toContain('data-step-group="steps:reasoning:1"');
    expect(html).toContain("Ran 2 steps");
    expect(html).toContain("Retried automatically 1 times");
    expect(html).toMatch(/Ran 2 steps<\/strong><span[^>]*>5 s</);
    expect(html).not.toMatch(/<details[^>]*stepGroup[^>]*open/);
    // The written file stays reachable outside the folded group.
    const group = html.indexOf("data-step-group");
    const groupEnd = html.indexOf("</details>", html.lastIndexOf("tool:write"));
    expect(html.indexOf("report.md", groupEnd)).toBeGreaterThan(group);
    // A step the reader opened keeps the group open after the turn ends.
    const opened = renderToStaticMarkup(
      <Timeline connected folds={{ "tool:list": true }} entries={entries} />,
    );
    expect(opened).toMatch(/<details[^>]*stepGroup[^>]*open/);
  });

  it("keeps a live turn's steps separate", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={[
          {
            id: "reasoning:1",
            kind: "reasoning",
            title: "Thinking",
            body: "Look",
            status: "complete",
            turnId: "turn-1",
          },
          {
            id: "tool:list",
            kind: "tool",
            title: "exec_command",
            body: "",
            status: "running",
            turnId: "turn-1",
          },
        ]}
      />,
    );
    expect(html).not.toContain("data-step-group");
  });

  it("renders the model's opening checklist as the turn plan", () => {
    const entry = {
      id: "assistant:plan",
      kind: "assistant" as const,
      title: "Octos",
      body: "Plan:\n- [x] Read the CSV\n- [ ] Write the clean copy\n\nStarting now.",
      status: "complete" as const,
      turnId: "turn-1",
    };
    const live = renderToStaticMarkup(
      <Timeline connected folds={{}} entries={[entry]} />,
    );
    expect(live).toMatch(/<details[^>]*planBlock[^>]*open/);
    expect(live).toContain("1 of 2 done");
    expect(live).toContain("Write the clean copy");
    expect(live).not.toContain("Plan:");
    const ended = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={[
          entry,
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            latestTurnOutcome: "completed",
          },
        ]}
      />,
    );
    expect(ended).not.toMatch(/<details[^>]*planBlock[^>]*open/);
    expect(ended).toContain("Turn ended");
    // One item was ticked, so progress is still meaningful.
    expect(ended).toContain("1 of 2 done");
  });

  it("counts an ended plan's items instead of reporting nothing done", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "assistant:plan",
            kind: "assistant",
            title: "Octos",
            body: "Plan:\n- [ ] Read\n- [ ] Write",
            status: "complete",
            turnId: "turn-1",
          },
          {
            id: "terminal:turn-1",
            kind: "system",
            title: "Turn complete",
            body: "",
            status: "complete",
            turnId: "turn-1",
            latestTurnOutcome: "completed",
          },
        ]}
      />,
    );
    expect(html).toContain("2 plan items");
    expect(html).not.toContain("0 of 2 done");
  });

  it("translates the client's own notices", async () => {
    const html = renderToStaticMarkup(
      <UiTextProvider language="zh" catalog={await loadChineseCatalog()}>
        <Timeline
          connected
          entries={[
            {
              id: "steer:turn-1",
              kind: "system",
              title: "Steering outcome unknown",
              body: "Transport changed before consumption could be confirmed. This text will not be resent automatically: 先别改测试",
              status: "error",
              turnId: "turn-1",
            },
            {
              id: "terminal:turn-1",
              kind: "system",
              title: "Turn complete",
              body: "",
              status: "complete",
              turnId: "turn-1",
              latestTurnOutcome: "completed",
            },
          ]}
        />
      </UiTextProvider>,
    );
    expect(html).toContain("插话结果未知");
    expect(html).toContain(
      "确认送达前连接发生了变化，这段话不会自动重发：先别改测试",
    );
    expect(html).toContain("本轮完成");
    expect(html).not.toContain("Turn complete");
  });

  it("Collapse all folds failed steps too", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        folds={collapseAll({})}
        entries={[
          {
            id: "tool:failed",
            kind: "tool",
            title: "write_file",
            body: "permission denied",
            toolArguments: '{"path":"report.md"}',
            status: "error",
            turnId: "turn-1",
          },
        ]}
      />,
    );
    expect(html).not.toMatch(/<details[^>]*open/);
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
