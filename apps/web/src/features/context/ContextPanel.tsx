import {
  APPUI_CONTEXT_METHODS,
  supportsMethod,
  type ContextSnapshot,
  type TokenCostUpdate,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { contextUsage } from "./model.ts";
import styles from "./ContextPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface ContextPanelProps {
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  snapshot: ContextSnapshot | null;
  usage: TokenCostUpdate | null;
  busy?: boolean;
  error?: string | null;
  mode?: "llm" | "heuristic" | null;
  onCompact: () => void;
  onModeChange: (mode: "llm" | "heuristic") => void;
}

/** Runtime-owned lifecycle and cache facts. No transcript/prompt material is rendered. */
export function ContextPanel({
  sessionId,
  capabilities,
  snapshot: providedSnapshot,
  usage: providedUsage,
  busy = false,
  error,
  mode,
  onCompact,
  onModeChange,
}: ContextPanelProps) {
  const t = useUiText();
  const snapshot =
    providedSnapshot?.state.session_id === sessionId ? providedSnapshot : null;
  const usage = providedUsage?.sessionId === sessionId ? providedUsage : null;
  const occupancy = contextUsage(snapshot, usage);
  const compactAvailable = supportsMethod(
    capabilities,
    APPUI_CONTEXT_METHODS.COMPACT,
  );
  const modeAvailable = supportsMethod(
    capabilities,
    APPUI_CONTEXT_METHODS.SET_MODE,
  );
  const state = snapshot?.state;
  const compaction = snapshot?.lastCompaction;
  return (
    <section className={styles.root} aria-label={t("Context and cache")}>
      <h3>{t("Context and cache")}</h3>
      {state ? (
        <dl className={styles.facts}>
          <div>
            <dt>{t("Context estimate")}</dt>
            <dd>
              {state.token_estimate.toLocaleString()}
              {" " + t("tokens ·")} {state.item_count.toLocaleString()}
              {" " + t("items")}
            </dd>
          </div>
          <div>
            <dt>{t("Generation")}</dt>
            <dd>{state.generation}</dd>
          </div>
          <div>
            <dt>{t("Recovery")}</dt>
            <dd>{state.recovery_state}</dd>
          </div>
          {state.cache_epoch_id ? (
            <div>
              <dt>{t("Cache epoch")}</dt>
              <dd>{state.cache_epoch_id}</dd>
            </div>
          ) : null}
          {state.last_cache_invalidation_reason ? (
            <div>
              <dt>{t("Last cache invalidation")}</dt>
              <dd>{state.last_cache_invalidation_reason}</dd>
            </div>
          ) : null}
          {state.semantic_head_kind ? (
            <div>
              <dt>{t("Semantic boundary")}</dt>
              <dd>{state.semantic_head_kind}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className={styles.muted}>
          {t("Context lifecycle has not been reported by this server.")}
        </p>
      )}
      {occupancy.percent !== null ? (
        <label className={styles.meter}>
          {t("Context window used:") + " "}
          {occupancy.percent}
          {t("% of")} {occupancy.window?.toLocaleString()}
          <progress
            aria-label={t("Context window used")}
            max={100}
            value={occupancy.percent}
          />
        </label>
      ) : null}
      <dl className={styles.facts}>
        <div>
          <dt>{t("Provider cache read")}</dt>
          <dd>
            {usage?.cacheReadTokens === undefined
              ? t("Not reported")
              : t("{value0} tokens", {
                  value0: String(usage.cacheReadTokens.toLocaleString()),
                })}
          </dd>
        </div>
        <div>
          <dt>{t("Provider cache write")}</dt>
          <dd>
            {usage?.cacheWriteTokens === undefined
              ? t("Not reported")
              : t("{value0} tokens", {
                  value0: String(usage.cacheWriteTokens.toLocaleString()),
                })}
          </dd>
        </div>
      </dl>
      {snapshot?.compacting ? (
        <p role="status">
          {t("Compacting context ·") + " "}
          {snapshot.compacting.trigger}
        </p>
      ) : compaction ? (
        <p role="status">
          {t("Last compaction:") + " "}
          {compaction.status} ·{" "}
          {compaction.token_estimate_before.toLocaleString()} →{" "}
          {compaction.token_estimate_after?.toLocaleString() ??
            t("not reported")}{" "}
          {t("tokens")}
          {compaction.error ? ` · ${compaction.error}` : ""}
        </p>
      ) : null}
      {snapshot?.lastNormalization ? (
        <p className={styles.muted}>
          {t("Prompt normalization:")}{" "}
          {snapshot.lastNormalization.prompt_message_count}
          {" " + t("messages;")} {snapshot.lastNormalization.repaired_count}
          {" " + t("repaired;")} {snapshot.lastNormalization.dropped_count}
          {" " + t("dropped.")}
        </p>
      ) : null}
      {compactAvailable || modeAvailable ? (
        <div className={styles.controls}>
          {compactAvailable ? (
            <button
              type="button"
              disabled={busy || Boolean(snapshot?.compacting)}
              onClick={onCompact}
            >
              {busy ? t("Updating…") : t("Compact context")}
            </button>
          ) : null}
          {modeAvailable ? (
            <label>
              {t("Compaction mode")}{" "}
              <select
                aria-label={t("Compaction mode")}
                value={mode ?? ""}
                disabled={busy || Boolean(snapshot?.compacting)}
                onChange={(event) => {
                  if (
                    event.target.value === "llm" ||
                    event.target.value === "heuristic"
                  )
                    onModeChange(event.target.value);
                }}
              >
                <option value="" disabled>
                  {t("Not reported")}
                </option>
                <option value="llm">{t("Model summary")}</option>
                <option value="heuristic">{t("Deterministic")}</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
