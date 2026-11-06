import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
import { timelineFromHydrate, type TimelineEntry } from "./model.ts";
import { AttachmentAccessContext } from "./attachment-access.ts";
import { loadChineseCatalog, UiTextProvider } from "../preferences/ui-text.tsx";

/** The opening `<details …>` tags whose attributes carry `marker`. */
function detailsTags(html: string, marker: string): string[] {
  return [...html.matchAll(/<details\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(marker));
}
const isOpen = (tag: string | undefined): boolean =>
  tag !== undefined && /\sopen=""/.test(tag);

const terminal = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: "terminal:turn-1",
  kind: "system",
  title: "Turn complete",
  body: "",
  status: "complete",
  turnId: "turn-1",
  latestTurnOutcome: "completed",
  ...overrides,
});

describe("Timeline", () => {
  it("offers a written file for download only when Core names it and the Session can read the workspace", () => {
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
    const render = (structured: boolean, readable: boolean) =>
      renderToStaticMarkup(
        <AttachmentAccessContext.Provider
          value={{ download: async () => new Blob() }}
        >
          <Timeline
            connected
            workspaceFileReadAvailable={readable}
            entries={hydrated(structured)}
          />
        </AttachmentAccessContext.Provider>,
      );
    const offered = render(true, true);
    expect(offered).toContain('data-attachment="report.md"');
    expect(offered).toContain("Download report.md");
    // A refreshed card whose preview was truncated names no file of its own.
    expect(render(false, true)).not.toContain('data-attachment="report.md"');
    // Without the workspace read capability there is nothing to download.
    expect(render(true, false)).not.toContain('data-attachment="report.md"');

    // A delivered file the Session cannot serve stays visible, but its
    // download is disabled rather than failing on click.
    const delivery = renderToStaticMarkup(
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
    expect(delivery).toContain("Here is the deck");
    expect(delivery).toMatch(/<button[^>]*disabled[^>]*>Download/);
  });

  it("keeps a completed turn's summary calm and never reads uncounted command changes as 0 files", () => {
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
          terminal({
            startedAtMs: 1000,
            endedAtMs: 4000,
            turnUsage: { input: 12, output: 9 },
          }),
        ]}
      />,
    );
    expect(html).toContain("Write file report.md");
    expect(html).toContain("permission denied");
    // A failure a later call recovered from reads as retried, not failed.
    expect(html).toContain("Retried automatically 1 times");
    expect(html).not.toContain("steps failed");
    expect(html).toContain('data-retried-steps="1"');
    expect(html).toContain('data-outcome="complete"');
    expect(html).toContain("Duration 3s");
    expect(html).toContain("12 tokens in · 9 tokens out");
    // The raw error is folded by default.
    expect(html).not.toMatch(/<details[^>]*open/);

    // A zero duration is dropped rather than shown.
    const instant = renderToStaticMarkup(
      <Timeline
        connected
        entries={[terminal({ startedAtMs: 5000, endedAtMs: 5000 })]}
      />,
    );
    expect(instant).not.toContain("Duration");
    expect(instant).toContain("0 files changed");

    // Core's command receipt is a floor (turn-summary.ts): a command's
    // changes are never summarised as "0 files".
    const command = (body: string) =>
      renderToStaticMarkup(
        <Timeline
          connected
          entries={[
            {
              id: "tool:1",
              kind: "tool",
              title: "exec_command",
              body,
              status: "complete",
              turnId: "turn-1",
            },
            terminal(),
          ]}
        />,
      );
    const zero = command("ok\nfiles_changed: 0\nscope: workdir");
    expect(zero).toContain("Changes not counted");
    expect(zero).not.toContain("0 files");
    expect(command("ok\nfiles_changed: 1\n  a.txt\nscope: workdir")).toContain(
      "1 files recorded; other changes not counted",
    );
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
          terminal({
            title: "Turn failed",
            body: "provider error",
            status: "error",
            latestTurnOutcome: "failed",
          }),
        ]}
      />,
    );
    expect(html).toContain("⚠ 1 steps failed");
    expect(html).toContain('data-outcome="failed"');
    expect(html).toContain("provider error");
  });

  it("folds a finished turn's steps into one group with its files outside, open where the reader opened a step; a live turn's steps stay separate", () => {
    const entries: TimelineEntry[] = [
      {
        id: "reasoning:1",
        kind: "reasoning",
        title: "Thinking",
        body: "Look at the folder",
        status: "complete",
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 1000,
      },
      {
        id: "tool:list",
        kind: "tool",
        title: "write_file",
        body: "Read-only file system",
        status: "error",
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 1000,
      },
      {
        id: "tool:write",
        kind: "tool",
        title: "write_file",
        body: "written",
        toolArguments: '{"path":"report.md"}',
        status: "complete",
        turnId: "turn-1",
        artifactPath: "/work/report.md",
        startedAtMs: 1000,
        endedAtMs: 6000,
      },
      terminal(),
    ];
    const html = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={entries}
        workspaceFileReadAvailable
      />,
    );
    const group = detailsTags(html, 'data-step-group="steps:reasoning:1"');
    expect(group).toHaveLength(1);
    expect(isOpen(group[0])).toBe(false);
    expect(html).toMatch(/Ran 2 steps<\/strong><span[^>]*>5 s</);
    expect(html).toContain("Retried automatically 1 times");
    // The written file stays reachable outside the folded group.
    const groupStart = html.indexOf("data-step-group");
    const groupEnd = html.indexOf("</details>", html.lastIndexOf("tool:write"));
    expect(html.indexOf("report.md", groupEnd)).toBeGreaterThan(groupStart);
    // A step the reader opened keeps the group open after the turn ends.
    const opened = renderToStaticMarkup(
      <Timeline connected folds={{ "tool:list": true }} entries={entries} />,
    );
    expect(isOpen(detailsTags(opened, "data-step-group")[0])).toBe(true);

    // While the turn is live, nothing is grouped yet.
    const live = renderToStaticMarkup(
      <Timeline
        connected
        folds={{}}
        entries={[
          { ...entries[0]!, body: "Look" },
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
    expect(live).not.toContain("data-step-group");
  });

  it("renders the model's opening checklist as the turn plan, open while live and counted once ended", () => {
    const entry: TimelineEntry = {
      id: "assistant:plan",
      kind: "assistant",
      title: "Octos",
      body: "Plan:\n- [x] Read the CSV\n- [ ] Write the clean copy\n\nStarting now.",
      status: "complete",
      turnId: "turn-1",
    };
    const live = renderToStaticMarkup(
      <Timeline connected folds={{}} entries={[entry]} />,
    );
    expect(isOpen(detailsTags(live, "data-plan-block")[0])).toBe(true);
    expect(live).toContain("1 of 2 done");
    expect(live).toContain("Write the clean copy");
    expect(live).not.toContain("Plan:");
    const ended = renderToStaticMarkup(
      <Timeline connected folds={{}} entries={[entry, terminal()]} />,
    );
    expect(detailsTags(ended, "data-plan-block")).toHaveLength(1);
    expect(isOpen(detailsTags(ended, "data-plan-block")[0])).toBe(false);
    expect(ended).toContain("Turn ended");
    // One item was ticked, so progress is still meaningful.
    expect(ended).toContain("1 of 2 done");
    // Nothing ticked: the ended plan counts its items instead of "0 done".
    const unticked = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          { ...entry, body: "Plan:\n- [ ] Read\n- [ ] Write" },
          terminal(),
        ]}
      />,
    );
    expect(unticked).toContain("2 plan items");
    expect(unticked).not.toContain("0 of 2 done");
  });

  it("translates the client's own notices but keeps a durable message's role verbatim", async () => {
    // A hydrated message whose role is not user/assistant/tool is a system
    // row titled with that role: server data, so "system" must not become
    // the catalog's theme label 「跟随系统」 (T-0460). Only zh can show it.
    const hydrated = timelineFromHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 1 },
      messages: [
        {
          seq: 1,
          role: "system",
          content: "Hydrated notice",
          turn_id: "turn-1",
          message_id: "message-system",
          persisted_at: "",
          media: [],
        },
      ],
    });
    const html = renderToStaticMarkup(
      <UiTextProvider language="zh" catalog={await loadChineseCatalog()}>
        <Timeline
          connected
          entries={[
            ...hydrated,
            {
              id: "steer:turn-1",
              kind: "system",
              title: "Steering outcome unknown",
              body: "Transport changed before consumption could be confirmed. This text will not be resent automatically: 先别改测试",
              status: "error",
              turnId: "turn-1",
            },
            terminal(),
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
    expect(html).toContain("Hydrated notice");
    expect(html).toContain("<strong>system</strong>");
    expect(html).not.toContain("跟随系统");
  });
});
