import { useEffect, useRef, useState } from "react";
import { CheckIcon, LinkIcon } from "../../ui/Icon.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import { createSavedSessionUrl } from "./create-saved-session-url.ts";
import type { SavedSessionReference } from "./saved-session-link.ts";
import styles from "./CopySessionLinkButton.module.css";

/**
 * Copy this conversation's link from beside its title (audit G1): until Core
 * lists every Session, the link is how another browser finds it. A blocked
 * clipboard hands over to Settings, which shows the link to copy by hand.
 */
export function CopySessionLinkButton({
  reference,
  onClipboardUnavailable,
}: {
  reference: SavedSessionReference;
  onClipboardUnavailable: () => void;
}) {
  const t = useUiText();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        createSavedSessionUrl(window.location.href, reference),
      );
    } catch {
      onClipboardUnavailable();
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const label = t("Copy conversation link");
  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        title={label}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon size={15} /> : <LinkIcon size={15} />}
      </button>
      <span className="sr-only" role="status">
        {copied ? t("Conversation link copied.") : ""}
      </span>
    </>
  );
}
