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
  isGrammarLoaded,
  highlightToHtml,
  subscribeGrammarLoaded,
} from "./highlight.ts";
import { useUiText } from "../preferences/ui-text.tsx";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const t = useUiText();
  const blockRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const block = blockRef.current!;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: block.closest(".conversation-scroll"), rootMargin: "200px 0px" },
    );
    observer.observe(block);
    return () => observer.disconnect();
  }, []);
  const trimmed = code.endsWith("\n") ? code.slice(0, -1) : code;
  const loaded = useSyncExternalStore(
    subscribeGrammarLoaded,
    () => isGrammarLoaded(language),
    () => false,
  );
  const html = useMemo(
    () => (visible ? highlightToHtml(trimmed, language) : undefined),
    [trimmed, language, loaded, visible],
  );
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copy = async () => {
    if (copied || copying) return;
    setCopying(true);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setCopied(false);
      }, 1_000);
    } catch {
      setCopyError(true);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div ref={blockRef} className="md-code-block">
      <div className="md-code-banner">
        <span>{language ?? t("text")}</span>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={copying}
          aria-label={t("Copy code block")}
        >
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      {copyError ? (
        <div className="md-copy-error" role="alert">
          {t("Could not copy. Select the code to copy it, or try again.")}
        </div>
      ) : null}
      <pre
        className={
          html ? "shiki shiki-bg shiki-color-foreground" : "md-code-plain"
        }
        tabIndex={0}
      >
        {html ? (
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{trimmed}</code>
        )}
      </pre>
    </div>
  );
}
