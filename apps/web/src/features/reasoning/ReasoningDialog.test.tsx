import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReasoningDialog } from "./ReasoningDialog.tsx";
import { reasoningEffort } from "./model.ts";

describe("session thinking candidate", () => {
  it("keeps visibility independent of model effort and write capability", () => {
    const html = renderToStaticMarkup(
      <ReasoningDialog
        sessionId="p:local:tui#A"
        value="high"
        disabled={true}
        showReasoning={false}
        onShowReasoningChange={() => undefined}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain("Show reasoning in this Session");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="checkbox" disabled');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('value="high" selected=""');
  });
  it("accepts only the Core wire vocabulary and treats null as no override", () => {
    expect(["low", "medium", "high", "max"].map(reasoningEffort)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(reasoningEffort(null)).toBeUndefined();
    expect(reasoningEffort("ultra")).toBeUndefined();
    expect(reasoningEffort(100000)).toBeUndefined();
  });
  it("projects an owner-bound choice and explains queued-turn capture", () => {
    const html = renderToStaticMarkup(
      <ReasoningDialog
        sessionId="p:local:tui#A"
        value="high"
        disabled={false}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain("p:local:tui#A");
    expect(html).toContain("already queued prompts");
    expect(html).toContain("Profile default");
  });
});
