/**
 * Product-facing General settings rows follow DeepSeek Harness' Setting-Cell
 * treatment at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek. MIT License; see THIRD_PARTY_NOTICES.md.
 */
import { useState } from "react";
import type { AttentionSettings } from "../attention/desktop-notifications.ts";
import { CopySessionLink } from "../session-links/CopySessionLink.tsx";
import type { SavedSessionReference } from "../session-links/saved-session-link.ts";
import { knownSessionKey } from "../session/known-session-registry.ts";
import styles from "./ProductSettings.module.css";
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
}: GeneralSettingsContentProps) {
  const t = useUiText();
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState(false);
  const connectionBusy = connectionStatus === "connecting";
  const canDisconnect =
    connectionStatus === "connected" || connectionStatus === "error";

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
    </div>
  );
}
