/*
 * Adapted from DeepSeek Harness ui-primitives/CodeBlock.tsx.
 * Source revision: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
 * Copyright (c) 2026 DeepSeek. Licensed under the MIT License.
 * See THIRD_PARTY_NOTICES.md.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  grammarLoadCount,
  highlightToHtml,
  subscribeGrammarLoaded,
} from "./highlight.ts";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code;
  const loaded = useSyncExternalStore(
    subscribeGrammarLoaded,
    grammarLoadCount,
    grammarLoadCount,
  );
  const html = useMemo(
    () => highlightToHtml(trimmed, language),
    [trimmed, language, loaded],
  );
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copy = () => {
    if (copied) return;
    void navigator.clipboard.writeText(trimmed).then(() => {
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setCopied(false);
      }, 1_000);
    });
  };

  return (
    <div className="md-code-block">
      <div className="md-code-banner">
        <span>{language ?? "text"}</span>
        <button type="button" onClick={copy} aria-label="Copy code block">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="md-code-plain">
          <code>{trimmed}</code>
        </pre>
      )}
    </div>
  );
}
