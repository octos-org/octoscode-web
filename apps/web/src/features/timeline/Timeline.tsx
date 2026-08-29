import { lazy, Suspense } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
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
    <div className="timeline" role="region" aria-label="Conversation timeline">
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
      ))}
    </div>
  );
}
