/**
 * Provider-grouped settings treatment adapted from DeepSeek Harness' Models
 * section at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek. MIT License; see THIRD_PARTY_NOTICES.md.
 */
import type {
  ControlState,
  ModelProviderGroup,
  ModelSelection,
} from "../product-controls/types.ts";
import styles from "./ProductSettings.module.css";

export type ModelsCapabilityState = ControlState;

export interface ModelsSettingsContentProps {
  state: ModelsCapabilityState;
  groups: readonly ModelProviderGroup[];
  selected: ModelSelection | null;
  runtimeModel: string | null;
  restartRequired: boolean;
  selectionEnabled: boolean;
  locked: boolean;
  onRefresh: () => void;
  onSelect: (selection: ModelSelection) => void;
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m3.4 8.2 2.8 2.8 6.4-6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.45 4.85A5 5 0 1 0 12 7M11.45 4.85V1.8m0 3.05H8.4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isSelected(
  providerId: string,
  modelId: string,
  selected: ModelSelection | null,
): boolean {
  return selected?.providerId === providerId && selected.modelId === modelId;
}

/**
 * Controlled Models-settings slot. Capability state and model identity are
 * projections supplied by the product adapter, never discovered here.
 */
export function ModelsSettingsContent({
  state,
  groups,
  selected,
  runtimeModel,
  restartRequired,
  selectionEnabled,
  locked,
  onRefresh,
  onSelect,
}: ModelsSettingsContentProps) {
  const ready = state.status === "ready";
  const empty = ready && groups.every((group) => group.models.length === 0);
  const selectedName = groups
    .find((group) => group.id === selected?.providerId)
    ?.models.find((model) => model.id === selected?.modelId)?.name;
  const runtimeName = runtimeModel?.trim() || null;

  return (
    <div
      className={styles.modelsSection}
      data-product-settings="models"
      aria-busy={state.status === "loading"}
    >
      <div className={styles.sectionHeading}>
        <div className={styles.headingCopy}>
          <h2 className={styles.sectionTitle}>Profile model</h2>
          <p className={styles.sectionIntro}>
            Sets the default for the active Octos profile and affects every
            Session using that profile. This is not a Session-only override.
          </p>
        </div>
        {ready ? (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={locked}
            onClick={onRefresh}
          >
            <RefreshIcon />
            Refresh
          </button>
        ) : null}
      </div>

      <div className={styles.modelTruth}>
        <span>
          <strong>Session runtime</strong>
          {runtimeName ?? "Not reported by this server"}
        </span>
        <span>
          <strong>Profile default</strong>
          {selectedName ?? "Not reported by this server"}
        </span>
      </div>

      {restartRequired ? (
        <div className={styles.restartNotice} role="status">
          Profile default is {selectedName ?? "saved"}. This Octos process is
          still serving {runtimeName ?? "its current runtime model"}. Restart
          Octos to apply the new default.
        </div>
      ) : null}

      {state.status === "unavailable" ? (
        <div className={styles.emptyState}>
          This Octos server does not advertise profile model management.
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className={styles.emptyState} role="status">
          Loading models…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className={styles.errorState} role="alert">
          <span>{state.message}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={locked}
            onClick={onRefresh}
          >
            Try again
          </button>
        </div>
      ) : null}

      {empty ? (
        <div className={styles.emptyState}>No models are available.</div>
      ) : null}

      {ready && !empty && !selectionEnabled ? (
        <div className={styles.emptyState}>
          Profile defaults are read-only on this server.
        </div>
      ) : null}

      {ready && !empty ? (
        <div
          className={styles.providerList}
          role={selectionEnabled ? "radiogroup" : "group"}
          aria-label={
            selectionEnabled
              ? "Profile default model"
              : "Configured profile models"
          }
        >
          {groups.map((group) => (
            <section className={styles.providerCard} key={group.id}>
              <h3 className={styles.providerName}>{group.name}</h3>
              <div className={styles.modelList}>
                {group.models.map((model) => {
                  const checked = isSelected(group.id, model.id, selected);
                  const disabled = locked || !model.available;
                  const className = checked
                    ? `${styles.modelRow} ${styles.modelSelected}`
                    : styles.modelRow;
                  const content = (
                    <>
                      <span className={styles.modelCopy}>
                        <span className={styles.modelName}>{model.name}</span>
                        {model.description || model.unavailableReason ? (
                          <span className={styles.modelDescription}>
                            {model.available
                              ? model.description
                              : model.unavailableReason}
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.modelCheck}>
                        {checked ? <CheckIcon /> : null}
                      </span>
                    </>
                  );
                  return selectionEnabled ? (
                    <button
                      key={model.id}
                      type="button"
                      className={className}
                      role="radio"
                      aria-checked={checked}
                      disabled={disabled}
                      onClick={() => {
                        if (!checked && !disabled) {
                          onSelect({ providerId: group.id, modelId: model.id });
                        }
                      }}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={model.id}
                      className={`${className} ${styles.modelReadOnly}`}
                      data-profile-default={checked ? "true" : undefined}
                      aria-disabled={!model.available || undefined}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
