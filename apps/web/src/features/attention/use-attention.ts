import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  BackgroundTurnSessionScope,
  BackgroundTurnSnapshot,
} from "../session/background-turn-manager.ts";
import {
  AttentionTracker,
  attentionTitle,
  foregroundAttentionTurns,
} from "./model.ts";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  DesktopNotifications,
  desktopEnvironment,
} from "./desktop-notifications.ts";

export interface AttentionInput {
  /** Stable opaque identity; replace on endpoint/auth change, null on disconnect. */
  identity: object | null;
  turns: readonly BackgroundTurnSnapshot[];
  selectedSession: BackgroundTurnSessionScope | null;
  activeTurnId?: string | null;
  waitingTurnId?: string | null;
  timeline?: readonly TimelineEntry[];
  /** Clicking a notification returns to its Session (Chat / Code flag). */
  onOpenSession?: ((scope: BackgroundTurnSessionScope) => void) | undefined;
}

export function useAttention({
  identity,
  turns,
  selectedSession,
  activeTurnId = null,
  waitingTurnId = null,
  timeline = EMPTY_TIMELINE,
  onOpenSession,
}: AttentionInput) {
  const [desktop] = useState(
    () => new DesktopNotifications(desktopEnvironment()),
  );
  const settings = useSyncExternalStore(
    desktop.subscribe,
    desktop.getSnapshot,
    desktop.getSnapshot,
  );
  const tracker = useRef(new AttentionTracker());
  const originalTitle = useRef<string | null>(null);
  const previousIdentity = useRef(identity);
  // Read at click time, so a new callback never re-runs the notice tracking.
  const openSession = useRef(onOpenSession);
  openSession.current = onOpenSession;

  useEffect(() => {
    originalTitle.current = document.title;
    const acknowledge = () => {
      if (document.visibilityState !== "visible") return;
      tracker.current.acknowledgeAll();
      desktop.clear();
      document.title = originalTitle.current ?? document.title;
    };
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
      desktop.dispose();
      document.title = originalTitle.current ?? document.title;
    };
  }, [desktop]);

  useEffect(() => {
    if (identity !== previousIdentity.current) desktop.clear();
    previousIdentity.current = identity;
    const notices = tracker.current.observe(
      identity,
      [
        ...turns,
        ...foregroundAttentionTurns(
          selectedSession,
          activeTurnId,
          waitingTurnId,
          timeline,
        ),
      ],
      selectedSession,
      document.visibilityState === "visible",
    );
    document.title = attentionTitle(
      originalTitle.current ?? document.title,
      tracker.current.count,
    );
    if (tracker.current.count === 0) desktop.clear();
    for (const notice of notices)
      desktop.show(notice.state, () => openSession.current?.(notice));
  }, [
    desktop,
    identity,
    turns,
    selectedSession,
    activeTurnId,
    waitingTurnId,
    timeline,
  ]);

  return { settings };
}

const EMPTY_TIMELINE: readonly TimelineEntry[] = [];
