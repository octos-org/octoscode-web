import type { TimelineEntry } from "./model.ts";

interface TimelineProps {
  entries: readonly TimelineEntry[];
  connected: boolean;
}

export function Timeline({ entries, connected }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-mark">⌁</div>
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
    <div className="timeline" aria-live="polite">
      {entries.map((entry) => (
        <article
          className={`timeline-entry entry-${entry.kind}`}
          key={entry.id}
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
              <pre>{entry.body}</pre>
            ) : (
              <span className="muted">No output yet</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
