import { BrowserPreferencesContent } from "../preferences/PreferencesDialog.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./ProductSettings.module.css";

export function BrowserPreferencesSettings() {
  const t = useUiText();
  return (
    <section
      className={styles.browserPreferencesSection}
      aria-label={t("Browser preferences")}
    >
      <h3>{t("Browser preferences")}</h3>
      <BrowserPreferencesContent />
    </section>
  );
}
