import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

/** Follow new output while at the tail; never pull a reader out of history. */
export function useConversationScroll(sessionKey: string | null, view: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (atBottom) following.current = true;
    else if (element.scrollTop < previousTop.current - 1)
      following.current = false;
    // Content growth and scroll anchoring also dispatch scroll. A larger
    // distance alone is not evidence that the reader scrolled away.
    previousTop.current = element.scrollTop;
    setShowJumpLatest(!following.current && !atBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    following.current = true;
    setShowJumpLatest(false);
    // One atomic jump avoids a second stream update cancelling a smooth scroll.
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
      previousTop.current = element.scrollTop;
    }
  }, []);

  const onDisclosureInteraction = useCallback((event: SyntheticEvent) => {
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
    }
  }, []);

  useLayoutEffect(() => {
    jumpToLatest();
  }, [sessionKey, view, jumpToLatest]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    // Markdown/code can grow after the projection render; observe actual size.
    const observer = new ResizeObserver(() => {
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
  }, [sessionKey, view]);

  return {
    scrollRef,
    contentRef,
    onScroll,
    onDisclosureInteraction,
    showJumpLatest,
    jumpToLatest,
  };
}
