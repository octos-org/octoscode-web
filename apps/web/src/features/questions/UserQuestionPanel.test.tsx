import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UserQuestionPanel } from "./UserQuestionPanel.tsx";

describe("UserQuestionPanel", () => {
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
