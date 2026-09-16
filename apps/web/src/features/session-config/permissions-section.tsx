/**
 * §4.2 Permissions section (judge #6): session-scoped permission presets,
 * next-message timing disclosure, and the approval-policy readback taken from
 * the session-addressed `session/status/read` runtime stamp — re-read when the
 * pane opens and after each save. "not verified" appears next to the value
 * this tab last set when the stamp does not carry the policy.
 */
import {
  PermissionControl,
  type PermissionControlProps,
} from "../product-controls/SessionControlBar.tsx";

export type PermissionSaveState =
  { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export type ApprovalPolicyValue = "on-request" | "never";

export interface PermissionsSectionProps {
  permission: PermissionControlProps | null;
  /** The stamp's `approval_policy`; null when the stamp does not carry one. */
  approvalPolicyReadback?: string | null | undefined;
  /** True when the readback line must show the not-verified qualifier. */
  approvalPolicyUnverified?: boolean | undefined;
  /** Saving / Saved / Failed feedback with retry (§7 states). */
  saveState?: PermissionSaveState | undefined;
  onRetrySave?: (() => void) | undefined;
  /** Offered when the server accepts approval_policy in permission/profile/set. */
  onApprovalPolicyChange?: ((value: ApprovalPolicyValue) => void) | undefined;
  t: (source: string, params?: Record<string, string | number>) => string;
}

export function PermissionsSection({
  permission,
  approvalPolicyReadback,
  approvalPolicyUnverified,
  saveState,
  onRetrySave,
  onApprovalPolicyChange,
  t,
}: PermissionsSectionProps) {
  return (
    <section aria-label={t("Permissions")}>
      <h3>{t("Permissions")}</h3>
      <p>
        {t(
          "Applies from your next message. A response that is already running keeps the permissions it started with.",
        )}
      </p>
      {permission ? (
        <PermissionControl {...permission} />
      ) : (
        <p>{t("Not supported by this server")}</p>
      )}
      {approvalPolicyReadback ? (
        <p>
          {t("Approval policy:")}
          <strong>{approvalPolicyReadback}</strong>
          {approvalPolicyUnverified
            ? ` ${t("Current approval policy not verified (as set here)")}`
            : null}
        </p>
      ) : null}
      {onApprovalPolicyChange ? (
        <label>
          {t("Approval policy:")}
          <select
            data-permission-approval-policy="true"
            defaultValue={approvalPolicyReadback ?? "on-request"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "on-request" || value === "never") {
                onApprovalPolicyChange(value);
              }
            }}
          >
            <option value="on-request">{t("On request")}</option>
            <option value="never">{t("Never ask")}</option>
          </select>
        </label>
      ) : null}
      {saveState?.kind === "saving" ? (
        <p role="status">{t("Saving…")}</p>
      ) : null}
      {saveState?.kind === "saved" ? <p role="status">{t("Saved")}</p> : null}
      {saveState?.kind === "failed" ? (
        <p role="alert">
          {t("Failed: {value0}", { value0: saveState.message })}{" "}
          {onRetrySave ? (
            <button type="button" onClick={onRetrySave}>
              {t("Retry")}
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
