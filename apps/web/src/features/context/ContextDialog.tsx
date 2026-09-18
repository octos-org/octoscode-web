import { useEffect, useRef, useState } from "react";
import {
  applyContextNotification,
  CORE_UI_METHODS,
  supportsMethod,
  type ContextSnapshot,
  type OctosUiClient,
  type TokenCostUpdate,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { ContextPanel } from "./ContextPanel.tsx";
import styles from "./ContextPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

interface Props {
  client: OctosUiClient;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  initialSnapshot: ContextSnapshot | null;
  usage: TokenCostUpdate | null;
  turnBusy: boolean;
  onClose: () => void;
}

/** Mount with an authority key: every async operation stays bound to its owner. */
export function ContextDialog({
  client,
  sessionId,
  capabilities,
  initialSnapshot,
  usage,
  turnBusy,
  onClose,
}: Props) {
  const t = useUiText();
  const [snapshot, setSnapshot] = useState(
    initialSnapshot?.state.session_id === sessionId ? initialSnapshot : null,
  );
  const [mode, setMode] = useState<"llm" | "heuristic" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const eventRevision = useRef(0);
  const externallyBusy = useRef(turnBusy);
  externallyBusy.current = turnBusy || Boolean(snapshot?.compacting);

  async function refresh() {
    if (!supportsMethod(capabilities, CORE_UI_METHODS.SESSION_STATUS_READ))
      return;
    const revision = eventRevision.current;
    const status = await client.readSessionStatus(sessionId);
    if (!mounted.current || status.session_id !== sessionId) return;
    const incoming = status.contextSnapshot;
    if (!incoming || incoming.state.session_id !== sessionId) return;
    setSnapshot((current) => {
      // A delayed read cannot erase newer lifecycle notifications.
      if (
        revision !== eventRevision.current &&
        current &&
        incoming.state.generation <= current.state.generation
      )
        return current;
      return incoming;
    });
  }

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.subscribeNotifications((event) => {
      setSnapshot((current) => {
        const next = applyContextNotification(current, event, sessionId);
        if (next !== current) eventRevision.current += 1;
        return next;
      });
    });
    void refresh().catch((cause: unknown) => {
      if (mounted.current) setError(errorText(cause));
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
    // The containing App keys this surface by confirmed transport/session authority.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId]);

  async function mutate(operation: "compact" | "llm" | "heuristic") {
    if (pending.current || turnBusy || snapshot?.compacting) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    setConfirming(false);
    try {
      const commands = await client.contextCommands(sessionId, capabilities);
      if (!mounted.current) return;
      if (externallyBusy.current)
        throw new Error(
          "The session became busy. Wait before changing context.",
        );
      if (operation === "compact") {
        const response = await commands.compact();
        if (mounted.current)
          setResult(
            response.compacted
              ? "Context compacted."
              : `Compaction ${response.status}${response.reason ? `: ${response.reason}` : "."}`,
          );
      } else {
        const confirmed = await commands.setMode(operation);
        if (mounted.current) setMode(confirmed);
      }
      if (mounted.current) await refresh();
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="context-dialog-title"
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id="context-dialog-title">{t("Session context")}</h2>
        <button type="button" onClick={onClose}>
          {t("Close context")}
        </button>
      </header>
      <p className={styles.scope}>{sessionId}</p>
      <ContextPanel
        sessionId={sessionId}
        capabilities={capabilities}
        snapshot={snapshot}
        usage={usage}
        busy={busy || turnBusy}
        error={error}
        mode={mode}
        onCompact={() => setConfirming(true)}
        onModeChange={(next) => void mutate(next)}
      />
      {turnBusy ? (
        <p role="status">
          {t("Context changes are available when this session is idle.")}
        </p>
      ) : null}
      {confirming ? (
        <section
          className={styles.confirm}
          aria-label={t("Confirm context compaction")}
        >
          <p>
            {t(
              "Compact this session now? Older context may be summarized. The durable transcript remains on the server.",
            )}
          </p>
          <button
            type="button"
            disabled={busy || turnBusy}
            onClick={() => void mutate("compact")}
          >
            {t("Confirm compaction")}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            {t("Cancel")}
          </button>
        </section>
      ) : null}
      {result ? <p role="status">{result}</p> : null}
    </ModalSurface>
  );
}

function errorText(cause: unknown): string {
  return (
    cause instanceof Error ? cause.message : "Context request failed"
  ).slice(0, 512);
}
