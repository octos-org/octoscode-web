import { lazy, memo, Suspense } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
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
  if (entries.length === 0) {
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
            ? "Streaming messages, tool activity, and durable projection events will appear here."
            : "This Web client keeps the agent, tools, and sandbox on the server where they belong."}
        </p>
      </div>
    );
  }

  return (
    <div className="timeline" role="log" aria-label="Conversation timeline">
      {entries.map((entry) => (
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

/** Collapsible thinking block — streams open, auto-collapses on settle. */
function ReasoningBlock({ entry }: { entry: TimelineEntry }) {
  const running = entry.status === "running";
  return (
    <details
      className={`${styles.reasoningBlock}${running ? ` ${styles.reasoningBlockLive}` : ""}`}
      data-live={running}
      open={running}
    >
      <summary className={styles.reasoningHeader}>
        <span className={`entry-glyph glyph-${entry.status}`} />
        <strong>{running ? "Thinking…" : "Thought"}</strong>
        {!running ? (
          <span className={styles.reasoningMeta}>
            {entry.body.length > 0 ? `${entry.body.length} chars` : ""}
          </span>
        ) : null}
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

/** Collapsible tool card — streams output while running, collapses after. */
function ToolBlock({ entry }: { entry: TimelineEntry }) {
  const running = entry.status === "running";
  return (
    <details
      className={`${styles.toolBlock}${running ? ` ${styles.toolBlockLive}` : ""}`}
      data-live={running}
      open={running}
    >
      <summary className={styles.toolHeader}>
        <span className={`entry-glyph glyph-${entry.status}`} />
        <strong>{entry.title}</strong>
        {running ? (
          <span className={styles.runningLabel}>running</span>
        ) : (
          <span className={styles.toolStatusLabel} data-status={entry.status}>
            {entry.status}
          </span>
        )}
      </summary>
      <div className={styles.toolBody}>
        {entry.body ? (
          <pre className={styles.toolOutput}>{entry.body}</pre>
        ) : (
          <span className="muted">No output yet</span>
        )}
      </div>
    </details>
  );
}

/** Assistant and user messages: full markdown rendering. */
function DefaultEntry({ entry }: { entry: TimelineEntry }) {
  return (
    <article className={`timeline-entry entry-${entry.kind}`}>
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
        ) : (
          <span className="muted">No output yet</span>
        )}
      </div>
    </article>
  );
}
