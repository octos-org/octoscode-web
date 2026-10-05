import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Conversation text search backed by the CSS Custom Highlights API.
 *
 * Walks the timeline DOM for text nodes matching the query, registers
 * match ranges as a named highlight, and exposes active-match
 * navigation. Requires no DOM mutation — ranges stay valid as long as
 * the underlying text nodes do.
 */
export function useConversationSearch(
  containerRef: RefObject<HTMLElement | null>,
) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  const activeRangeRef = useRef<Range | null>(null);

  const clearHighlights = useCallback(() => {
    CSS.highlights.delete("conversation-search");
    CSS.highlights.delete("conversation-search-active");
    rangesRef.current = [];
    activeRangeRef.current = null;
  }, []);

  /** Collect text nodes, skipping script/style/hidden content. */
  const collectTextNodes = useCallback((root: HTMLElement): Text[] => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA")
          return NodeFilter.FILTER_REJECT;
        if (parent.closest("[aria-hidden='true']")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current = walker.nextNode();
    while (current !== null) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    return nodes;
  }, []);

  /** Re-run the search whenever the query or DOM content changes. */
  const search = useCallback(() => {
    const container = containerRef.current;
    if (container === null || query.trim().length === 0) {
      clearHighlights();
      return;
    }
    const haystack = caseSensitive
      ? (node: Text) => node.textContent ?? ""
      : (node: Text) => (node.textContent ?? "").toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const ranges: Range[] = [];
    for (const node of collectTextNodes(container)) {
      const text = haystack(node);
      let from = 0;
      let hit = text.indexOf(needle, from);
      while (hit !== -1) {
        const range = new Range();
        range.setStart(node, hit);
        range.setEnd(node, hit + needle.length);
        ranges.push(range);
        from = hit + needle.length;
        hit = text.indexOf(needle, from);
      }
    }
    rangesRef.current = ranges;
    setActiveIndex((current) =>
      ranges.length === 0 ? 0 : Math.min(current, ranges.length - 1),
    );
    applyHighlight();
  }, [caseSensitive, clearHighlights, collectTextNodes, containerRef, query]);

  const applyHighlight = useCallback(() => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) {
      clearHighlights();
      return;
    }
    const active = ranges[activeIndex] ?? null;
    activeRangeRef.current = active;
    const others = ranges.filter((_, index) => index !== activeIndex);
    CSS.highlights.set("conversation-search", new Highlight(...others));
    if (active !== null) {
      CSS.highlights.set("conversation-search-active", new Highlight(active));
    } else {
      CSS.highlights.delete("conversation-search-active");
    }
  }, [activeIndex, clearHighlights]);

  // Re-search when query changes.
  useEffect(() => {
    search();
  }, [search]);

  // Re-search when the DOM content changes (new messages stream in).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null || query.trim().length === 0) return;
    const observer = new MutationObserver(() => search());
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, query, search]);

  // Clean up highlights on unmount.
  useEffect(() => clearHighlights, [clearHighlights]);

  const goTo = useCallback((index: number) => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    const next = ((index % ranges.length) + ranges.length) % ranges.length;
    setActiveIndex(next);
  }, []);

  const nextMatch = useCallback(() => {
    goTo(activeIndex + 1);
    scrollToActive();
  }, [activeIndex, goTo]);

  const previousMatch = useCallback(() => {
    goTo(activeIndex - 1);
    scrollToActive();
  }, [activeIndex, goTo]);

  const scrollToActive = useCallback(() => {
    // Defer one frame so applyHighlight ran for the new active index.
    requestAnimationFrame(() => {
      const range = activeRangeRef.current;
      if (range === null) return;
      const element =
        range.startContainer.parentElement ?? (range.startContainer as Element);
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  const jumpTo = useCallback(
    (index: number) => {
      goTo(index);
      scrollToActive();
    },
    [goTo, scrollToActive],
  );

  return useMemo(
    () => ({
      query,
      setQuery,
      caseSensitive,
      setCaseSensitive,
      matchCount: rangesRef.current.length,
      activeIndex,
      nextMatch,
      previousMatch,
      jumpTo,
    }),
    [caseSensitive, query, activeIndex, nextMatch, previousMatch, jumpTo],
  );
}
