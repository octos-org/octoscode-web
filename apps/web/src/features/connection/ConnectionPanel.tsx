import type { ConnectionStatus } from "@octos-org/octoscode-client";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
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

  if (connected) return null;

  return (
    <main className={styles.gate}>
      <section className={styles.card} aria-labelledby="connection-title">
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <OctopusLogo size={30} />
          </span>
          <span>
            <strong>octoscode</strong>
            <small>web</small>
          </span>
        </div>
        <div className={styles.heading}>
          <h1 id="connection-title">Connect to Octos</h1>
          <p>Connect first, then choose a workspace for your coding session.</p>
        </div>
        <div className={styles.fields}>
          <label>
            <span>Server origin</span>
            <input
              value={value.endpoint}
              onChange={(event) => field("endpoint", event.target.value)}
              placeholder="https://octos.example.com"
              disabled={connecting}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <label>
            <span>Auth token</span>
            <input
              value={value.token}
              onChange={(event) => field("token", event.target.value)}
              placeholder="Token for this browser tab"
              type="password"
              autoComplete="off"
              disabled={connecting}
            />
          </label>
        </div>
        {error ? (
          <div className={styles.error} role="alert">
            <strong>Could not connect</strong>
            <span>{error}</span>
            {isHandshakeError(error) ? (
              <small>
                Check the origin, token, allowed Web origins, and reverse-proxy
                WebSocket forwarding.
              </small>
            ) : null}
          </div>
        ) : null}
        <button
          className={styles.connect}
          onClick={connecting ? onDisconnect : onConnect}
          disabled={!connecting && !value.endpoint.trim()}
          type="button"
        >
          {connecting ? "Cancel" : "Connect"}
        </button>
        <p className={styles.note}>
          The origin is remembered. The token stays in this tab so a refresh can
          reconnect without putting the credential in durable storage.
        </p>
        <button className={styles.forget} onClick={onForget} type="button">
          Forget saved connection
        </button>
      </section>
    </main>
  );
}

function isHandshakeError(error: string | null): boolean {
  return error === "Could not open the Octos UI Protocol connection";
}
