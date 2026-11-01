/**
 * §4.4 Settings › Defaults: the profile-level model default (same
 * profile/llm/select handling as the pane) plus the browser-stored
 * new-session permission mode and sandbox. Presentation only — the model
 * control is the caller's (use-model-selection); permission/sandbox drafts are
 * browser preferences saved through session-defaults.ts and applied at
 * CREATION only.
 */
import type { ReactNode } from "react";
import { useUiText } from "../preferences/ui-text.tsx";
import type { SessionDefaults } from "./session-defaults.ts";
import styles from "./SessionConfig.module.css";

export interface DefaultsModelListState {
  /** The projected ModelControlProps from use-model-selection, rendered as-is. */
  control: ReactNode;
}

export interface SettingsDefaultsSectionProps {
  open: boolean;
  /** The caller's model control (null when the server lists no models). */
  modelList: DefaultsModelListState | null;
  /** The saved profile primary's label. */
  savedModelName: string | null;
  defaults: SessionDefaults | null;
  onDefaultsChange: (next: SessionDefaults) => void;
}

const MODE_OPTIONS = [
  { id: "read_only", label: "Read only" },
  { id: "workspace_write", label: "Workspace write" },
  { id: "danger_full_access", label: "Full access" },
] as const;

export function SettingsDefaultsSection({
  open,
  modelList,
  savedModelName,
  defaults,
  onDefaultsChange,
}: SettingsDefaultsSectionProps) {
  const t = useUiText();
  if (!open) return null;
  const current: SessionDefaults = defaults ?? {
    permissionMode: "workspace_write",
    network: "deny",
    sandbox: { enabled: false, networkAccess: false, readAllowPaths: [] },
  };
  const next = (patch: Partial<SessionDefaults>) =>
    onDefaultsChange?.({ ...current, ...patch });

  return (
    <section
      className={`${styles["session-config-section"]} settings-defaults-section`}
      data-settings-defaults="true"
      aria-label={t("Defaults")}
    >
      <h3>{t("Defaults")}</h3>
      <p>{t("Shared by every session and tab of this profile")}</p>
      {modelList ? (
        <div data-defaults-field="model">
          <div className={styles["session-config-row"]}>
            <h4 className={styles["session-config-row-label"]}>{t("Model")}</h4>
            {modelList.control}
          </div>
          <p>
            {t("Saved for this profile:")}
            {savedModelName ?? t("(no model selected)")}
          </p>
        </div>
      ) : null}
      <div>
        <h4>
          {t("New sessions")}
          <span> {t("for sessions you create from now on")}</span>
        </h4>
        <label
          className={styles["session-config-row"]}
          data-defaults-field="permission-mode"
        >
          <span className={styles["session-config-row-label"]}>
            {t("Permission mode")}
          </span>
          <select
            className={styles["session-config-select"]}
            value={current.permissionMode}
            onChange={(event) =>
              next({
                permissionMode: event.target
                  .value as SessionDefaults["permissionMode"],
              })
            }
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label
          className={styles["session-config-row"]}
          data-defaults-field="sandbox-enabled"
        >
          <span className={styles["session-config-row-label"]}>
            {t("Sandbox")}
          </span>
          <input
            type="checkbox"
            checked={current.sandbox.enabled}
            onChange={(event) =>
              next({
                sandbox: {
                  ...current.sandbox,
                  enabled: event.target.checked,
                },
              })
            }
          />
        </label>
        <label
          className={styles["session-config-row"]}
          data-defaults-field="sandbox-network"
        >
          <span className={styles["session-config-row-label"]}>
            {t("Sandbox network access")}
          </span>
          <input
            type="checkbox"
            checked={current.sandbox.networkAccess}
            disabled={!current.sandbox.enabled}
            onChange={(event) =>
              next({
                sandbox: {
                  ...current.sandbox,
                  networkAccess: event.target.checked,
                },
              })
            }
          />
        </label>
        <p>
          {t(
            "Re-opening a session never re-applies these defaults. They apply once, when the session is created.",
          )}
        </p>
      </div>
    </section>
  );
}
