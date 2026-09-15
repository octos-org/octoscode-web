import { lazy, memo, Suspense, useLayoutEffect, useRef, useState } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { CheckIcon, ChevronDownIcon } from "../../ui/Icon.tsx";
import styles from "./Timeline.module.css";
import type { TimelineEntry } from "./model.ts";

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody.tsx").then((module) => ({
    default: module.MarkdownBody,
  })),
);

interface TimelineProps {
  entries: readonly TimelineEntry[];
  connected: boolean;
}

export function Timeline({ entries, connected }: TimelineProps) {
  const visibleEntries = entries.filter(
    (entry) => entry.kind !== "assistant" || entry.body.trim(),
  );
  // Keep the server-provided projection intact; only bound the initial DOM.
  // Anchoring by identity prevents incoming messages evicting a reader's row.
  const [firstVisibleId, setFirstVisibleId] = useState<string | null>(null);
  const knownIndex = visibleEntries.findIndex(
    (entry) => entry.id === firstVisibleId,
  );
  const startIndex =
    knownIndex < 0 ? Math.max(0, visibleEntries.length - 200) : knownIndex;
  const timelineRef = useRef<HTMLDivElement>(null);
  const revealAnchor = useRef<{ element: Element; top: number } | null>(null);
  useLayoutEffect(() => {
    if (knownIndex < 0 && visibleEntries[startIndex]) {
      setFirstVisibleId(visibleEntries[startIndex]!.id);
    }
    const anchor = revealAnchor.current;
    const scroll = timelineRef.current?.closest(".conversation-scroll");
    if (anchor && scroll) {
      scroll.scrollTop +=
        anchor.element.getBoundingClientRect().top - anchor.top;
      revealAnchor.current = null;
    }
  });
  if (visibleEntries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-mark">
          <OctopusLogo size={28} />
        </div>
        <span className="eyebrow">Coding workspace</span>
        <h2>
          {connected
            ? "Ask Octos to work on this repository"
            : "Connect an Octos server"}
        </h2>
        <p>
          {connected
            ? "Describe a change, investigate a bug, or ask how the code works."
            : "Connect to your server to open a repository and start working."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={timelineRef}
      className={`timeline ${styles.timeline}`}
      role="log"
      aria-label="Conversation timeline"
    >
      {startIndex > 0 ? (
        <button
          type="button"
          className={styles.earlierButton}
          onClick={() => {
            const first = timelineRef.current?.children[1];
            if (first)
              revealAnchor.current = {
                element: first,
                top: first.getBoundingClientRect().top,
              };
            setFirstVisibleId(
              visibleEntries[Math.max(0, startIndex - 100)]!.id,
            );
          }}
        >
          Show {Math.min(startIndex, 100)} earlier messages
        </button>
      ) : null}
      {visibleEntries.slice(startIndex).map((entry) => (
        <TimelineEntryView key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

/**
 * Memo boundary: folding produces new objects only for entries that changed,
 * so a streaming delta re-renders a single entry instead of re-evaluating
 * markdown for the whole timeline.
 */
const TimelineEntryView = memo(function TimelineEntryView({
  entry,
}: {
  entry: TimelineEntry;
}) {
  switch (entry.kind) {
    case "reasoning":
      return <ReasoningBlock entry={entry} />;
    case "tool":
      return <ToolBlock entry={entry} />;
    default:
      return <DefaultEntry entry={entry} />;
  }
});

/** Disclosure state belongs to the reader, so completion never closes it. */
function ReasoningBlock({ entry }: { entry: TimelineEntry }) {
  const running = entry.status === "running";
  return (
    <details
      className={`${styles.reasoningBlock}${running ? ` ${styles.reasoningBlockLive}` : ""}`}
      data-live={running}
    >
      <summary className={styles.reasoningHeader}>
        <ActivityGlyph status={entry.status} />
        <strong>{running ? "Thinking…" : "Thought process"}</strong>
        <ChevronDownIcon className={styles.chevron} />
      </summary>
      <div className={styles.reasoningBody}>
        {entry.body ? (
          <pre className={styles.thinkingText}>{entry.body}</pre>
        ) : (
          <span className="muted">…</span>
        )}
      </div>
    </details>
  );
}

/** Tool details stay available without pushing the response down as output arrives. */
function ToolBlock({ entry }: { entry: TimelineEntry }) {
  const running = entry.status === "running";
  return (
    <details
      className={`${styles.toolBlock}${running ? ` ${styles.toolBlockLive}` : ""}`}
      data-live={running}
    >
      <summary className={styles.toolHeader}>
        <ActivityGlyph status={entry.status} />
        <strong>{entry.title}</strong>
        {running ? (
          <span className={styles.runningLabel}>Running</span>
        ) : (
          <span className={styles.toolStatusLabel} data-status={entry.status}>
            {entry.statusLabel ??
              (entry.status === "complete"
                ? "Done"
                : entry.status === "error"
                  ? "Failed"
                  : "Finished")}
          </span>
        )}
        <ChevronDownIcon className={styles.chevron} />
      </summary>
      <div className={styles.toolBody}>
        {entry.body ? (
          <pre className={styles.toolOutput}>{entry.body}</pre>
        ) : (
          <span className="muted">
            {running
              ? "Waiting for tool output…"
              : "Finished without text output."}
          </span>
        )}
      </div>
    </details>
  );
}

function ActivityGlyph({ status }: { status: TimelineEntry["status"] }) {
  return status === "complete" ? (
    <CheckIcon size={14} className={styles.completedGlyph} />
  ) : (
    <span
      className={styles.statusGlyph}
      data-status={status}
      aria-hidden="true"
    />
  );
}

/** Assistant and user messages: full markdown rendering. */
function DefaultEntry({ entry }: { entry: TimelineEntry }) {
  return (
    <article
      className={`timeline-entry entry-${entry.kind}${entry.kind === "assistant" ? ` ${styles.assistantEntry}` : ""}`}
    >
      <div className="entry-rail">
        <span className={`entry-glyph glyph-${entry.status}`} />
      </div>
      <div className="entry-content">
        <div className="entry-heading">
          <strong>{entry.title}</strong>
          {entry.status === "running" ? (
            <span className="running-label">running</span>
          ) : null}
        </div>
        {entry.body ? (
          entry.kind === "assistant" ? (
            <Suspense fallback={<pre>{entry.body}</pre>}>
              <MarkdownBody
                text={entry.body}
                streaming={entry.status === "running"}
              />
            </Suspense>
          ) : (
            <pre>{entry.body}</pre>
          )
        ) : null}
      </div>
    </article>
  );
}
