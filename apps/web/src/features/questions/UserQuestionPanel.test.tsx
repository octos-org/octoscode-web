import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UserQuestionPanel } from "./UserQuestionPanel.tsx";

describe("UserQuestionPanel", () => {
  it("renders structured options and the server-authorized free-text escape", () => {
    const html = renderToStaticMarkup(
      <UserQuestionPanel
        request={{
          sessionId: "s1",
          questionId: "q1",
          turnId: "t1",
          title: "Choose checks",
          body: "Select the validation depth.",
          questions: [
            {
              header: "Checks",
              question: "Which checks?",
              options: [
                { label: "Fast", description: "Unit tests" },
                { label: "Full", description: "All checks" },
              ],
              multiSelect: false,
              allowFreeText: true,
            },
          ],
        }}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(html).toContain("Choose checks");
    expect(html).toContain("Fast");
    expect(html).toContain("Full");
    expect(html).toContain("Other");
    expect(html).toContain('type="radio"');
  });

  it("does not claim Esc can stop when turn/interrupt is unavailable", () => {
    const html = renderToStaticMarkup(
      <UserQuestionPanel
        request={{
          sessionId: "s1",
          questionId: "q1",
          turnId: "t1",
          title: "Choose",
          body: "Choose one.",
          questions: [
            {
              header: "Choice",
              question: "Continue?",
              options: [{ label: "Yes", description: "Continue" }],
              multiSelect: false,
              allowFreeText: false,
            },
          ],
        }}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).not.toContain("Esc stops the active turn");
  });
});
