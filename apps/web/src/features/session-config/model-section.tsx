/**
 * §4.2 Model section of the session settings pane (judge #6 / WEB-UX-ROUND2).
 *
 * Presentation only. Every disposition message comes from the caller's
 * notice board (use-model-selection + model-settings' noticeMessage), so this
 * file carries no protocol vocabulary and no state machine of its own.
 */
import type { Ref } from "react";
import {
  ModelControl,
  type ModelControlProps,
} from "../product-controls/SessionControlBar.tsx";
import styles from "./SessionConfig.module.css";

export interface ModelSectionProps {
  /** The pane's dialog-labelling heading id. */
  headingId: string;
  /** Focus target for the pane's initial focus (first section heading). */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  control: ModelControlProps;
  /** Saved primary from `profile/llm/list` (a saved claim, never a running claim). */
  savedProfileModel: string | null;
  /** The active response's own stamp; null/omitted while no turn runs. */
  turnModel?: string | null | undefined;
  /** Round 4 §D / spec 1188: the session's runtime model label (stamp). */
  runtimeModel?: string | null | undefined;
  /** The outstanding disposition notice line, already translated. */
  notice?: string | null | undefined;
  /** True while `profile/llm/select` is in flight (Saving…; list disabled). */
  saving?: boolean | undefined;
  /** Case 23: a list refresh proved another tab/app changed the selection. */
  externalChange?: boolean | undefined;
  t: (source: string, params?: Record<string, string | number>) => string;
}

export function ModelSection({
  headingId,
  headingRef,
  control,
  savedProfileModel,
  turnModel,
  runtimeModel,
  notice,
  saving,
  externalChange,
  t,
}: ModelSectionProps) {
  return (
    <section aria-label={t("Model")}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        {t("Model")}
      </h3>
      <p>
        {t(
          "Changing the model changes the shared profile, not just this session.",
        )}
      </p>
      <div className={styles["session-config-row"]!}>
        <span className={styles["session-config-row-label"]!}>
          {t("Saved for this profile:")}
        </span>
        <strong className={styles["session-config-row-value"]!}>
          {savedProfileModel ?? t("(no model selected)")}
        </strong>
      </div>
      {runtimeModel ? (
        <div className={styles["session-config-row"]!}>
          <span className={styles["session-config-row-label"]!}>
            {t("Session runtime")}
          </span>
          <strong className={styles["session-config-row-value"]!}>
            {runtimeModel}
          </strong>
        </div>
      ) : null}
      {turnModel ? (
        <p>
          {t("This response is using:")}
          <strong>{turnModel}</strong>
        </p>
      ) : null}
      <ModelControl {...control} />
      {saving ? <p>{t("Saving…")}</p> : null}
      {externalChange ? (
        <p role="status">{t("The selection changed in another tab or app")}</p>
      ) : null}
      {notice ? (
        <p role="status" data-model-notice="true">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
