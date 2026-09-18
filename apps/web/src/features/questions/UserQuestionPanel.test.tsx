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

describe("UserQuestionPanel card", () => {
  const request = {
    sessionId: "s1",
    questionId: "q1",
    turnId: "t1",
    title: "Choose verification depth",
    body: "Octos needs one product decision.",
    questions: [
      {
        header: "Checks",
        question: "Which checks should run?",
        options: [
          { label: "Fast", description: "Unit tests only" },
          { label: "Full", description: "All product gates" },
        ],
        multiSelect: false,
        allowFreeText: true,
      },
    ],
  };

  function render(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      <UserQuestionPanel
        request={request}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("keeps the identifiers the dialog, group and radio names are built from", () => {
    const html = render();
    // The dialog's accessible name comes from this element; the group's from
    // the legend's header + question, and nothing else.
    expect(html).toContain('id="question-title"');
    expect(html).toMatch(
      /<legend[^>]*><span>Checks<\/span>Which checks should run\?<\/legend>/,
    );
    expect(html).toContain('name="q1:0"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('placeholder="Type another answer"');
  });

  it("says how the choices behave and offers a visible written answer", () => {
    const html = render();
    expect(html).toContain("Choose one, or write your own");
    expect(html).toContain("Other");
  });

  it("explains a disabled primary action and describes the button by it", () => {
    const html = render();
    expect(html).toContain("Choose an option to continue");
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${described}"`);
    // The button's accessible NAME stays the bare label.
    expect(html).toContain(">Continue</button>");
  });

  it("reports a pending send instead of a missing answer while busy", () => {
    const html = render({ busy: true });
    expect(html).toContain("Sending your answer…");
    expect(html).toContain(">Sending…</button>");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Choose an option to continue");
  });

  it("keeps the primary action last, after the error and every choice", () => {
    const html = render({ error: "Fixture response failed; please retry." });
    expect(html.indexOf("Fixture response failed")).toBeLessThan(
      html.indexOf("<button"),
    );
    expect(html.indexOf('type="radio"')).toBeLessThan(html.indexOf("<button"));
    expect(html.indexOf('placeholder="Type another answer"')).toBeLessThan(
      html.indexOf("<button"),
    );
    expect(html.lastIndexOf("<button")).toBe(html.indexOf("<button"));
  });
});
