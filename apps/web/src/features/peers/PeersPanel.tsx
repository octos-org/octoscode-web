import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { PeerManager } from "./peer-manager.ts";
import styles from "./PeersPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface PeersPanelProps {
  manager: Pick<
    PeerManager,
    | "subscribe"
    | "getSnapshot"
    | "canPrepare"
    | "canGather"
    | "kickoff"
    | "gather"
    | "retryOpen"
  >;
  readOnly?: boolean;
}

/** Presentation only. Watching expands a blackboard row without opening a session. */
export function PeersPanel({ manager, readOnly = false }: PeersPanelProps) {
  const t = useUiText();
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const [brief, setBrief] = useState("");
  const [fleetSize, setFleetSize] = useState("1");
  const [worktree, setWorktree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPrepare = manager.canPrepare(readOnly);
  const canGather = manager.canGather();

  async function prepare(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const n = Number(fleetSize);
    if (!Number.isSafeInteger(n) || n < 1 || n > 8) {
      setError("Choose between 1 and 8 peers.");
      return;
    }
    const submitted = brief;
    try {
      const result = await manager.kickoff(
        { brief: submitted, n, worktree },
        { readOnly },
      );
      if (result) setBrief((current) => (current === submitted ? "" : current));
    } catch {
      setError(
        "Peer preparation is unavailable. Check the connection and session.",
      );
    }
  }

  if (!canPrepare && !canGather && snapshot.peers.length === 0) return null;
  return (
    <section className={styles.panel} aria-label={t("Peers")}>
      <h2>{t("Peers")}</h2>
      {canPrepare ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            void prepare(event);
          }}
        >
          <label>
            {t("Peer brief")}
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              required
            />
          </label>
          <label>
            {t("Peers")}
            <input
              type="number"
              min="1"
              max="8"
              step="1"
              value={fleetSize}
              onChange={(event) => setFleetSize(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={worktree}
              onChange={(event) => setWorktree(event.target.checked)}
            />
            {t("Create a worktree for each peer")}
          </label>
          <button
            type="submit"
            disabled={
              snapshot.prepareBusy || snapshot.prepareUncertain || !brief.trim()
            }
          >
            {t("Start peers")}
          </button>
        </form>
      ) : null}
      {error || snapshot.prepareError ? (
        <p role="alert">{error ?? snapshot.prepareError}</p>
      ) : null}
      {snapshot.peers.length ? (
        <ul className={styles.roster} aria-label={t("Session peers")}>
          {snapshot.peers.map((peer) => (
            <li key={peer.identity}>
              <span>
                {peer.slug} — {peer.status}
              </span>
              {peer.error ? <p role="alert">{peer.error}</p> : null}
              {peer.canRetry && !readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    void manager.retryOpen(peer.identity);
                  }}
                >
                  {t("Retry opening") + " "}
                  {peer.slug}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canGather ? (
        <section aria-label={t("Profile peer blackboard")}>
          <h3>{t("Profile blackboard")}</h3>
          <p>{t("Briefs and results from peers in this profile.")}</p>
          <button
            type="button"
            disabled={snapshot.gatherBusy}
            onClick={() => {
              setError(null);
              void manager
                .gather()
                .catch(() =>
                  setError(
                    "Peer gathering is unavailable. Check the connection.",
                  ),
                );
            }}
          >
            {snapshot.gatherBusy ? t("Refreshing…") : t("Refresh blackboard")}
          </button>
          {snapshot.gatherError ? (
            <p role="alert">{snapshot.gatherError}</p>
          ) : null}
          {snapshot.blackboard.map((row) => (
            <details key={row.slug} className={styles.row}>
              <summary>
                {row.name ?? row.slug}
                {row.closed
                  ? " " + t("— closed")
                  : row.result === null
                    ? " " + t("— awaiting result")
                    : " " + t("— result available")}
              </summary>
              <p>{row.brief}</p>
              {row.brief_truncated ? (
                <p>{t("Brief preview truncated.")}</p>
              ) : null}
              {row.result !== null ? (
                <pre className={styles.result}>{row.result}</pre>
              ) : null}
              {row.result_truncated ? (
                <p>{t("Result preview truncated.")}</p>
              ) : null}
            </details>
          ))}
        </section>
      ) : null}
    </section>
  );
}
