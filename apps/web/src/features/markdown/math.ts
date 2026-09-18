/**
 * Math is rare in a coding transcript and KaTeX (plus its fonts and
 * stylesheet) is large, so a message pays for it only when it actually
 * carries math. `hasMath` decides that, and MarkdownBody swaps in the
 * math-capable renderer behind Suspense when it returns true.
 */

/**
 * Delimiters remark-math understands, minus the ones that would fire on
 * ordinary prose:
 *  - `$$…$$` display math, on one line or across lines
 *  - `$…$` inline math on a single line, where the closing `$` is not escaped
 *    and the content is neither empty nor a plain currency amount
 *  - `\(…\)` and `\[…\]` LaTeX delimiters
 */
const DISPLAY = /\$\$[\s\S]+?\$\$/;
const INLINE = /(?<![\\$])\$(?!\s)([^$\n]{1,200})(?<![\\\s])\$(?!\$)/;
const LATEX = /\\\((?:[\s\S]{1,400}?)\\\)|\\\[(?:[\s\S]{1,400}?)\\\]/;

/** A bare amount like `$12` or `$1,000.50` is money, not math. */
const CURRENCY_ONLY = /^[\s,.\d]+$/;

export function hasMath(text: string): boolean {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) {
    return false;
  }
  if (DISPLAY.test(text) || LATEX.test(text)) return true;
  const inline = INLINE.exec(text);
  return inline !== null && !CURRENCY_ONLY.test(inline[1] ?? "");
}
