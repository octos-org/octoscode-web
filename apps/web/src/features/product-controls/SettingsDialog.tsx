/**
 * Settings trigger and two-column shell adapted from DeepSeek Harness'
 * SettingsRoot at revision b150a551b8d465e31e418e1b2eaf5e79bbb7d28e.
 * Copyright (c) 2026 DeepSeek, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useId, useRef, type ReactNode } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { GearIcon, ModelsIcon, CloseIcon } from "../../ui/Icon.tsx";
import { settingsNavigationIntent } from "./selection-policy.ts";
import type {
  SettingsLabels,
  SettingsSectionId,
  SettingsSlots,
} from "./types.ts";
import styles from "./SettingsDialog.module.css";
import shell from "../../ui/SettingsSurface.module.css";

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
      <GearIcon size={compact ? 14 : 16} />
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
      backdropClassName={shell.overlay!}
      dialogClassName={`${shell.frame} ${styles.panel}`}
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
            <GearIcon />
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
