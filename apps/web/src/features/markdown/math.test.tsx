import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasMath } from "./math.ts";
import { MathMarkdown } from "./MathMarkdown.tsx";

describe("math detection", () => {
  it("recognises the delimiters remark-math understands", () => {
    expect(hasMath("inline $E = mc^2$ here")).toBe(true);
    expect(hasMath("block:\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n")).toBe(
      true,
    );
    expect(hasMath("across\n$$\na^2 + b^2 = c^2\n$$\nlines")).toBe(true);
    expect(hasMath("latex \\(x + y\\) form")).toBe(true);
    expect(hasMath("display \\[x + y\\] form")).toBe(true);
  });

  it("leaves ordinary prose, money and shell text alone", () => {
    expect(hasMath("a plain summary of the change")).toBe(false);
    expect(hasMath("it costs $12 and $1,000.50 more")).toBe(false);
    expect(hasMath("run `echo $PATH` then `cd $HOME`")).toBe(false);
    expect(hasMath("an escaped \\$price\\$ stays text")).toBe(false);
    expect(hasMath("a lone $ sign")).toBe(false);
  });
});

describe("MathMarkdown", () => {
  it("renders inline math through KaTeX", () => {
    const html = renderToStaticMarkup(
      <MathMarkdown text={"Energy $E = mc^2$ powers it."} />,
    );

    expect(html).toContain("katex");
    expect(html).not.toContain("katex-display");
    expect(html).not.toContain("$E = mc^2$");
  });

  it("renders fenced display math as a block", () => {
    // remark-math treats `$$` on their own lines as display math; a one-line
    // `$$…$$` stays inline, and both must still reach KaTeX.
    const display = renderToStaticMarkup(
      <MathMarkdown text={"before\n\n$$\na^2 + b^2 = c^2\n$$\n\nafter"} />,
    );
    expect(display).toContain("katex-display");

    const oneLine = renderToStaticMarkup(
      <MathMarkdown text={"$$\\int_0^1 x^2 dx = \\frac{1}{3}$$"} />,
    );
    expect(oneLine).toContain("katex");
    // KaTeX keeps the source in a MathML annotation, so assert the delimiters
    // are consumed rather than the LaTeX being absent.
    expect(oneLine).not.toContain("$$");
  });

  it("keeps GFM tables, links and code alongside math", () => {
    const html = renderToStaticMarkup(
      <MathMarkdown
        text={[
          "| term | value |",
          "| --- | --- |",
          "| ratio | $1/3$ |",
          "",
          "See [docs](https://example.com) and `inline code`.",
        ].join("\n")}
      />,
    );

    expect(html).toContain('<div class="md-table-scroll"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain("katex");
  });

  it("renders an invalid expression as text instead of losing the message", () => {
    const html = renderToStaticMarkup(
      <MathMarkdown text={"before $\\notacommand{x}$ after"} />,
    );

    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});
