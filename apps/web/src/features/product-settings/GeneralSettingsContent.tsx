/**
 * Product-facing General settings rows follow DeepSeek Harness' Setting-Cell
 * treatment at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek. MIT License; see THIRD_PARTY_NOTICES.md.
 */
import styles from "./ProductSettings.module.css";

export type ProductConnectionStatus =
  "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface GeneralSettingsContentProps {
  serverOrigin: string;
  connectionStatus: ProductConnectionStatus;
  workspaceLabel?: string | null;
  workspacePath?: string | null;
  agentPreset?: string | null;
  displayProfile?: string | null;
  locked?: boolean;
  onDisconnect: () => void;
  onForgetConnection: () => void;
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
  connectionStatus,
  workspaceLabel,
  workspacePath,
  agentPreset,
  displayProfile,
  locked = false,
  onDisconnect,
  onForgetConnection,
}: GeneralSettingsContentProps) {
  const connectionBusy = connectionStatus === "connecting";
  const canDisconnect =
    connectionStatus === "connected" || connectionStatus === "error";

  return (
    <div className={styles.section} data-product-settings="general">
      <div className={styles.settingRow}>
        <div className={styles.settingCopy}>
          <div className={styles.settingTitle}>Octos server</div>
          <div className={styles.connectionStatus} role="status">
            <span
              className={statusClass(connectionStatus)}
              aria-hidden="true"
            />
            {STATUS_COPY[connectionStatus]}
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
          title="Current workspace"
          description={
            workspacePath ?? "The workspace attached to this session."
          }
          value={workspaceLabel ?? workspacePath ?? null}
          valueIsPath={!workspaceLabel}
        />
      ) : null}

      {agentPreset ? (
        <SettingRow
          title="Agent preset"
          description="The coding-agent preset used for this session."
          value={agentPreset}
        />
      ) : null}

      {displayProfile ? (
        <SettingRow
          title="Profile"
          description="The Octos profile backing this session."
          value={displayProfile}
        />
      ) : null}

      <div className={`${styles.settingRow} ${styles.connectionActionsRow}`}>
        <div className={styles.settingCopy}>
          <div className={styles.settingTitle}>Connection</div>
          <div className={styles.settingDescription}>
            Disconnect keeps this server remembered. Forget removes the saved
            server and its tab-scoped credential.
          </div>
        </div>
        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={locked || connectionBusy || !canDisconnect}
            onClick={onDisconnect}
          >
            Disconnect
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={locked || connectionBusy}
            onClick={onForgetConnection}
          >
            Forget server
          </button>
        </div>
      </div>
    </div>
  );
}
