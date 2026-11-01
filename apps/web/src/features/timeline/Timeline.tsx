import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { CheckIcon, ChevronDownIcon } from "../../ui/Icon.tsx";
import styles from "./Timeline.module.css";
import type { TimelineEntry } from "./model.ts";
import { toolKind, type ToolKind } from "./tool-kind.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  COLLAPSED_ALL,
  thinkingSummaryParts,
  type FoldState,
} from "./folds.ts";
import { toolTitle } from "./tool-presentation.ts";
import { TurnSummary } from "./TurnSummary.tsx";
import { recoveredFailuresByTurn } from "./turn-summary.ts";
import {
  endedTurnIds,
  summarizeSteps,
  timelineRenderItems,
} from "./step-groups.ts";
import { parseTextPlan, type TextPlan } from "./text-plan.ts";
import { TurnActivityIndicator } from "./TurnActivityIndicator.tsx";
import { permissionDeniedReason } from "../approval/approval-presentation.ts";
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
  /** Explicit open/closed choice for blocks whose default is derived. */
  onSetFold?: (id: string, open: boolean) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  /** Live turn activity; rendered at the transcript bottom while streaming. */
  activity?: TurnActivity | null;
  workspaceFileReadAvailable?: boolean;
  /**
   * Replaces the default empty state of a connected, empty Session. Pass it
   * only while the Session is empty so the memoized transcript stays stable.
   */
  emptyState?: ReactNode;
  onRetryPermission?: ((turnId: string) => void) | undefined;
  permissionRetryBusyTurnId?: string | null | undefined;
}

export const Timeline = memo(function Timeline({
  entries,
  connected,
  viewState,
  onSaveViewState,
  showThinking = true,
  folds,
  onToggleFold,
  onSetFold,
  onExpandAll,
  onCollapseAll,
  activity = null,
  workspaceFileReadAvailable = false,
  emptyState,
  onRetryPermission,
  permissionRetryBusyTurnId = null,
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
  const setRef = useRef(onSetFold);
  setRef.current = onSetFold;
  const setFold = useCallback(
    (id: string, open: boolean) =>
      setRef.current ? setRef.current(id, open) : toggleRef.current?.(id),
    [],
  );
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
  const endedTurns = endedTurnIds(entries);
  const recovered = recoveredFailuresByTurn(entries);
  const failedTurns = new Set(
    entries.flatMap((entry) =>
      entry.kind === "system" &&
      entry.id.startsWith("terminal:") &&
      entry.status === "error"
        ? [entry.id.slice("terminal:".length)]
        : [],
    ),
  );
  if (renderableEntries.length === 0) {
    if (connected && emptyState) return <>{emptyState}</>;
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
      {timelineRenderItems(visibleEntries.slice(startIndex), endedTurns).map(
        (item) =>
          item.type === "summary" ? (
            <TurnSummary
              key={item.entry.id}
              turnId={item.turnId}
              entries={visibleEntries}
            />
          ) : item.type === "steps" ? (
            <StepGroup
              key={item.id}
              id={item.id}
              entries={item.entries}
              failedTurn={failedTurns.has(item.turnId)}
              recovered={recovered}
              folds={folds}
              onToggleFold={toggleFold}
              onSetFold={setFold}
              workspaceFileReadAvailable={workspaceFileReadAvailable}
              onRetryPermission={onRetryPermission}
              retryBusy={permissionRetryBusyTurnId === item.turnId}
            />
          ) : (
            <TimelineEntryView
              key={item.entry.id}
              entry={item.entry}
              expanded={entryExpanded(folds, item.entry.id)}
              onToggleFold={toggleFold}
              onSetFold={setFold}
              planOpen={folds?.[`plan:${item.entry.id}`]}
              turnEnded={
                item.entry.turnId === undefined ||
                endedTurns.has(item.entry.turnId)
              }
              workspaceFileReadAvailable={workspaceFileReadAvailable}
              onRetryPermission={onRetryPermission}
              retryBusy={permissionRetryBusyTurnId === item.entry.turnId}
            />
          ),
      )}
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
  onSetFold,
  planOpen,
  turnEnded,
  workspaceFileReadAvailable,
  onRetryPermission,
  retryBusy,
}: {
  entry: TimelineEntry;
  expanded: boolean | undefined;
  onToggleFold: (id: string) => void;
  onSetFold: (id: string, open: boolean) => void;
  planOpen: boolean | undefined;
  turnEnded: boolean;
  workspaceFileReadAvailable: boolean;
  onRetryPermission?: ((turnId: string) => void) | undefined;
  retryBusy: boolean;
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
          workspaceFileReadAvailable={workspaceFileReadAvailable}
          onRetryPermission={onRetryPermission}
          retryBusy={retryBusy}
        />
      );
    default:
      return (
        <DefaultEntry
          entry={entry}
          turnEnded={turnEnded}
          planOpen={planOpen}
          onSetFold={onSetFold}
        />
      );
  }
});

/** Folded unless the reader opened it (or chose "Expand all"). */
function entryExpanded(
  folds: FoldState | undefined,
  id: string,
): boolean | undefined {
  return folds ? (folds[id] ?? folds[COLLAPSED_ALL] ?? false) : undefined;
}

interface FoldableBlockProps {
  entry: TimelineEntry;
  /** undefined = reader-controlled native disclosure; boolean = folds state. */
  expanded: boolean | undefined;
  onToggleFold: (id: string) => void;
  onRetryPermission?: ((turnId: string) => void) | undefined;
  retryBusy?: boolean;
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
  const { seconds, words, unit } = thinkingSummaryParts({
    body: entry.body,
    startedAtMs: entry.startedAtMs,
    endedAtMs: entry.endedAtMs,
  });
  const countLabel = t(`{words} ${unit}`, { words });
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
            {seconds
              ? `${t("{seconds} s", { seconds })} · ${countLabel}`
              : countLabel}
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
function ToolBlock(
  props: FoldableBlockProps & {
    workspaceFileReadAvailable: boolean;
    /** Inside a step group, which renders the retry and files itself. */
    grouped?: boolean;
  },
) {
  const { entry, onRetryPermission, retryBusy = false, grouped } = props;
  const t = useUiText();
  const running = entry.status === "running";
  const presentation = toolTitle(
    entry.title,
    entry.toolArguments ?? entry.body,
  );
  const seconds =
    entry.startedAtMs !== undefined && entry.endedAtMs !== undefined
      ? Math.max(0, Math.round((entry.endedAtMs - entry.startedAtMs) / 1000))
      : undefined;
  return (
    <>
      <details
        data-timeline-entry={entry.id}
        className={`${styles.toolBlock}${running ? ` ${styles.toolBlockLive}` : ""}`}
        data-live={running}
        {...disclosureProps(props)}
      >
        <summary className={styles.toolHeader}>
          <ActivityGlyph status={entry.status} tool={toolKind(entry.title)} />
          <strong>
            {presentation.key
              ? t(presentation.key, presentation.params)
              : entry.title}
          </strong>
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
              {seconds ? ` · ${t("{seconds} s", { seconds })}` : null}
            </span>
          )}
          {entry.status === "complete" ? (
            <CheckIcon size={14} className={styles.completedGlyph} />
          ) : null}
          <ChevronDownIcon className={styles.chevron} />
        </summary>
        <div className={styles.toolBody}>
          <div className="muted">
            {t("Tool")}: <code>{entry.title}</code>
          </div>
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
      {grouped ? null : (
        <StepFollowUps
          entries={[entry]}
          workspaceFileReadAvailable={props.workspaceFileReadAvailable}
          onRetryPermission={onRetryPermission}
          retryBusy={retryBusy}
        />
      )}
    </>
  );
}

/**
 * What a reader must still reach when the step itself is folded: the
 * permission retry and any file a step wrote.
 */
function StepFollowUps({
  entries,
  workspaceFileReadAvailable,
  onRetryPermission,
  retryBusy,
}: {
  entries: readonly TimelineEntry[];
  workspaceFileReadAvailable: boolean;
  onRetryPermission?: ((turnId: string) => void) | undefined;
  retryBusy: boolean;
}) {
  const t = useUiText();
  const denied = entries.find(
    (entry) =>
      entry.kind === "tool" &&
      entry.turnId &&
      permissionDeniedReason(entry.status, entry.body),
  );
  const files = entries.flatMap((entry) =>
    entry.kind === "tool" &&
    entry.status === "complete" &&
    entry.artifactPath &&
    workspaceFileReadAvailable
      ? [entry.artifactPath]
      : [],
  );
  return (
    <>
      {denied && onRetryPermission ? (
        <button
          type="button"
          className={styles.stepRetry}
          disabled={retryBusy}
          onClick={() => onRetryPermission(denied.turnId!)}
        >
          {retryBusy
            ? t("Switching to write and retrying…")
            : t("Switch to write and retry")}
        </button>
      ) : null}
      {files.map((path) => (
        <AttachmentList key={path} media={[path]} workspaceFile />
      ))}
    </>
  );
}

/** A finished turn's consecutive thinking and tool blocks, folded as one. */
function StepGroup({
  id,
  entries,
  failedTurn,
  recovered,
  folds,
  onToggleFold,
  onSetFold,
  workspaceFileReadAvailable,
  onRetryPermission,
  retryBusy,
}: {
  id: string;
  entries: readonly TimelineEntry[];
  failedTurn: boolean;
  recovered: ReadonlySet<string>;
  folds: FoldState | undefined;
  onToggleFold: (id: string) => void;
  onSetFold: (id: string, open: boolean) => void;
  workspaceFileReadAvailable: boolean;
  onRetryPermission?: ((turnId: string) => void) | undefined;
  retryBusy: boolean;
}) {
  const t = useUiText();
  const summary = summarizeSteps(entries, recovered);
  // A block the reader opened before the turn ended keeps its group open, so
  // ending a turn never hides what someone is reading.
  const expanded = folds
    ? (folds[id] ??
      (folds[COLLAPSED_ALL] === false
        ? false
        : entries.some((entry) => folds[entry.id] === true)))
    : undefined;
  return (
    <>
      <details
        className={styles.stepGroup}
        data-step-group={id}
        {...(expanded === undefined
          ? {}
          : {
              open: expanded,
              onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
                if (event.currentTarget.open !== expanded)
                  onSetFold(id, event.currentTarget.open);
              },
            })}
      >
        <summary className={styles.stepGroupHeader}>
          <strong>{t("Ran {count} steps", { count: summary.steps })}</strong>
          {summary.seconds ? (
            <span className={styles.toolStatusLabel}>
              {t("{seconds} s", { seconds: summary.seconds })}
            </span>
          ) : null}
          {failedTurn ? (
            summary.failed + summary.retried ? (
              <span className={styles.stepGroupNote} data-tone="error">
                {t("{count} steps failed", {
                  count: summary.failed + summary.retried,
                })}
              </span>
            ) : null
          ) : (
            <>
              {summary.retried ? (
                <span className={styles.stepGroupNote}>
                  {t("Retried automatically {count} times", {
                    count: summary.retried,
                  })}
                </span>
              ) : null}
              {summary.failed ? (
                <span className={styles.stepGroupNote} data-tone="error">
                  {t("{count} steps failed", { count: summary.failed })}
                </span>
              ) : null}
            </>
          )}
          <ChevronDownIcon className={styles.chevron} />
        </summary>
        <div className={styles.stepGroupBody}>
          {entries.map((entry) =>
            entry.kind === "tool" ? (
              <ToolBlock
                key={entry.id}
                entry={entry}
                expanded={entryExpanded(folds, entry.id)}
                onToggleFold={onToggleFold}
                workspaceFileReadAvailable={workspaceFileReadAvailable}
                grouped
              />
            ) : (
              <ReasoningBlock
                key={entry.id}
                entry={entry}
                expanded={entryExpanded(folds, entry.id)}
                onToggleFold={onToggleFold}
              />
            ),
          )}
        </div>
      </details>
      <StepFollowUps
        entries={entries}
        workspaceFileReadAvailable={workspaceFileReadAvailable}
        onRetryPermission={onRetryPermission}
        retryBusy={retryBusy}
      />
    </>
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
function DefaultEntry({
  entry,
  turnEnded,
  planOpen,
  onSetFold,
}: {
  entry: TimelineEntry;
  turnEnded: boolean;
  planOpen: boolean | undefined;
  onSetFold: (id: string, open: boolean) => void;
}) {
  const t = useUiText();
  const running = entry.status === "running";
  const plan = entry.kind === "assistant" ? parseTextPlan(entry.body) : null;
  const markdown = plan ? streamingSafe(plan.rest, running) : entry.body;
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
            {/* System rows are the client's own notices; translate them.
                t() returns anything it does not know unchanged. */}
            <strong>
              {entry.kind === "system" ? t(entry.title) : entry.title}
            </strong>
            {entry.status === "running" ? (
              <span className="running-label">{t("running")}</span>
            ) : null}
          </div>
        ) : null}
        {plan ? (
          <PlanBlock
            id={`plan:${entry.id}`}
            plan={plan}
            ended={turnEnded}
            open={planOpen}
            onSetFold={onSetFold}
          />
        ) : null}
        {markdown ? (
          entry.kind === "assistant" ? (
            <Suspense fallback={<pre>{markdown}</pre>}>
              <MarkdownBody text={markdown} streaming={running} />
            </Suspense>
          ) : (
            <pre>
              {entry.kind === "system" ? noticeText(t, markdown) : markdown}
            </pre>
          )
        ) : null}
        {entry.media?.length ? <AttachmentList media={entry.media} /> : null}
      </div>
    </article>
  );
}

/**
 * Client notices whose body ends with the user's own text: translate the
 * fixed lead-in and keep what follows as typed.
 */
const NOTICE_PREFIXES = [
  "The turn finished without confirming delivery. Check the final response before deciding whether to send this text again; it was not resent automatically: ",
  "The request may have been consumed or started a new turn. It will not be resent automatically. Use the Retry queued delivery control above — or reconnect from Settings to restore queued prompt delivery. Submitted text: ",
  "Transport changed before consumption could be confirmed. This text will not be resent automatically: ",
];

function noticeText(t: ReturnType<typeof useUiText>, body: string): string {
  const prefix = NOTICE_PREFIXES.find((lead) => body.startsWith(lead));
  return prefix ? t(prefix) + body.slice(prefix.length) : t(body);
}

/** While streaming, a half-written checklist line is not shown as text. */
function streamingSafe(rest: string, running: boolean): string {
  if (!running) return rest;
  return rest.replace(/(^|\n)\s*[-*]\s*(\[[ xX]?\]?\s*)?$/, "").trim();
}

/**
 * The model's opening checklist, read as the turn's plan. Open while the turn
 * runs; folded once it ends, unless the reader opens it again.
 */
function PlanBlock({
  id,
  plan,
  ended,
  open,
  onSetFold,
}: {
  id: string;
  plan: TextPlan;
  ended: boolean;
  open: boolean | undefined;
  onSetFold: (id: string, open: boolean) => void;
}) {
  const t = useUiText();
  const expanded = open ?? !ended;
  const done = plan.items.filter((item) => item.done).length;
  return (
    <details
      className={styles.planBlock}
      data-plan-block={id}
      open={expanded}
      onToggle={(event) => {
        if (event.currentTarget.open !== expanded)
          onSetFold(id, event.currentTarget.open);
      }}
    >
      <summary className={styles.stepGroupHeader}>
        <strong>{t("Plan")}</strong>
        <span className={styles.toolStatusLabel}>
          {ended && done === 0
            ? t("{count} plan items", { count: plan.items.length })
            : t("{done} of {total} done", { done, total: plan.items.length })}
        </span>
        {ended ? (
          <span className={styles.toolStatusLabel}>{t("Turn ended")}</span>
        ) : null}
        <ChevronDownIcon className={styles.chevron} />
      </summary>
      <ol className={styles.planItems}>
        {plan.items.map((item, index) => (
          <li key={index} data-done={item.done || undefined}>
            <span className={styles.planMark} aria-hidden="true">
              {item.done ? <CheckIcon size={12} /> : null}
            </span>
            <span>{item.title}</span>
            <span className="sr-only">
              {", "}
              {t(item.done ? "Done" : "Pending")}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
