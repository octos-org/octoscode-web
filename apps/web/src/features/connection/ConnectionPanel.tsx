import type { ConnectionStatus } from "@octos-org/octoscode-client/protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { connectionEndpointError } from "./validation.ts";
import type { TokenStorageKind } from "./remembered-token.ts";
import styles from "./ConnectionPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

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
  /** §5.1 rejected token: focus the token field, keep the typed value. */
  focusTokenField?: boolean;
  /** The classifier's named next actions, rendered under the error. */
  failureActions?: readonly string[];
  /**
   * The raw failure was the handshake error, which the browser CANNOT tell
   * apart from a rejected token. §5.1's classified message names the address;
   * this flag keeps the honest second half — "if it requires authentication,
   * enter its token above" — so an empty-token connect is never diagnosed as
   * an address problem alone.
   */
  handshakeAmbiguous?: boolean;
  /**
   * WEB-PAIRING-CONTRACT-5100 §Client: a pairing link is being exchanged for a
   * token. There is nothing to type, so the form is not shown at all.
   */
  pairing?: boolean;
  /** §Client step 4: bounded copy for a link this client would not use. */
  pairingError?: string | null;
  /** §Remembering: which storage actually holds the token right now. */
  tokenStorage?: TokenStorageKind;
  /** §Remembering: ON by default for a pairing link, OFF for a typed token. */
  remember?: boolean;
  onRememberChange?: (next: boolean) => void;
  /** §Discovery: the last origin this browser saw answered /pair/info. */
  discoveredOrigin?: string | null;
  onUseDiscovered?: () => void;
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
  focusTokenField = false,
  failureActions,
  handshakeAmbiguous = false,
  pairing = false,
  pairingError = null,
  tokenStorage = "tab",
  remember = false,
  onRememberChange,
  discoveredOrigin = null,
  onUseDiscovered,
  onChange,
  onConnect,
  onDisconnect,
  onForget,
}: ConnectionPanelProps) {
  const t = useUiText();
  const connected = status === "connected";
  const connecting = status === "connecting";
  const endpointRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const pageOrigin =
    typeof window === "undefined" ? null : window.location.origin;
  const tokenInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTokenField && !connecting) tokenInputRef.current?.focus();
  }, [focusTokenField, connecting]);

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
    onConnect();
  };

  if (connected) return null;

  // §Client: while the link is being exchanged there is no token to paste, so
  // the operator is never shown a box asking for one.
  if (pairing) {
    return (
      <main className={styles.gate}>
        <div className={styles.card} aria-labelledby="connection-title">
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
            <h1 id="connection-title">{t("Connect to Octos")}</h1>
          </div>
          <div className={styles.connecting}>
            <span role="status">
              <span className={styles.spinner} aria-hidden="true" />{" "}
              {t("Opening your pairing link…")}
            </span>
            <button
              className={styles.cancel}
              onClick={onDisconnect}
              type="button"
            >
              {t("Cancel")}
            </button>
          </div>
        </div>
      </main>
    );
  }

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
          <h1 id="connection-title">{t("Connect to Octos")}</h1>
          <p>
            {t("Connect your server, then open a project to start coding.")}
          </p>
        </div>
        {pairingError ? (
          <div className={styles.error} role="alert">
            <strong>{t("That pairing link did not work")}</strong>
            <span>{t(pairingError)}</span>
          </div>
        ) : null}
        {discoveredOrigin && onUseDiscovered ? (
          <div className={styles.discovered} role="status">
            <span>
              {t("Found Octos on {value0}.", {
                value0: discoveredLabel(discoveredOrigin),
              })}
            </span>
            <button
              type="button"
              disabled={connecting}
              onClick={onUseDiscovered}
            >
              {t("Connect to {value0}", {
                value0: discoveredLabel(discoveredOrigin),
              })}
            </button>
          </div>
        ) : null}
        <div className={styles.fields}>
          <div className={styles.tokenField}>
            <div className={styles.fieldHeading}>
              <label htmlFor="connection-origin">{t("Server origin")}</label>
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
                  {t("Use this page")}
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
              {t(
                "Usually the address of this page. Change it to use another server.",
              )}
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
            <label htmlFor="connection-token">{t("Auth token")}</label>
            <div className={styles.tokenInput}>
              <input
                ref={tokenInputRef}
                id="connection-token"
                name="token"
                value={value.token}
                onChange={(event) => field("token", event.target.value)}
                placeholder={t("Paste your server token")}
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
                aria-label={showToken ? t("Hide token") : t("Show token")}
              >
                {showToken ? t("Hide") : t("Show")}
              </button>
            </div>
            <small id="connection-token-help" className={styles.fieldHelp}>
              {t("Required only if your server uses authentication.")}
            </small>
          </div>
          <label className={styles.remember}>
            <input
              type="checkbox"
              name="remember"
              checked={remember}
              disabled={connecting || !onRememberChange}
              onChange={(event) => onRememberChange?.(event.target.checked)}
            />
            <span>{t("Remember on this device")}</span>
          </label>
        </div>
        {error ? (
          <div className={styles.error} role="alert">
            <strong>{t("Could not connect")}</strong>
            {isHandshakeError(error) || handshakeAmbiguous ? (
              <>
                {isHandshakeError(error) ? null : <span>{error}</span>}
                <span>
                  {value.token.trim()
                    ? t(
                        "Check that your server is running and your token is current.",
                      )
                    : t(
                        "Check that your server is running. If it requires authentication, enter its token above.",
                      )}
                </span>
                <details className={styles.troubleshooting}>
                  <summary>{t("Connection details")}</summary>
                  <p>
                    {t(
                      "{value0}. The browser cannot distinguish an unavailable server from a rejected token. If these are correct, check allowed Web origins and WebSocket proxy forwarding.",
                      { value0: error },
                    )}
                  </p>
                </details>
              </>
            ) : (
              <span>{error}</span>
            )}
            {failureActions && failureActions.length > 0 ? (
              <small>{failureActions.join(" · ")}</small>
            ) : null}
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
              <span className={styles.spinner} aria-hidden="true" />{" "}
              {t("Connecting to your server…")}
            </span>
            <button
              className={styles.cancel}
              onClick={onDisconnect}
              type="button"
            >
              {t("Cancel")}
            </button>
          </div>
        ) : (
          <button className={styles.connect} type="submit">
            {t("Connect")}
          </button>
        )}
        <p className={styles.note} data-token-storage={tokenStorage}>
          {t(TOKEN_STORAGE_NOTE[tokenStorage])}
        </p>
        <button
          className={styles.forget}
          onClick={onForget}
          type="button"
          disabled={connecting}
        >
          {t("Forget saved connection")}
        </button>
      </form>
    </main>
  );
}

/** §Remembering: the visible line that states which storage is in effect. */
const TOKEN_STORAGE_NOTE: Readonly<Record<TokenStorageKind, string>> = {
  device:
    "Your token is remembered on this device. Your server address is remembered.",
  tab: "Your token stays in this browser tab. Your server address is remembered.",
  memory:
    "This browser blocked saved data, so your token is kept in memory only and is gone when you close this tab.",
};

/** host:port is what the server printed; the scheme adds nothing here. */
function discoveredLabel(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function isHandshakeError(error: string | null): boolean {
  return error === "Could not open the Octos UI Protocol connection";
}
