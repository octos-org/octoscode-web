/**
 * Settings trigger and two-column shell adapted from DeepSeek Harness'
 * SettingsRoot at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useId, useRef, type ReactNode } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { settingsNavigationIntent } from "./selection-policy.ts";
import type {
  SettingsLabels,
  SettingsSectionId,
  SettingsSlots,
} from "./types.ts";
import styles from "./SettingsDialog.module.css";

export interface SettingsTriggerProps {
  label: string;
  open: boolean;
  compact?: boolean;
  onOpen: () => void;
}

export interface SettingsDialogProps {
  open: boolean;
  activeSection: SettingsSectionId;
  labels: SettingsLabels;
  slots: SettingsSlots;
  actions?: ReactNode;
  onSectionChange: (section: SettingsSectionId) => void;
  onClose: () => void;
}

function SettingsIcon({ small = false }: { small?: boolean }) {
  const size = small ? 14 : 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6.7 1.3h2.6l.36 1.5c.4.16.79.38 1.14.65l1.48-.45 1.3 2.25-1.12 1.04c.03.24.04.47.04.71s-.01.47-.04.71l1.12 1.04-1.3 2.25-1.48-.45c-.35.27-.73.49-1.14.65l-.36 1.5H6.7l-.36-1.5a5.3 5.3 0 0 1-1.14-.65L3.72 11l-1.3-2.25 1.12-1.04A5.8 5.8 0 0 1 3.5 7c0-.24.01-.47.04-.71L2.42 5.25 3.72 3l1.48.45c.35-.27.73-.49 1.14-.65l.36-1.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="8"
        cy="3.5"
        rx="5.5"
        ry="2"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M2.5 3.5v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-4M2.5 7.5v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2v-4"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.5 3.5 7 7m0-7-7 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sidebar-footer trigger; deliberately separate from the controlled dialog. */
export function SettingsTrigger({
  label,
  open,
  compact = false,
  onOpen,
}: SettingsTriggerProps) {
  return (
    <button
      type="button"
      className={
        compact ? `${styles.trigger} ${styles.compact}` : styles.trigger
      }
      aria-label={compact ? label : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <SettingsIcon small={compact} />
      {compact ? null : <span className={styles.triggerLabel}>{label}</span>}
    </button>
  );
}

/**
 * Controlled settings shell. General and Models content are slots supplied by
 * capability-aware features; this shell owns only product navigation chrome.
 */
export function SettingsDialog({
  open,
  activeSection,
  labels,
  slots,
  actions,
  onSectionChange,
  onClose,
}: SettingsDialogProps) {
  const titleId = useId();
  const navId = useId();
  const generalId = `${navId}-general`;
  const modelsId = `${navId}-models`;
  const closeRef = useRef<HTMLButtonElement>(null);
  if (!open) return null;

  const hasModels = slots.models !== undefined;
  const effectiveSection =
    activeSection === "models" && !hasModels ? "general" : activeSection;

  const choose = (next: SettingsSectionId) => {
    const intent = settingsNavigationIntent(activeSection, next);
    if (intent !== null) onSectionChange(intent);
  };
  const activeButtonId = effectiveSection === "general" ? generalId : modelsId;
  const content = effectiveSection === "general" ? slots.general : slots.models;

  return (
    <ModalSurface
      backdropClassName={styles.overlay ?? ""}
      dialogClassName={styles.panel ?? ""}
      labelledBy={titleId}
      initialFocusRef={closeRef}
      closeOnBackdrop
      onEscape={onClose}
    >
      <nav className={styles.nav} aria-label={labels.navigation}>
        <div id={titleId} className={styles.navTitle}>
          {labels.title}
        </div>
        <div className={styles.navList}>
          <button
            id={generalId}
            type="button"
            className={
              effectiveSection === "general"
                ? `${styles.navCell} ${styles.active}`
                : styles.navCell
            }
            aria-current={effectiveSection === "general" ? "page" : undefined}
            onClick={() => choose("general")}
          >
            <SettingsIcon />
            <span className={styles.navLabel}>{labels.general}</span>
          </button>
          {hasModels ? (
            <button
              id={modelsId}
              type="button"
              className={
                effectiveSection === "models"
                  ? `${styles.navCell} ${styles.active}`
                  : styles.navCell
              }
              aria-current={effectiveSection === "models" ? "page" : undefined}
              onClick={() => choose("models")}
            >
              <ModelsIcon />
              <span className={styles.navLabel}>{labels.models}</span>
            </button>
          ) : null}
        </div>
      </nav>
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.actions}>{actions}</div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label={labels.close}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <section
          className={styles.options}
          role="tabpanel"
          aria-labelledby={activeButtonId}
          data-settings-section={effectiveSection}
        >
          {content}
        </section>
      </div>
    </ModalSurface>
  );
}
