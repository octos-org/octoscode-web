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
});
