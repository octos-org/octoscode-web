import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BtwAsidePanel } from "./BtwAsidePanel.tsx";
import type { BtwAsideSnapshot } from "./lazy-btw-controller.ts";

function render(snapshot: BtwAsideSnapshot | null) {
  return renderToStaticMarkup(
    <BtwAsidePanel
      controller={{
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        dismiss: () => true,
      }}
    />,
  );
}
const pending: BtwAsideSnapshot = {
  requestId: 1,
  question: "What is happening?",
  state: "answering",
  answer: null,
  model: null,
  error: null,
};

describe("ephemeral aside reading surface", () => {
  it("renders nothing after dismissal", () => expect(render(null)).toBe(""));
  it("announces answering without a blocking modal or timeline entry", () => {
    const html = render(pending);
    expect(html).toContain("Aside — /btw");
    expect(html).toContain('role="status"');
    expect(html).toContain("Answering…");
    expect(html).toContain("Dismiss aside");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("entry-assistant");
  });
  it("renders answer Markdown with raw HTML inert and explicit ephemeral ownership", () => {
    const html = render({
      ...pending,
      state: "answered",
      answer: "**Answer**\n\n<script>bad()</script>",
    });
    expect(html).toContain("<strong>Answer</strong>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("not saved to the conversation");
  });
  it("renders failure as an alert without a fabricated answer", () => {
    const html = render({
      ...pending,
      state: "failed",
      error: "The aside could not be answered.",
    });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("markdown-body");
  });
});
