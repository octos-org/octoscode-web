/**
 * §4.2: the session configuration pane — a ModalSurface drawer with Model,
 * Permissions, Sandbox and Advanced sections. Presentation only: every
 * mutation flows through caller-held controls (use-model-selection,
 * permission hooks, seat hooks).
 */
import { useId, useRef, type ReactNode } from "react";
import { ModelSection } from "./model-section.tsx";
import { PermissionsSection } from "./permissions-section.tsx";
import { SandboxSection } from "./sandbox-section.tsx";
import type { ModelSectionProps } from "./model-section.tsx";
import type { PermissionsSectionProps } from "./permissions-section.tsx";
import type { SandboxSectionProps } from "./sandbox-section.tsx";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import { REASONING_COPY } from "../reasoning/reasoning-copy.ts";
import styles from "./SessionConfig.module.css";
import { CloseButton } from "../../ui/CloseButton.tsx";
import {
  type ModelControlProps,
  type PermissionControlProps,
} from "../product-controls/SessionControlBar.tsx";

/** The `profile/llm/select` result, mapped one-to-one (§4.2 Model). */
export type ModelSelectDisposition =
  | "reloaded"
  | "deferred"
  | "restart_required"
  | "persisted_but_not_live"
  | "unchanged"
  | "refused";

export interface SessionModelResult {
  /** The saved selection's human label, for result messages. */
  selection: string;
}

export interface DispositionNoticeInput {
  disposition: ModelSelectDisposition;
  saved?: SessionModelResult | undefined;
  /** `deferred` condition, when the server returned one. */
  condition?: string | undefined;
  /** The model the boot snapshot keeps serving (`restart_required`). */
  running?: string | undefined;
  /** `persisted_but_not_live` runtime_error. */
  runtimeError?: string | undefined;
  /** A refused save's server reason. */
  reason?: string | undefined;
}

/** Pure mapping of a select result to its exact user-facing message. */
export function dispositionNotice(
  input: DispositionNoticeInput,
  t: (source: string, params?: Record<string, string | number>) => string = (
    source,
    params,
  ) =>
    params
      ? source.replace(/\{([^{}]+)\}/g, (token, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name)
            ? String(params[name])
            : token,
        )
      : source,
): string {
  switch (input.disposition) {
    case "reloaded":
      return t("Saved. Your next message uses {value0}", {
        value0: input.saved?.selection ?? t("the new model"),
      });
    case "deferred":
      return input.condition
        ? t("Saved. The model is not active yet ({value0})", {
            value0: input.condition,
          })
        : t("Saved. The model is not active yet");
    case "restart_required":
      return t("Saved. The server keeps running {value0} until it restarts", {
        value0: input.running ?? t("the previous model"),
      });
    case "persisted_but_not_live":
      return t("Saved, but not usable right now: {value0}", {
        value0: input.runtimeError ?? t("the runtime could not start"),
      });
    case "unchanged":
      return t("Already selected");
    case "refused":
      return t("Couldn't save: {value0}", {
        value0: input.reason ?? t("the server refused the change"),
      });
  }
}

export interface SessionSandboxProjection {
  /** Feature `session.sandbox.v1` advertised. */
  supported: boolean;
  /** Effective values summary; null when unsupported or unknown. */
  summary: string | null;
}

export interface SessionAdvancedProjection {
  present: boolean;
  /** Who controls this session, in words. */
  controller?: string | undefined;
  /** Raw binding facts (maintainer section; protocol terms allowed here). */
  bindingOwner?: string | undefined;
  epoch?: number | undefined;
  leaseExpiry?: string | null | undefined;
  /** The driver seat / controller console, mounted as the section body. */
  advancedChildren?: ReactNode | undefined;
  /**
   * §5.2 case 3: a foreign/parked holder owns the session and chat is
   * refused; Advanced offers Resume chat (acquire → release(internal) → the
   * parked prompt is sent once by the caller).
   */
  foreignSeatHeld?: boolean | undefined;
  resumeChatBusy?: boolean | undefined;
  resumeChatNotice?: string | null | undefined;
  onResumeChat?: (() => void) | undefined;
}

export interface SessionConfigPaneProps {
  open: boolean;
  onClose: () => void;
  /**
   * §4.2 "Banner at the top when another controller holds the session" +
   * Round 3 item 3: the foreign-holder words and the Resume chat control
   * mounted BEFORE Model — where the operator lands when they open the pane —
   * not only inside Advanced.
   */
  holderBanner?: {
    readonly foreignSeatHeld: boolean;
    /**
     * Round 4 §B: THIS tab's own peer controller holds the session (we
     * acquired for Start). Own-hold copy, never "Another app…", and no
     * Resume chat — §4.3/§5.2 reserve that for a foreign holder.
     */
    readonly ownSeatHeld?: boolean | undefined;
    readonly resumeChatBusy?: boolean | undefined;
    readonly resumeChatNotice?: string | null | undefined;
    readonly onResumeChat?: (() => void) | undefined;
  } | null;
  /** Reuses use-model-selection's projected control. */
  model: ModelControlProps;
  /** Round 3 item 4: config-07's sections, mounted in place of the inline ones. */
  modelSection?: Omit<
    ModelSectionProps,
    "headingId" | "headingRef" | "t"
  > | null;
  permissionsSection?: Omit<PermissionsSectionProps, "t"> | null;
  sandboxSection?: Omit<SandboxSectionProps, "t"> | null;
  /** Saved primary from `profile/llm/list`. */
  savedProfileModel: string | null;
  /** The running turn's own stamp, or null when no turn runs. */
  turnModel?: string | null | undefined;
  /** Round 4 §D / spec 1188: the session's runtime model label. */
  runtimeModel?: string | null | undefined;
  /** The outstanding disposition notice (persisted by the caller). */
  notice?: string | null | undefined;
  /** Reuses the existing permission control. */
  permission: PermissionControlProps | null;
  /** Approval-policy readback line (session/status/read stamp). */
  approvalPolicyReadback?: string | null | undefined;
  /** True when the readback shows this tab's last value without verification. */
  approvalPolicyUnverified?: boolean | undefined;
  sandbox: SessionSandboxProjection;
  /** UX5: the Show thinking row; absent = the row is not rendered. */
  showThinking?: boolean | undefined;
  onShowThinkingChange?: ((value: boolean) => void) | undefined;
  advanced: SessionAdvancedProjection;
  /** §4.2 Advanced collapsed by default, remembered per browser. */
  advancedOpen?: boolean | undefined;
  onAdvancedOpenChange?: ((open: boolean) => void) | undefined;
}

export function SessionConfigPane({
  open,
  onClose,
  holderBanner = null,
  model,
  modelSection = null,
  permissionsSection = null,
  sandboxSection = null,
  savedProfileModel,
  turnModel,
  runtimeModel,
  notice,
  permission,
  approvalPolicyReadback,
  approvalPolicyUnverified,
  sandbox,
  showThinking,
  onShowThinkingChange,
  advanced,
  advancedOpen = false,
  onAdvancedOpenChange,
}: SessionConfigPaneProps) {
  const t = useUiText();
  const titleId = useId();
  const modelHeadingRef = useRef<HTMLHeadingElement>(null);
  if (!open) return null;
  return (
    <ModalSurface
      backdropClassName={styles["session-config-backdrop"]!}
      dialogClassName={styles["session-config-pane"]!}
      labelledBy={titleId}
      initialFocusRef={modelHeadingRef}
      onEscape={onClose}
    >
      <header className={styles["session-config-header"]!}>
        <h2 id={titleId}>{t("Session settings")}</h2>
        <CloseButton label={t("Close")} onClick={onClose} />
      </header>
      <div className="session-config-body">
        {holderBanner?.foreignSeatHeld ? (
          <section
            className={`${styles["session-config-section"]!} ${styles["session-config-holder-banner"]!}`}
            data-session-config-banner="holder"
            role="status"
          >
            <h3>{t("Another app is using this session")}</h3>
            {holderBanner.resumeChatNotice ? (
              <p>{holderBanner.resumeChatNotice}</p>
            ) : null}
            {holderBanner.onResumeChat ? (
              <button
                type="button"
                className={styles["session-config-button"]!}
                data-session-config-action="resume-chat"
                disabled={holderBanner.resumeChatBusy}
                onClick={() => holderBanner.onResumeChat?.()}
              >
                {holderBanner.resumeChatBusy
                  ? t("Resuming chat…")
                  : t("Resume chat")}
              </button>
            ) : null}
          </section>
        ) : null}
        {holderBanner?.ownSeatHeld && !holderBanner.foreignSeatHeld ? (
          <section
            className={`${styles["session-config-section"]!} ${styles["session-config-holder-banner"]!}`}
            data-session-config-banner="own-hold"
            role="status"
          >
            <h3>{t("A peer you started is using this session")}</h3>
            <p>
              {t(
                "It keeps running while you chat. Chat sends hand control back first.",
              )}
            </p>
          </section>
        ) : null}
        <ModelSection
          headingId={`${titleId}-model`}
          headingRef={modelHeadingRef}
          control={modelSection?.control ?? model}
          savedProfileModel={
            modelSection?.savedProfileModel ?? savedProfileModel
          }
          {...(modelSection?.turnModel !== undefined
            ? { turnModel: modelSection.turnModel }
            : turnModel !== null && turnModel !== undefined
              ? { turnModel }
              : {})}
          {...(modelSection?.runtimeModel !== undefined
            ? { runtimeModel: modelSection.runtimeModel }
            : runtimeModel !== null && runtimeModel !== undefined
              ? { runtimeModel }
              : {})}
          {...(modelSection?.notice !== undefined
            ? { notice: modelSection.notice }
            : notice !== null && notice !== undefined
              ? { notice }
              : {})}
          {...(modelSection?.saving !== undefined
            ? { saving: modelSection.saving }
            : {})}
          {...(modelSection?.externalChange !== undefined
            ? { externalChange: modelSection.externalChange }
            : {})}
          t={t}
        />
        <PermissionsSection
          permission={permissionsSection?.permission ?? permission}
          {...(permissionsSection?.approvalPolicyReadback !== undefined
            ? {
                approvalPolicyReadback:
                  permissionsSection.approvalPolicyReadback,
              }
            : approvalPolicyReadback !== null &&
                approvalPolicyReadback !== undefined
              ? { approvalPolicyReadback }
              : {})}
          {...(permissionsSection?.approvalPolicyUnverified !== undefined
            ? {
                approvalPolicyUnverified:
                  permissionsSection.approvalPolicyUnverified,
              }
            : approvalPolicyUnverified !== undefined
              ? { approvalPolicyUnverified }
              : {})}
          {...(permissionsSection?.saveState !== undefined
            ? { saveState: permissionsSection.saveState }
            : {})}
          {...(permissionsSection?.onRetrySave !== undefined
            ? { onRetrySave: permissionsSection.onRetrySave }
            : {})}
          {...(permissionsSection?.onApprovalPolicyChange !== undefined
            ? {
                onApprovalPolicyChange:
                  permissionsSection.onApprovalPolicyChange,
              }
            : {})}
          t={t}
        />
        <SandboxSection
          supported={sandboxSection?.supported ?? sandbox.supported}
          {...(sandboxSection?.effective !== undefined
            ? { effective: sandboxSection.effective }
            : sandbox.summary !== null && sandbox.summary !== undefined
              ? {
                  // Legacy callers passed a pre-rendered summary; surface it
                  // as the read-paths line so the copy stays visible.
                  effective: {
                    enabled: true,
                    networkAccess: null,
                    readAllowPaths: [sandbox.summary],
                  },
                }
              : {})}
          {...(sandboxSection?.onNewSessionWith !== undefined
            ? { onNewSessionWith: sandboxSection.onNewSessionWith }
            : {})}
          t={t}
        />
        {onShowThinkingChange ? (
          <section
            className={styles["session-config-section"]!}
            aria-label={t("Show thinking")}
          >
            <h3>{t("Show thinking")}</h3>
            <label className={styles["session-config-switch"]!}>
              <input
                type="checkbox"
                checked={showThinking ?? true}
                onChange={(event) => onShowThinkingChange(event.target.checked)}
              />
              {t(REASONING_COPY.en.paneHint)}
            </label>
          </section>
        ) : null}
        <details
          className={`session-config-advanced${advancedOpen ? " session-config-advanced-open" : ""}`}
          data-session-config-advanced="true"
          open={advancedOpen}
          onToggle={(event) => {
            const next = (event.target as HTMLDetailsElement).open;
            // §4.2: collapsed by default, remembered per browser. The native
            // details/summary keeps keyboard + click operable (walkthrough
            // defect 3); React's `open` is controlled so a stale re-render
            // cannot silently re-close it mid-interaction.
            if (next !== advancedOpen) onAdvancedOpenChange?.(next);
          }}
        >
          <summary data-session-config-advanced-summary="true">
            {t("Advanced")}
          </summary>
          {advanced.present ? (
            <div>
              <h4>{t("Who controls this session")}</h4>
              <p>{advanced.controller ?? t("Nobody")}</p>
              {advanced.foreignSeatHeld ? (
                <p role="status">{t("Another app is using this session")}</p>
              ) : null}
              {advanced.foreignSeatHeld && advanced.onResumeChat ? (
                <button
                  type="button"
                  data-session-config-action="resume-chat"
                  disabled={advanced.resumeChatBusy}
                  onClick={() => advanced.onResumeChat?.()}
                >
                  {advanced.resumeChatBusy
                    ? t("Resuming chat…")
                    : t("Resume chat")}
                </button>
              ) : null}
              {advanced.resumeChatNotice ? (
                <p role="alert">{advanced.resumeChatNotice}</p>
              ) : null}
              {advanced.bindingOwner ? (
                <dl>
                  <div>
                    <dt>{t("Binding owner")}</dt>
                    <dd>{advanced.bindingOwner}</dd>
                  </div>
                  {advanced.epoch !== undefined ? (
                    <div>
                      <dt>{t("Epoch")}</dt>
                      <dd>{String(advanced.epoch)}</dd>
                    </div>
                  ) : null}
                  {advanced.leaseExpiry ? (
                    <div>
                      <dt>{t("Lease expiry")}</dt>
                      <dd>{advanced.leaseExpiry}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {advanced.advancedChildren}
            </div>
          ) : null}
        </details>
      </div>
    </ModalSurface>
  );
}
