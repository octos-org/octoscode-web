import type { ConnectionStatus } from "@octos-org/octoscode-client";

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
}

export function ConnectionPanel({
  value,
  status,
  error,
  onChange,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const connected = status === "connected";
  const connecting = status === "connecting";

  const field = (key: keyof ConnectionDraft, next: string) => {
    onChange({ ...value, [key]: next });
  };

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
          placeholder="Kept in memory only"
          type="password"
          autoComplete="off"
          disabled={connected || connecting}
        />
      </label>

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

      <label>
        <span>Server workspace</span>
        <input
          value={value.cwd}
          onChange={(event) => field("cwd", event.target.value)}
          placeholder="/path/on/server"
          disabled={connected || connecting}
        />
      </label>

      {error ? <p className="connection-error">{error}</p> : null}

      {connected ? (
        <button
          className="button button-secondary"
          onClick={onDisconnect}
          type="button"
        >
          Disconnect
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
        The browser is only a client. Agent execution and filesystem access stay
        in
        <code> octos serve</code>.
      </p>
    </section>
  );
}
