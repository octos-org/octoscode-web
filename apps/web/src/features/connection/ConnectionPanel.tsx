import type { ConnectionStatus } from "@octos-org/octoscode-client";
import { useRef, useState, type FormEvent } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { connectionEndpointError } from "./validation.ts";
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
  storageWarning?: string;
  onChange: (next: ConnectionDraft) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onForget: () => void;
}

export function ConnectionPanel({
  value,
  status,
  error,
  storageWarning,
  onChange,
  onConnect,
  onDisconnect,
  onForget,
}: ConnectionPanelProps) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  const tokenRef = useRef<HTMLInputElement>(null);
  const endpointRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const pageOrigin =
    typeof window === "undefined" ? null : window.location.origin;

  const field = (key: keyof ConnectionDraft, next: string) => {
    if (key === "endpoint") setValidationError(null);
    onChange({ ...value, [key]: next });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (connecting) return;
    const invalid = connectionEndpointError(value.endpoint);
    setValidationError(invalid);
    if (invalid) {
      endpointRef.current?.focus();
      return;
    }
    if (!value.token.trim()) {
      setValidationError("Auth token is required.");
      tokenRef.current?.focus();
      return;
    }
    onConnect();
  };

  if (connected) return null;

  return (
    <main className={styles.gate}>
      <form
        className={styles.card}
        aria-labelledby="connection-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
        noValidate
      >
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
          <p>Connect your server, then open a project to start coding.</p>
        </div>
        <div className={styles.fields}>
          <div className={styles.tokenField}>
            <div className={styles.fieldHeading}>
              <label htmlFor="connection-origin">Server origin</label>
              {pageOrigin && value.endpoint.trim() !== pageOrigin ? (
                <button
                  type="button"
                  className={styles.usePage}
                  disabled={connecting}
                  onClick={() => {
                    field("endpoint", pageOrigin);
                    endpointRef.current?.focus();
                  }}
                >
                  Use this page
                </button>
              ) : null}
            </div>
            <input
              ref={endpointRef}
              id="connection-origin"
              name="endpoint"
              value={value.endpoint}
              onChange={(event) => field("endpoint", event.target.value)}
              placeholder="https://octos.example.com"
              disabled={connecting}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              autoComplete="url"
              aria-invalid={validationError ? "true" : undefined}
              aria-describedby={`connection-origin-help${validationError ? " connection-origin-error" : ""}`}
            />
            <small id="connection-origin-help" className={styles.fieldHelp}>
              Usually the address of this page. Change it to use another server.
            </small>
            {validationError ? (
              <small
                id="connection-origin-error"
                className={styles.validation}
                role="alert"
              >
                {validationError}
              </small>
            ) : null}
          </div>
          <div className={styles.tokenField}>
            <label htmlFor="connection-token">Auth token</label>
            <div className={styles.tokenInput}>
              <input
                id="connection-token"
                name="token"
                value={value.token}
                onChange={(event) => field("token", event.target.value)}
                placeholder="Paste your server token"
                type={showToken ? "text" : "password"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={connecting}
                aria-describedby="connection-token-help"
              />
              <button
                className={styles.showToken}
                type="button"
                onClick={() => setShowToken((shown) => !shown)}
                disabled={connecting}
                aria-label={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <small id="connection-token-help" className={styles.fieldHelp}>
              Required only if your server uses authentication.
            </small>
          </div>
        </div>
        {error ? (
          <div className={styles.error} role="alert">
            <strong>Could not connect</strong>
            {isHandshakeError(error) ? (
              <>
                <span>
                  {value.token.trim()
                    ? "Check that your server is running and your token is current."
                    : "Check that your server is running. If it requires authentication, enter its token above."}
                </span>
                <details className={styles.troubleshooting}>
                  <summary>Connection details</summary>
                  <p>
                    {error}. The browser cannot distinguish an unavailable
                    server from a rejected token. If these are correct, check
                    allowed Web origins and WebSocket proxy forwarding.
                  </p>
                </details>
              </>
            ) : (
              <span>{error}</span>
            )}
          </div>
        ) : null}
        {storageWarning ? (
          <div className={styles.error} role="alert">
            {storageWarning}
          </div>
        ) : null}
        {connecting ? (
          <div className={styles.connecting}>
            <span role="status">
              <span className={styles.spinner} aria-hidden="true" /> Connecting
              to your server…
            </span>
            <button
              className={styles.cancel}
              onClick={onDisconnect}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className={styles.connect} type="submit">
            Connect
          </button>
        )}
        <p className={styles.note}>
          Your token stays in this browser tab. Your server address is
          remembered.
        </p>
        <button
          className={styles.forget}
          onClick={onForget}
          type="button"
          disabled={connecting}
        >
          Forget saved connection
        </button>
      </form>
    </main>
  );
}

function isHandshakeError(error: string | null): boolean {
  return error === "Could not open the Octos UI Protocol connection";
}
