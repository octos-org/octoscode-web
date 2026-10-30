import { useEffect, useState } from "react";
import {
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { RuntimeMcp } from "@octos-org/octoscode-client/inventory";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";

interface ConnectorsSettingsContentProps {
  client: OctosUiClient;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
}

export function ConnectorsSettingsContent({
  client,
  profileId,
  sessionId,
  capabilities,
}: ConnectorsSettingsContentProps) {
  const t = useUiText();
  const [state, setState] = useState<RuntimeMcp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void client
      .inventoryCommands(sessionId, profileId, capabilities)
      .then((commands) => commands.mcp())
      .then(
        (result) => {
          if (current) {
            setState(result);
            setLoading(false);
            setRefreshing(false);
          }
        },
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
            setRefreshing(false);
          }
        },
      );
    return () => {
      current = false;
    };
  }, [client, profileId, sessionId, capabilities, refreshing]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Connectors")}</h2>
          <p>{t("Read-only MCP server status for this Session.")}</p>
        </div>
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => setRefreshing(true)}
        >
          {t("Refresh")}
        </button>
      </header>
      <p className={styles.notice}>
        {t(
          "Add, remove, edit, and OAuth are unavailable in the current protocol.",
        )}
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {state ? (
        <>
          <p className={styles.meta}>
            {t(
              "{connected} connected · {connecting} connecting · {failed} failed · {disabled} disabled",
              {
                connected: state.summary.connected,
                connecting: state.summary.connecting,
                failed: state.summary.failed,
                disabled: state.summary.disabled,
              },
            )}
          </p>
          {!state.servers.length ? (
            <p>{t("No MCP servers are configured for this Session.")}</p>
          ) : null}
          <div className={styles.rows}>
            {state.servers.map((server) => (
              <article key={server.id} className={styles.row}>
                <div className={styles.rowHeading}>
                  <strong>{server.displayName ?? server.id}</strong>
                  <span data-status={server.status}>{server.status}</span>
                </div>
                <p className={styles.meta}>
                  {server.transport ?? server.id} · {server.toolCount}{" "}
                  {t("tools")}
                </p>
                {server.error ? (
                  <p className={styles.error}>{server.error}</p>
                ) : null}
                {server.tools.length ? (
                  <details>
                    <summary>{t("Tools")}</summary>
                    <ul>
                      {server.tools.map((tool) => (
                        <li key={tool}>{tool}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
