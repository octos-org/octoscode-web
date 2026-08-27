import type { ConnectionStatus } from "@octos-org/octoscode-client";
import styles from "./ConnectionPanel.module.css";

export interface ConnectionDraft {
  endpoint: string;
  token: string;
  sessionId: string;
  profileId: string;
  cwd: string;
}

interface ConnectionPanelProps {
  value: ConnectionDraft;
  status: ConnectionStatus;
  error: string | null;
  onChange: (next: ConnectionDraft) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onForget: () => void;
}

export function ConnectionPanel({
  value,
  status,
  error,
  onChange,
  onConnect,
  onDisconnect,
  onForget,
}: ConnectionPanelProps) {
  const connected = status === "connected";
  const connecting = status === "connecting";

  const field = (key: keyof ConnectionDraft, next: string) => {
    onChange({ ...value, [key]: next });
  };

  if (connected) {
    return (
      <section
        className="connection-card connection-card-compact"
        aria-labelledby="connection-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">Runtime</span>
            <h2 id="connection-title">Octos server</h2>
          </div>
          <span className={`status-dot status-${status}`} title={status} />
        </div>
        <dl className="connection-summary">
          <div>
            <dt>Origin</dt>
            <dd>{value.endpoint}</dd>
          </div>
          {value.cwd ? (
            <div>
              <dt>Workspace</dt>
              <dd>{value.cwd}</dd>
            </div>
          ) : null}
          {value.profileId ? (
            <div>
              <dt>Profile</dt>
              <dd>{value.profileId}</dd>
            </div>
          ) : null}
        </dl>
        {error ? <p className="connection-error">{error}</p> : null}
        <button
          className="button button-secondary"
          onClick={onDisconnect}
          type="button"
        >
          Disconnect
        </button>
      </section>
    );
  }

  return (
    <section className="connection-card" aria-labelledby="connection-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Runtime</span>
          <h2 id="connection-title">Octos server</h2>
        </div>
        <span className={`status-dot status-${status}`} title={status} />
      </div>

      <label>
        <span>Server origin</span>
        <input
          value={value.endpoint}
          onChange={(event) => field("endpoint", event.target.value)}
          placeholder="http://127.0.0.1:50080"
          disabled={connected || connecting}
        />
      </label>

      <label>
        <span>Auth token</span>
        <input
          value={value.token}
          onChange={(event) => field("token", event.target.value)}
          placeholder="Remembered for this tab"
          type="password"
          autoComplete="off"
          disabled={connected || connecting}
        />
      </label>

      <label>
        <span>Workspace path on server</span>
        <input
          value={value.cwd}
          onChange={(event) => field("cwd", event.target.value)}
          placeholder="/path/on/server"
          disabled={connected || connecting}
        />
      </label>

      <details className={styles.advanced}>
        <summary>Advanced launch identity</summary>
        <p>
          Core normally resolves the profile and canonical coding session from
          the workspace. These values are fallback hints for older servers.
        </p>
        <div className="field-pair">
          <label>
            <span>Session id</span>
            <input
              value={value.sessionId}
              onChange={(event) => field("sessionId", event.target.value)}
              disabled={connected || connecting}
            />
          </label>
          <label>
            <span>Profile id</span>
            <input
              value={value.profileId}
              onChange={(event) => field("profileId", event.target.value)}
              placeholder="Optional"
              disabled={connected || connecting}
            />
          </label>
        </div>
      </details>

      {error ? <p className="connection-error">{error}</p> : null}
      {isHandshakeError(error) ? (
        <p className={styles.help}>
          The WebSocket failed before <code>session/open</code>. Check server
          reachability, the token, allowed Web origins, and reverse-proxy
          WebSocket Upgrade forwarding.
        </p>
      ) : null}

      {connected || connecting ? (
        <button
          className="button button-secondary"
          onClick={onDisconnect}
          type="button"
        >
          {connecting ? "Cancel connection" : "Disconnect"}
        </button>
      ) : (
        <button
          className="button button-primary"
          onClick={onConnect}
          disabled={
            connecting || !value.endpoint.trim() || !value.sessionId.trim()
          }
          type="button"
        >
          {connecting ? "Connecting…" : "Connect workspace"}
        </button>
      )}

      <p className="field-note">
        Origin and workspace are remembered on this browser. The auth token is
        kept only for this tab and is cleared when the tab closes.
      </p>
      <button className={styles.forget} onClick={onForget} type="button">
        Forget connection
      </button>
    </section>
  );
}

function isHandshakeError(error: string | null): boolean {
  return error === "Could not open the Octos UI Protocol connection";
}
