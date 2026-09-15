import { useEffect, useRef, useState } from "react";
import {
  createSavedSessionUrl,
  type SavedSessionReference,
} from "./saved-session-link.ts";
import styles from "./CopySessionLink.module.css";

type CopyState =
  | { phase: "idle" | "copying" | "copied" }
  | { phase: "fallback"; url: string }
  | { phase: "error" };

export function CopySessionLink({
  reference,
  disabled = false,
}: {
  reference: SavedSessionReference;
  disabled?: boolean;
}) {
  const [state, setState] = useState<CopyState>({ phase: "idle" });
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);
  useEffect(() => {
    return () => {
      requestRef.current += 1;
    };
  }, []);
  useEffect(() => {
    if (state.phase !== "fallback") return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [state]);

  const copy = async () => {
    const requestId = ++requestRef.current;
    let url: string;
    try {
      url = createSavedSessionUrl(window.location.href, reference);
    } catch {
      setState({ phase: "error" });
      return;
    }
    setState({ phase: "copying" });
    try {
      await navigator.clipboard.writeText(url);
      if (requestRef.current === requestId) setState({ phase: "copied" });
    } catch {
      if (requestRef.current === requestId) {
        setState({ phase: "fallback", url });
      }
    }
  };

  return (
    <div className={styles.control}>
      <button
        type="button"
        className={styles.button}
        disabled={disabled || state.phase === "copying"}
        onClick={() => void copy()}
      >
        {state.phase === "copied"
          ? "Copied"
          : state.phase === "copying"
            ? "Copying…"
            : "Copy conversation link"}
      </button>
      {state.phase === "copied" ? (
        <span className="sr-only" role="status">
          Conversation link copied.
        </span>
      ) : null}
      {state.phase === "fallback" ? (
        <div className={styles.fallback}>
          <p role="status">
            Clipboard unavailable. Select and copy the link below.
          </p>
          <textarea
            ref={fallbackRef}
            aria-label="Conversation link"
            readOnly
            rows={3}
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
      {state.phase === "error" ? (
        <p className={styles.error} role="alert">
          This conversation does not have a complete saved reference yet.
        </p>
      ) : null}
    </div>
  );
}
