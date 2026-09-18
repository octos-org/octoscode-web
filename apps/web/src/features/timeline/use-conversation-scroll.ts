import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

export interface ConversationViewState {
  firstVisibleId: string | null;
  following: boolean;
  scrollTop: number;
  anchor: { id: string; offset: number } | null;
}

/** Follow new output while at the tail; never pull a reader out of history. */
export function useConversationScroll(
  identity: object | null,
  sessionKey: string | null,
  view: string,
) {
  // Reading positions live only for this authenticated browser identity.
  const positions = useMemo(
    () => new Map<string, ConversationViewState>(),
    [identity],
  );
  const viewState = useMemo(() => {
    if (!identity || !sessionKey || view !== "chat") return null;
    let state = positions.get(sessionKey);
    if (!state) {
      state = {
        firstVisibleId: null,
        following: true,
        scrollTop: 0,
        anchor: null,
      };
      positions.set(sessionKey, state);
    }
    return state;
  }, [identity, positions, sessionKey, view]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  const restoreAfterLayout = useRef(false);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const rememberPosition = useCallback(
    (element: HTMLDivElement) => {
      if (!viewState) return;
      viewState.following = following.current;
      viewState.scrollTop = element.scrollTop;
      const top = element.getBoundingClientRect().top;
      const anchor = [
        ...element.querySelectorAll<HTMLElement>("[data-timeline-entry]"),
      ].find((entry) => entry.getBoundingClientRect().bottom > top);
      viewState.anchor = anchor
        ? {
            id: anchor.dataset.timelineEntry!,
            offset: anchor.getBoundingClientRect().top - top,
          }
        : null;
    },
    [viewState],
  );

  const onScroll = useCallback(() => {
    if (restoreAfterLayout.current) return;
    const element = scrollRef.current;
    if (!element || !element.clientHeight) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (atBottom) following.current = true;
    else if (element.scrollTop < previousTop.current - 1)
      following.current = false;
    // Content growth and scroll anchoring also dispatch scroll. A larger
    // distance alone is not evidence that the reader scrolled away.
    previousTop.current = element.scrollTop;
    setShowJumpLatest(!following.current && !atBottom);
    rememberPosition(element);
  }, [rememberPosition]);

  const jumpToLatest = useCallback(() => {
    restoreAfterLayout.current = false;
    following.current = true;
    setShowJumpLatest(false);
    // One atomic jump avoids a second stream update cancelling a smooth scroll.
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      previousTop.current = element.scrollTop;
      rememberPosition(element);
    }
  }, [rememberPosition]);

  const onDisclosureInteraction = useCallback(
    (event: SyntheticEvent) => {
      if (
        event.nativeEvent instanceof KeyboardEvent &&
        event.nativeEvent.key !== "Enter" &&
        event.nativeEvent.key !== " "
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const details = target.closest("summary")?.parentElement;
      if (details instanceof HTMLDetailsElement && !details.open) {
        // User intent comes before the native toggle and its resize. Keep the
        // summary in place instead of following the newly revealed output.
        following.current = false;
        if (scrollRef.current) rememberPosition(scrollRef.current);
      }
    },
    [rememberPosition],
  );

  const restorePosition = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !element.clientHeight) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    else if (viewState) {
      const anchor = viewState.anchor;
      const entry = anchor
        ? element.querySelector<HTMLElement>(
            `[data-timeline-entry="${CSS.escape(anchor.id)}"]`,
          )
        : null;
      element.scrollTop =
        entry && anchor
          ? element.scrollTop +
            entry.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            anchor.offset
          : viewState.scrollTop;
    }
    previousTop.current = element.scrollTop;
    setShowJumpLatest(
      !following.current &&
        element.scrollHeight - element.scrollTop - element.clientHeight >= 48,
    );
  }, [viewState]);

  useLayoutEffect(() => {
    following.current = viewState?.following ?? true;
    restoreAfterLayout.current = Boolean(
      viewState?.anchor && !following.current,
    );
    restorePosition();
  }, [sessionKey, view, viewState, restorePosition]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    // Markdown/code can grow after the projection render; observe actual size.
    const observer = new ResizeObserver(() => {
      if (!element.clientHeight) return;
      if (restoreAfterLayout.current) {
        // content-visibility replaces offscreen estimates after the first layout.
        restorePosition();
        restoreAfterLayout.current = false;
        return;
      }
      if (following.current) {
        element.scrollTop = element.scrollHeight;
        previousTop.current = element.scrollTop;
      } else
        setShowJumpLatest(
          element.scrollHeight - element.scrollTop - element.clientHeight >= 48,
        );
    });
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, [sessionKey, view, restorePosition]);

  return {
    viewState,
    scrollRef,
    contentRef,
    onScroll,
    onDisclosureInteraction,
    showJumpLatest,
    jumpToLatest,
  };
}
