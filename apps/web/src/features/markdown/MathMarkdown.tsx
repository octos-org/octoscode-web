/**
 * The math-capable renderer: plain markdown plus `$…$` / `$$…$$` / `\(…\)`
 * through KaTeX. Split out of MarkdownBody so the KaTeX stylesheet, fonts and
 * plugin code stay out of the transcript chunk every session loads.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { markdownComponents, safeUrlTransform } from "./MarkdownBody.tsx";

export function MathMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        // Model-authored text is untrusted: never expand \\href or \\url, and
        // render an invalid expression as its source instead of throwing away
        // the whole message.
        [rehypeKatex, { trust: false, strict: false, throwOnError: false }],
      ]}
      components={markdownComponents}
      urlTransform={safeUrlTransform}
    >
      {text}
    </ReactMarkdown>
  );
}
