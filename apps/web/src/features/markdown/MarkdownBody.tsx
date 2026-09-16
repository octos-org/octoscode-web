import { lazy, Suspense } from "react";
import { hasMath } from "./math.ts";
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

/** KaTeX and its fonts load only for a message that actually carries math. */
const MathMarkdown = lazy(() =>
  import("./MathMarkdown.tsx").then((module) => ({
    default: module.MathMarkdown,
  })),
);

function PlainMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={markdownComponents}
      urlTransform={safeUrlTransform}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MarkdownBody({ text, streaming = false }: MarkdownBodyProps) {
  if (streaming) return <pre className="md-streaming">{text}</pre>;
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
