import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";
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
