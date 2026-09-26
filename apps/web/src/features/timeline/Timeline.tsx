import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { CheckIcon, ChevronDownIcon } from "../../ui/Icon.tsx";
import styles from "./Timeline.module.css";
import type { TimelineEntry } from "./model.ts";
import { toolKind, type ToolKind } from "./tool-kind.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { thinkingSummaryParts, toolTarget, type FoldState } from "./folds.ts";
import { TurnActivityIndicator } from "./TurnActivityIndicator.tsx";
import type { TurnActivity } from "./turn-activity.ts";
import { AttachmentList } from "./AttachmentList.tsx";
import foldStyles from "./TimelineFolds.module.css";
import type { ConversationViewState } from "./use-conversation-scroll.ts";

const MarkdownBody = lazy(() =>
  import("../markdown/MarkdownBody.tsx").then((module) => ({
    default: module.MarkdownBody,
  })),
);

interface TimelineProps {
  entries: readonly TimelineEntry[];
  connected: boolean;
  viewState?: ConversationViewState | null;
  onSaveViewState?: () => void;
  /** Thinking option (Session settings); off = render no thinking at all. */
  showThinking?: boolean;
  /**
   * Per-block expanded memory while this session is open. Absent ids render
   * folded; omitting the prop leaves each disclosure reader-controlled.
   */
  folds?: FoldState;
  onToggleFold?: (id: string) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  /** Live turn activity; rendered at the transcript bottom while streaming. */
  activity?: TurnActivity | null;
}

export const Timeline = memo(function Timeline({
  entries,
  connected,
  viewState,
  onSaveViewState,
  showThinking = true,
  folds,
  onToggleFold,
  onExpandAll,
  onCollapseAll,
  activity = null,
}: TimelineProps) {
  const t = useUiText();
  // An assistant row with no text still renders when it delivers files (a
  // `send_file` without a caption).
  const renderableEntries = entries.filter(
    (entry) =>
      entry.kind !== "assistant" ||
      entry.body.trim() ||
      Boolean(entry.media?.length),
  );
  const visibleEntries = showThinking
    ? renderableEntries
    : renderableEntries.filter((entry) => entry.kind !== "reasoning");
  const hasFoldable = visibleEntries.some(
    (entry) => entry.kind === "reasoning" || entry.kind === "tool",
  );
  const showFoldBar = hasFoldable && Boolean(onExpandAll || onCollapseAll);
  // Entry rows keep a stable toggle identity so their memo boundary holds
  // while the parent re-creates its handler on every render.
  const toggleRef = useRef(onToggleFold);
  toggleRef.current = onToggleFold;
  const toggleFold = useCallback((id: string) => toggleRef.current?.(id), []);
  // Keep the server-provided projection intact; only bound the initial DOM.
  // Anchoring by identity prevents incoming messages evicting a reader's row.
  const [firstVisibleId, setFirstVisibleId] = useState<string | null>(
    () => viewState?.firstVisibleId ?? null,
  );
  const knownIndex = visibleEntries.findIndex(
    (entry) => entry.id === firstVisibleId,
  );
  const startIndex =
    knownIndex < 0 ? Math.max(0, visibleEntries.length - 40) : knownIndex;
  const timelineRef = useRef<HTMLDivElement>(null);
  const revealAnchor = useRef<{ element: Element; top: number } | null>(null);
  // Capture the old DOM before a Session/tab switch removes its entries.
  useLayoutEffect(() => onSaveViewState, [onSaveViewState]);
  useLayoutEffect(() => {
    if (viewState)
      viewState.firstVisibleId = visibleEntries[startIndex]?.id ?? null;
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
  if (renderableEntries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-mark">
          <OctopusLogo size={28} />
        </div>
        <span className="eyebrow">{t("Coding workspace")}</span>
        <h2>
          {connected
            ? t("Ask Octos to work on this repository")
            : t("Connect an Octos server")}
        </h2>
        <p>
          {connected
            ? t(
                "Describe a change, investigate a bug, or ask how the code works.",
              )
            : t(
                "Connect to your server to open a repository and start working.",
              )}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={timelineRef}
      className={`timeline ${styles.timeline}`}
      role="log"
      aria-label={t("Conversation timeline")}
    >
      {showFoldBar ? (
        <div className={foldStyles.timelineFoldsBar}>
          {onExpandAll ? (
            <button
              type="button"
              className={foldStyles.timelineFoldsButton}
              onClick={onExpandAll}
            >
              {t("Expand all")}
            </button>
          ) : null}
          {onCollapseAll ? (
            <button
              type="button"
              className={foldStyles.timelineFoldsButton}
              onClick={onCollapseAll}
            >
              {t("Collapse all")}
            </button>
          ) : null}
        </div>
      ) : null}
      {startIndex > 0 ? (
        <button
          type="button"
          className={styles.earlierButton}
          onClick={() => {
            // Skip the fold bar and this button: anchor the first entry row.
            const first = timelineRef.current?.children[showFoldBar ? 2 : 1];
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
          {t("Show {count} earlier messages", {
            count: Math.min(startIndex, 100),
          })}
        </button>
      ) : null}
      {visibleEntries.slice(startIndex).map((entry) => (
        <TimelineEntryView
          key={entry.id}
          entry={entry}
          expanded={folds ? folds[entry.id] === true : undefined}
          onToggleFold={toggleFold}
        />
      ))}
      <TurnActivityIndicator activity={activity} />
    </div>
  );
});

/**
 * Memo boundary: folding produces new objects only for entries that changed,
 * so a streaming delta re-renders a single entry instead of re-evaluating
 * markdown for the whole timeline.
 */
const TimelineEntryView = memo(function TimelineEntryView({
  entry,
  expanded,
  onToggleFold,
}: {
  entry: TimelineEntry;
  expanded: boolean | undefined;
  onToggleFold: (id: string) => void;
}) {
  switch (entry.kind) {
    case "reasoning":
      return (
        <ReasoningBlock
          entry={entry}
          expanded={expanded}
          onToggleFold={onToggleFold}
        />
      );
    case "tool":
      return (
        <ToolBlock
          entry={entry}
          expanded={expanded}
          onToggleFold={onToggleFold}
        />
      );
    default:
      return <DefaultEntry entry={entry} />;
  }
});

interface FoldableBlockProps {
  entry: TimelineEntry;
  /** undefined = reader-controlled native disclosure; boolean = folds state. */
  expanded: boolean | undefined;
  onToggleFold: (id: string) => void;
}

/**
 * Native <details> keeps keyboard support and the motion layer. When a fold
 * state is supplied it is folded by default and mirrors the reader's toggles
 * back into that state; completion never closes it.
 */
function disclosureProps({
  entry,
  expanded,
  onToggleFold,
}: FoldableBlockProps) {
  if (expanded === undefined) return {};
  return {
    open: expanded,
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
      if (event.currentTarget.open !== expanded) onToggleFold(entry.id);
    },
  };
}

/** Disclosure state belongs to the reader, so completion never closes it. */
function ReasoningBlock(props: FoldableBlockProps) {
  const { entry } = props;
  const t = useUiText();
  const running = entry.status === "running";
  const { seconds, words } = thinkingSummaryParts({
    body: entry.body,
    startedAtMs: entry.startedAtMs,
    endedAtMs: entry.endedAtMs,
  });
  return (
    <details
      data-timeline-entry={entry.id}
      className={`${styles.reasoningBlock}${running ? ` ${styles.reasoningBlockLive}` : ""}`}
      data-live={running}
      {...disclosureProps(props)}
    >
      <summary className={styles.reasoningHeader}>
        <ActivityGlyph status={entry.status} />
        <strong>{running ? t("Thinking…") : t("Thought process")}</strong>
        {words > 0 ? (
          <span className={styles.toolStatusLabel}>
            {seconds === undefined
              ? t("{words} words", { words })
              : t("{seconds} s · {words} words", { seconds, words })}
          </span>
        ) : null}
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
function ToolBlock(props: FoldableBlockProps) {
  const { entry } = props;
  const t = useUiText();
  const running = entry.status === "running";
  const target = toolTarget(entry.body);
  const seconds =
    entry.startedAtMs !== undefined && entry.endedAtMs !== undefined
      ? Math.max(0, Math.round((entry.endedAtMs - entry.startedAtMs) / 1000))
      : undefined;
  return (
    <details
      data-timeline-entry={entry.id}
      className={`${styles.toolBlock}${running ? ` ${styles.toolBlockLive}` : ""}`}
      data-live={running}
      {...disclosureProps(props)}
    >
      <summary className={styles.toolHeader}>
        <ActivityGlyph status={entry.status} tool={toolKind(entry.title)} />
        <strong>{target ? `${entry.title} · ${target}` : entry.title}</strong>
        {running ? (
          <span className={styles.runningLabel}>{t("Running")}</span>
        ) : (
          <span className={styles.toolStatusLabel} data-status={entry.status}>
            {t(
              entry.statusLabel ??
                (entry.status === "complete"
                  ? "Done"
                  : entry.status === "error"
                    ? "Failed"
                    : "Finished"),
            )}
            {seconds === undefined ? null : ` · ${seconds} s`}
          </span>
        )}
        {entry.status === "complete" ? (
          <CheckIcon size={14} className={styles.completedGlyph} />
        ) : null}
        <ChevronDownIcon className={styles.chevron} />
      </summary>
      <div className={styles.toolBody}>
        {entry.body ? (
          <pre className={styles.toolOutput}>{entry.body}</pre>
        ) : (
          <span className="muted">
            {running
              ? t("Waiting for tool output…")
              : t("Finished without text output.")}
          </span>
        )}
      </div>
    </details>
  );
}

function ActivityGlyph({
  status,
  tool,
}: {
  status: TimelineEntry["status"];
  /**
   * Tool family, so a row reads as shell/read/edit/search/web at a glance.
   * A tool row keeps its family glyph after it settles and marks completion
   * beside the duration instead, since "which tool ran" stays useful while
   * "it finished" is already carried by the status label.
   */
  tool?: ToolKind | undefined;
}) {
  if (status === "complete" && tool === undefined) {
    return <CheckIcon size={14} className={styles.completedGlyph} />;
  }
  return (
    <span
      className={styles.statusGlyph}
      data-status={status}
      {...(tool && tool !== "generic" ? { "data-tool": tool } : {})}
      aria-hidden="true"
    />
  );
}

/** Assistant and user messages: full markdown rendering. */
function DefaultEntry({ entry }: { entry: TimelineEntry }) {
  const t = useUiText();
  return (
    <article
      data-timeline-entry={entry.id}
      className={`timeline-entry entry-${entry.kind}${entry.kind === "assistant" ? ` ${styles.assistantEntry}` : ""}`}
      aria-label={
        entry.kind === "assistant" ? t("Assistant response") : undefined
      }
    >
      <div className="entry-rail">
        <span className={`entry-glyph glyph-${entry.status}`} />
      </div>
      <div className="entry-content">
        {entry.kind !== "assistant" ? (
          <div className="entry-heading">
            <strong>{entry.title}</strong>
            {entry.status === "running" ? (
              <span className="running-label">{t("running")}</span>
            ) : null}
          </div>
        ) : null}
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
        {entry.media?.length ? <AttachmentList media={entry.media} /> : null}
      </div>
    </article>
  );
}
