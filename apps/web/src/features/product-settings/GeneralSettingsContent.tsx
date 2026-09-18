/**
 * Product-facing General settings rows follow DeepSeek Harness' Setting-Cell
 * treatment at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek. MIT License; see THIRD_PARTY_NOTICES.md.
 */
import { useId, useRef, useState } from "react";
import type { AttentionSettings } from "../attention/desktop-notifications.ts";
import { CopySessionLink } from "../session-links/CopySessionLink.tsx";
import type { SavedSessionReference } from "../session-links/saved-session-link.ts";
import { knownSessionKey } from "../session/known-session-registry.ts";
import styles from "./ProductSettings.module.css";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";

export type ProductConnectionStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface GeneralSettingsContentProps {
  serverOrigin: string;
  attentionSettings?: AttentionSettings;
  connectionStatus: ProductConnectionStatus;
  workspaceLabel?: string | null;
  workspacePath?: string | null;
  agentPreset?: string | null;
  displayProfile?: string | null;
  sessionReference?: SavedSessionReference;
  locked?: boolean;
  onDisconnect: () => void;
  onForgetConnection: () => void;
  /** Writes a redacted diagnostics snapshot to the clipboard. */
  onCopyDiagnostics?: () => void | Promise<void>;
  /**
   * The server offers `server/shutdown` — only a local `octos serve --solo`
   * over HTTP does. Without it the Stop row is not rendered at all.
   */
  canStopServer?: boolean;
  /** Stops the server; resolves once it has acknowledged. */
  onStopServer?: () => Promise<void>;
}

const STATUS_COPY: Readonly<Record<ProductConnectionStatus, string>> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Connection error",
};

function statusClass(status: ProductConnectionStatus): string {
  switch (status) {
    case "connected":
      return `${styles.statusDot} ${styles.statusConnected}`;
    case "connecting":
      return `${styles.statusDot} ${styles.statusConnecting}`;
    case "error":
      return `${styles.statusDot} ${styles.statusError}`;
    default:
      return `${styles.statusDot}`;
  }
}

interface SettingRowProps {
  title: string;
  description: string;
  value?: string | null;
  valueIsPath?: boolean;
}

function SettingRow({
  title,
  description,
  value,
  valueIsPath = false,
}: SettingRowProps) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <div className={styles.settingTitle}>{title}</div>
        <div className={styles.settingDescription}>{description}</div>
      </div>
      {value ? (
        <span
          className={
            valueIsPath
              ? `${styles.readonlyValue} ${styles.pathValue}`
              : styles.readonlyValue
          }
          title={value}
        >
          {value}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Controlled General-settings slot. It describes the active product context;
 * connection credentials and session addressing deliberately stay elsewhere.
 */
export function GeneralSettingsContent({
  serverOrigin,
  attentionSettings,
  connectionStatus,
  workspaceLabel,
  workspacePath,
  agentPreset,
  displayProfile,
  sessionReference,
  locked = false,
  onDisconnect,
  onForgetConnection,
  onCopyDiagnostics,
  canStopServer = false,
  onStopServer,
}: GeneralSettingsContentProps) {
  const t = useUiText();
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState(false);
  const connectionBusy = connectionStatus === "connecting";
  const canDisconnect =
    connectionStatus === "connected" || connectionStatus === "error";
  const [stopConfirming, setStopConfirming] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const stopTitleId = useId();
  const stopDescriptionId = useId();
  const stopCancelRef = useRef<HTMLButtonElement>(null);
  const showStopServer =
    canStopServer && Boolean(onStopServer) && connectionStatus === "connected";
  const closeStopConfirm = () => {
    setStopConfirming(false);
    setStopFailed(false);
  };
  const confirmStopServer = async () => {
    if (!onStopServer) return;
    setStopBusy(true);
    setStopFailed(false);
    try {
      // On success the parent disconnects this tab, which unmounts Settings.
      await onStopServer();
    } catch {
      setStopFailed(true);
      setStopBusy(false);
    }
  };

  return (
    <div className={styles.section} data-product-settings="general">
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <div className={styles.settingTitle}>{t("Octos server")}</div>
          <div className={styles.connectionStatus} role="status">
            <span
              className={statusClass(connectionStatus)}
              aria-hidden="true"
            />
            {t(STATUS_COPY[connectionStatus])}
          </div>
        </div>
        <span
          className={`${styles.readonlyValue} ${styles.pathValue}`}
          title={serverOrigin}
        >
          {serverOrigin}
        </span>
      </div>

      {workspaceLabel || workspacePath ? (
        <SettingRow
          title={t("Current workspace")}
          description={
            workspacePath ?? t("The workspace attached to this session.")
          }
          value={workspaceLabel ?? workspacePath ?? null}
          valueIsPath={!workspaceLabel}
        />
      ) : null}

      {agentPreset ? (
        <SettingRow
          title={t("Agent preset")}
          description={t("The coding-agent preset used for this session.")}
          value={agentPreset}
        />
      ) : null}

      {displayProfile ? (
        <SettingRow
          title={t("Profile")}
          description={t("The Octos profile backing this session.")}
          value={displayProfile}
        />
      ) : null}

      {sessionReference ? (
        <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
          <div className={styles.settingCopy}>
            <div className={styles.settingTitle}>Conversation link</div>
            <div className={styles.settingDescription}>
              Save this link to open the conversation in another browser. You
              will need access to the same Octos server.
            </div>
          </div>
          <CopySessionLink
            key={knownSessionKey(sessionReference)}
            reference={sessionReference}
            disabled={locked}
          />
        </div>
      ) : null}

      {attentionSettings ? (
        <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
          <div className={styles.settingCopy}>
            <div
              className={styles.settingTitle}
              id="desktop-notifications-title"
            >
              Desktop notifications
            </div>
            <div
              className={styles.settingDescription}
              id="desktop-notifications-description"
              role={attentionSettings.error ? "alert" : "status"}
            >
              {attentionSettings.message}
            </div>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            aria-labelledby="desktop-notifications-title"
            aria-describedby="desktop-notifications-description"
            aria-pressed={attentionSettings.enabled}
            disabled={attentionSettings.pending || !attentionSettings.available}
            onClick={attentionSettings.onToggle}
          >
            {attentionSettings.pending
              ? "Enabling…"
              : attentionSettings.enabled
                ? "On"
                : "Enable"}
          </button>
        </div>
      ) : null}

      {onCopyDiagnostics ? (
        <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
          <div className={styles.settingCopy}>
            <div className={styles.settingTitle}>Diagnostics</div>
            <div className={styles.settingDescription}>
              Copies a redacted snapshot: connection status, recovery detail,
              and app identity. No credentials.
            </div>
          </div>
          <div className={styles.actionGroup}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={locked}
              onClick={async () => {
                setDiagnosticsCopied(false);
                setDiagnosticsError(false);
                try {
                  await onCopyDiagnostics();
                  setDiagnosticsCopied(true);
                  window.setTimeout(() => setDiagnosticsCopied(false), 1500);
                } catch {
                  setDiagnosticsError(true);
                }
              }}
            >
              {diagnosticsCopied ? "Copied" : "Copy diagnostics"}
            </button>
            {diagnosticsError ? (
              <span role="alert">
                Could not copy diagnostics. Check clipboard access and try
                again.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
        <div className={styles.settingCopy}>
          <div className={styles.settingTitle}>{t("Connection")}</div>
          <div className={styles.settingDescription}>
            {t(
              "Disconnect keeps this server remembered. Forget removes the saved server and its tab-scoped credential.",
            )}
          </div>
        </div>
        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={locked || connectionBusy || !canDisconnect}
            onClick={onDisconnect}
          >
            {t("Disconnect")}
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={locked || connectionBusy}
            onClick={onForgetConnection}
          >
            {t("Forget server")}
          </button>
        </div>
      </div>

      {showStopServer ? (
        <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
          <div className={styles.settingCopy}>
            <div className={styles.settingTitle}>{t("Stop server")}</div>
            <div className={styles.settingDescription}>
              {t(
                "Stops octos serve on this computer, like Ctrl+C in its terminal. Every connected client is disconnected and running turns are cancelled. Start it again from a terminal.",
              )}
            </div>
          </div>
          <div className={styles.actionGroup}>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={locked}
              onClick={() => setStopConfirming(true)}
            >
              {t("Stop server")}
            </button>
          </div>
        </div>
      ) : null}

      {stopConfirming ? (
        <ModalSurface
          backdropClassName={styles.confirmBackdrop ?? ""}
          dialogClassName={styles.confirmDialog ?? ""}
          labelledBy={stopTitleId}
          describedBy={stopDescriptionId}
          busy={stopBusy}
          initialFocusRef={stopCancelRef}
          {...(stopBusy ? {} : { onEscape: closeStopConfirm })}
        >
          <h3 id={stopTitleId}>{t("Stop the Octos server?")}</h3>
          <p id={stopDescriptionId}>
            {t(
              "Every client connected to this server — this tab, other tabs, the terminal — is disconnected, and any running turn is cancelled. Conversations are kept on disk. To use Octos again, start octos serve from a terminal.",
            )}
          </p>
          {stopFailed ? (
            <p className={styles.confirmError} role="alert">
              {t("Could not stop the server. It is still running; try again.")}
            </p>
          ) : null}
          <div className={styles.confirmActions}>
            <button
              ref={stopCancelRef}
              type="button"
              className={styles.secondaryButton}
              disabled={stopBusy}
              onClick={closeStopConfirm}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={stopBusy}
              onClick={() => void confirmStopServer()}
            >
              {stopBusy ? t("Stopping…") : t("Stop server")}
            </button>
          </div>
        </ModalSurface>
      ) : null}
    </div>
  );
}
