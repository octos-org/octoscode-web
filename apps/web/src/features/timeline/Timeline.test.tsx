import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline.tsx";

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
