import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
}: {
  reference: SavedSessionReference;
}) {
  const t = useUiText();
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);
  const referenceKey = JSON.stringify(reference);
  useLayoutEffect(() => {
    generation.current += 1;
    setCopied(false);
    setManualUrl(null);
    window.clearTimeout(timer.current);
  }, [referenceKey]);
  useEffect(
    () => () => {
      generation.current += 1;
      window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const requestGeneration = ++generation.current;
    setManualUrl(null);
    const url = createSavedSessionUrl(window.location.href, reference);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      if (shouldPublishCopyConfirmation(requestGeneration, generation.current))
        setManualUrl(url);
      return;
    }
    if (!shouldPublishCopyConfirmation(requestGeneration, generation.current))
      return;
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
      {manualUrl ? (
        <div>
          <p role="status">
            {t("Clipboard unavailable. Select and copy the link below.")}
          </p>
          <textarea
            aria-label={t("Conversation link")}
            readOnly
            rows={3}
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
    </>
  );
}

export function shouldPublishCopyConfirmation(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration;
}
