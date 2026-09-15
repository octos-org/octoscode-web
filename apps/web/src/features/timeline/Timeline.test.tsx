import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";

describe("Timeline", () => {
  it("uses the shared Octos mark in the connected conversation empty state", () => {
    const html = renderToStaticMarkup(<Timeline entries={[]} connected />);

    expect(html).toContain("Ask Octos to work on this repository");
    expect(html).toContain('data-octopus-logo=""');
    expect(html).not.toContain("⌁");
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

  it("keeps live thinking and tools compact with native reader-controlled disclosures", () => {
    const html = renderToStaticMarkup(
      <Timeline
        connected
        entries={[
          {
            id: "reasoning",
            kind: "reasoning",
            title: "Reasoning",
            body: "Inspecting README",
            status: "running",
          },
          {
            id: "tool",
            kind: "tool",
            title: "read_file",
            body: "file contents",
            status: "running",
          },
        ]}
      />,
    );
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).toContain("Thinking…");
    expect(html).toContain("Running");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toContain("chars");
  });
});
