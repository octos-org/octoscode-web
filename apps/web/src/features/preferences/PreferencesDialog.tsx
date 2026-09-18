import { useId, useState } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { DISPLAY_THEMES, isDisplayTheme, isUiLanguage } from "./model.ts";
import { usePreferences } from "./preferences.tsx";
import { useUiText } from "./ui-text.tsx";
import styles from "./PreferencesDialog.module.css";
import { CloseButton } from "../../ui/CloseButton.tsx";

const themeLabels = {
  terminal: "Terminal",
  codex: "Codex",
  claude: "Claude",
  slate: "Slate",
  solarized: "Solarized",
} as const;

/** Imported lazily by the application; no rendering/highlighter code in the hot store. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const preferences = usePreferences();
  const t = useUiText();
  const id = useId();
  const [saved, setSaved] = useState(false);
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={`${id}-title`}
      describedBy={`${id}-scope`}
      onEscape={onClose}
      closeOnBackdrop
    >
      <header className={styles.header}>
        <h2 id={`${id}-title`}>{t("Browser preferences")}</h2>
        <CloseButton label={t("Close preferences")} onClick={onClose} />
      </header>
      <p id={`${id}-scope`} className={styles.note}>
        {t(
          "Display settings apply immediately. Save remembers them only in this browser; no server configuration, credentials or conversations are stored.",
        )}
      </p>
      <div className={styles.fields}>
        <label>
          {t("Language")}
          <select
            value={preferences.language}
            onChange={(event) => {
              if (isUiLanguage(event.target.value))
                preferences.setLanguage(event.target.value);
            }}
          >
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </label>
        <label>
          {t("Theme")}
          <select
            value={preferences.theme}
            onChange={(event) => {
              if (isDisplayTheme(event.target.value))
                preferences.setTheme(event.target.value);
            }}
          >
            {DISPLAY_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(themeLabels[theme])}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.note}>
          {t(
            "Terminal follows your browser’s light or dark appearance. Named palettes also update code highlighting.",
          )}
        </p>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={preferences.vimMode}
            onChange={(event) => preferences.setVimMode(event.target.checked)}
          />
          {t("Vim editing")}
        </label>
        <p className={styles.note}>
          {t("Use Vim-style normal and insert modes in the composer.")}
        </p>
      </div>
      {preferences.error && <p role="alert">{t(preferences.error)}</p>}
      <p role="status" className={styles.note}>
        {preferences.dirty
          ? t("Unsaved browser preferences.")
          : saved
            ? t("Browser preferences saved.")
            : ""}
      </p>
      <footer className={styles.actions}>
        <button type="button" onClick={() => setSaved(preferences.save())}>
          {t("Save browser preferences")}
        </button>
      </footer>
    </ModalSurface>
  );
}

export default PreferencesDialog;
