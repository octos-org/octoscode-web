/**
 * §4.1: the chat window's ONE status strip under the composer. Read-only
 * presentation of the session's effective model, permission mode and seat
 * state in words; clicking/Enter/Space opens the configuration pane.
 */
import { useId } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import { stripStateThinking } from "../timeline/strip-thinking.ts";
import type { TurnActivity } from "../timeline/turn-activity.ts";
import styles from "./SessionConfig.module.css";

/** The third segment's vocabulary (task words, never ownership words). */
export type SessionStripState =
  | { kind: "ready" }
  | { kind: "waiting-approval" }
  | { kind: "waiting-answer" }
  | { kind: "responding" }
  /**
   * Another attached client (a terminal, a second tab) owns the session's live
   * turn. Distinct from `external-held`: nothing holds the control seat and
   * chat is not refused — the session is simply busy, and the turn is not
   * ours to claim. The activity word is deliberately NOT substituted here
   * (see `stripStateThinking`): whose turn it is outranks what it is doing,
   * and the timeline still shows the steps.
   */
  | { kind: "busy-elsewhere" }
  | { kind: "peers-running"; count: number }
  | { kind: "external-held" }
  | { kind: "handing-back" }
  | { kind: "resuming-chat" }
  | { kind: "reconnecting" };

export interface SessionStatusStripProps {
  /** Effective model label, or null when not reported. */
  model: string | null;
  /** Effective permission mode label, or null when unknown. */
  permissionMode: string | null;
  state: SessionStripState;
  /** Live turn activity; while responding, its word replaces the third segment. */
  activity?: TurnActivity | null;
  onOpenPane: () => void;
}

export function stripStateWords(
  state: SessionStripState,
  t: ReturnType<typeof useUiText>,
): string {
  switch (state.kind) {
    case "ready":
      return t("Ready");
    case "waiting-approval":
      return t("Waiting for your approval");
    case "waiting-answer":
      return t("Waiting for your answer");
    case "responding":
      return t("Responding");
    case "busy-elsewhere":
      return t("Another client is working in this session");
    case "peers-running":
      return t("Peers running ({count})", { count: state.count });
    case "external-held":
      return t("Another app is using this session");
    case "handing-back":
      return t("Handing back control…");
    case "resuming-chat":
      return t("Resuming chat…");
    case "reconnecting":
      return t("Reconnecting");
  }
}

export function SessionStatusStrip({
  model,
  permissionMode,
  state,
  activity = null,
  onOpenPane,
}: SessionStatusStripProps) {
  const t = useUiText();
  const tooltipId = useId();
  const descriptionId = useId();
  // UX5 goal 3: while a response is being produced, the third segment shows
  // the live step word (Thinking… / Running shell… / Writing…). Judge #8
  // (round 3): the word renders through t() — the template carries tool
  // words; fixed words ARE the catalog key.
  const rawLiveLabel = stripStateThinking(state, activity);
  const liveLabel =
    rawLiveLabel === null
      ? null
      : activity?.template
        ? t(activity.template, { ...activity.params })
        : t(rawLiveLabel);
  const segments = [
    model ?? t("Model not reported"),
    permissionMode ?? t("Permissions not reported"),
    liveLabel ?? stripStateWords(state, t),
  ];
  const text = segments.join(" · ");
  return (
    <button
      type="button"
      className={styles["session-status-strip"]}
      data-testid="session-status-strip"
      aria-label={t("Session settings")}
      aria-describedby={`${tooltipId} ${descriptionId}`}
      title={t("Model, permissions, sandbox")}
      onClick={onOpenPane}
    >
      <span id={tooltipId} hidden>
        {t("Model, permissions, sandbox")}
      </span>
      <span id={descriptionId} hidden>
        {text}
      </span>
      <span className={styles["session-status-strip-text"]}>
        <span className={styles["session-status-strip-context"]}>
          {segments[0]} · {segments[1]}
        </span>
        <span className={styles["session-status-strip-state"]}>
          <span className={styles["session-status-strip-separator"]}> · </span>
          {liveLabel ? (
            <span className="thinking-spinner" aria-hidden="true">
              ◠
            </span>
          ) : null}
          {segments[2]}
        </span>
      </span>
      <svg
        className="session-status-strip-chevron"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3.5 5.25 7 8.75l3.5-3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
