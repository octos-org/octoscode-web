import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeBlock } from "./CodeBlock.tsx";
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
  });

  it("renders fenced code with DSH-style chrome and Shiki tokens", () => {
    const html = renderToStaticMarkup(
      <CodeBlock code="const answer: number = 42" language="ts" />,
    );

    expect(html).toContain('class="md-code-block"');
    expect(html).toContain("Copy code block");
    expect(html).toContain('class="shiki css-variables"');
    expect(html).toContain(">const</span>");
    expect(html).toContain("> answer</span>");
  });

  it("keeps a growing stream plain until the canonical persisted row", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody text="**still streaming" streaming />,
    );

    expect(html).toContain('class="md-streaming"');
    expect(html).toContain("**still streaming");
    expect(html).not.toContain("<strong>");
  });
});
