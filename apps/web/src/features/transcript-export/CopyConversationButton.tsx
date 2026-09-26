import { useEffect, useRef, useState } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import { errorMessage } from "../../shared/errors.ts";
import {
  copyConversationMarkdown,
  type ConversationCopySource,
} from "./copy-conversation.ts";

type CopyPhase = "idle" | "copying" | "copied" | "empty" | "error";

const LABELS: Record<CopyPhase, string> = {
  idle: "Copy as Markdown",
  copying: "Copying…",
  copied: "Copied",
  empty: "Nothing to copy",
  error: "Copy failed",
};

/** How long a finished copy keeps its result label before resetting. */
const RESULT_MS = 2500;

/**
 * Header action: copy the open Session's conversation as Markdown. Mount it
 * keyed by Session so a result from one Session never shows on another.
 */
export function CopyConversationButton({
  source,
  className,
}: {
  source: ConversationCopySource;
  className: string;
}) {
  const t = useUiText();
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const requestRef = useRef(0);
  useEffect(() => {
    return () => {
      requestRef.current += 1;
    };
  }, []);
  useEffect(() => {
    if (phase === "idle" || phase === "copying") return;
    const timer = setTimeout(() => setPhase("idle"), RESULT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const copy = () => {
    const requestId = ++requestRef.current;
    setPhase("copying");
    setDetail(null);
    // Not awaited before calling: the clipboard write must start inside the
    // click (see copyConversationMarkdown).
    copyConversationMarkdown(source, navigator.clipboard).then(
      (outcome) => {
        if (requestRef.current === requestId)
          setPhase(outcome === "copied" ? "copied" : "empty");
      },
      (reason: unknown) => {
        if (requestRef.current !== requestId) return;
        setDetail(errorMessage(reason));
        setPhase("error");
      },
    );
  };

  const label = t(LABELS[phase]);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={phase === "copying"}
        title={detail ?? t("Copy this conversation as Markdown")}
        data-copy-conversation={phase}
        onClick={copy}
      >
        {label}
      </button>
      <span className="sr-only" role="status">
        {phase === "copied"
          ? t("Conversation copied as Markdown.")
          : phase === "empty" || phase === "error"
            ? label
            : ""}
      </span>
    </>
  );
}
