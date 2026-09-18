import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody.tsx";

describe("MarkdownBody", () => {
  it("renders settled GFM and keeps raw HTML inert", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody
        text={[
          "## Result",
          "",
          "- [x] tests pass",
          "",
          "| file | state |",
          "| --- | --- |",
          "| `src/app.ts` | changed |",
          "",
          "<script>alert('no')</script>",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-label="Completed task"');
    expect(html).toContain('class="md-table-scroll"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("allows only absolute safe links", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody text="[safe](https://example.com) [relative](/secret) [script](javascript:alert(1)) ![mail](mailto:person@example.com)" />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain('href="/secret"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('src="mailto:');
    expect(html).not.toContain("<img");
  });

  it("never formats a marker the model has not closed yet", () => {
    // Mid-stream, `**` has been written but its closer has not: it must stay
    // literal rather than turning the rest of the reply bold.
    const html = renderToStaticMarkup(
      <MarkdownBody text="**still streaming" streaming />,
    );

    expect(html).toContain("**still streaming");
    expect(html).not.toContain("<strong>");
  });

  it("renders markdown while the reply is still streaming", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody
        text={
          "# Plan\n\n- read the file\n- **fix** it\n\n| a | b |\n| - | - |\n| 1 | 2 |"
        }
        streaming
      />,
    );

    expect(html).toContain('class="markdown-body"');
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain("<li>read the file</li>");
    expect(html).toContain("<strong>fix</strong>");
    expect(html).toContain("<table>");
  });

  it("shows an unfinished code block as code, unhighlighted, while streaming", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody text={"Here:\n\n```ts\nconst x = 1;"} streaming />,
    );

    // The open fence is closed for display, so the block renders as code
    // rather than as a raw "```ts" line...
    expect(html).toContain('class="md-code-plain"');
    expect(html).toContain("const x = 1;");
    expect(html).not.toContain("```");
  });
});
