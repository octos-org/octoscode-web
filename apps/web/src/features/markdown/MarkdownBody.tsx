import { lazy, Suspense, useDeferredValue } from "react";
import { hasMath } from "./math.ts";
import { closeOpenFence } from "./streaming-fence.ts";
import ReactMarkdown, {
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

const CodeBlock = lazy(() =>
  import("./CodeBlock.tsx").then((module) => ({ default: module.CodeBlock })),
);

interface MarkdownBodyProps {
  text: string;
  streaming?: boolean;
}

export const safeUrlTransform: UrlTransform = (url, key) => {
  try {
    const protocol = new URL(url).protocol;
    if (key === "src") {
      // Model-authored remote images would make a credential-bearing browser
      // leak its IP and request timing without a user gesture. Keep alt text;
      // links remain explicit, user-initiated navigation.
      return "";
    }
    return protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:"
      ? url
      : "";
  } catch {
    return "";
  }
};

export const markdownComponents: Components = {
  a({ href, children }) {
    if (!href) return <>{children}</>;
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    if (!src) return <span className="md-image-alt">{alt ?? "Image"}</span>;
    return <img src={src} alt={alt ?? ""} loading="lazy" />;
  },
  input({ type, checked, ...props }) {
    if (type !== "checkbox") return <input type={type} {...props} />;
    return (
      <input
        type="checkbox"
        checked={checked}
        {...props}
        aria-label={checked ? "Completed task" : "Incomplete task"}
      />
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
    const value = String(children);
    if (language || value.includes("\n")) {
      return (
        <Suspense
          fallback={
            <pre className="md-code-plain">
              <code>{value}</code>
            </pre>
          }
        >
          <CodeBlock code={value} {...(language ? { language } : {})} />
        </Suspense>
      );
    }
    return <code>{children}</code>;
  },
  table({ children }) {
    return (
      <div className="md-table-scroll" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
};

/**
 * The components used while a reply is still streaming. Identical, except that
 * a code block renders as the plain block `CodeBlock` shows while loading, not
 * the syntax-highlighted one: highlighting re-tokenises the whole block, and
 * doing that on every streamed token is the expensive part of live rendering.
 * The finished reply is highlighted once, when the turn completes.
 */
const streamingComponents: Components = {
  ...markdownComponents,
  code({ className, children }) {
    const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
    const value = String(children);
    if (language || value.includes("\n")) {
      return (
        <pre className="md-code-plain">
          <code>{value}</code>
        </pre>
      );
    }
    return <code>{children}</code>;
  },
};

/** KaTeX and its fonts load only for a message that actually carries math. */
const MathMarkdown = lazy(() =>
  import("./MathMarkdown.tsx").then((module) => ({
    default: module.MathMarkdown,
  })),
);

function PlainMarkdown({
  text,
  components = markdownComponents,
}: {
  text: string;
  components?: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
      urlTransform={safeUrlTransform}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MarkdownBody({ text, streaming = false }: MarkdownBodyProps) {
  // Reparsing on every token would compete with the stream itself. A deferred
  // value lets React render the markdown at low priority and skip stale
  // intermediate texts, so a long reply keeps flowing while it formats.
  const deferredText = useDeferredValue(text);
  if (streaming) {
    // Rendered as markdown as it arrives, not held back as raw text until the
    // turn ends. Two things wait for the finished reply: math, since a
    // half-written `$…` cannot be typeset, and syntax highlighting (see
    // streamingComponents). An unclosed inline marker such as `**` stays
    // literal until its closer arrives, as CommonMark specifies, so nothing is
    // formatted before the model has actually written it.
    return (
      <div className="markdown-body">
        <PlainMarkdown
          text={closeOpenFence(deferredText)}
          components={streamingComponents}
        />
      </div>
    );
  }
  return (
    <div className="markdown-body">
      {hasMath(text) ? (
        // Until the math chunk resolves the same text renders unformatted
        // rather than blank, so a reply is never briefly missing.
        <Suspense fallback={<PlainMarkdown text={text} />}>
          <MathMarkdown text={text} />
        </Suspense>
      ) : (
        <PlainMarkdown text={text} />
      )}
    </div>
  );
}
