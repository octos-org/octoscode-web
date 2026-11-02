import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./ProductSettings.module.css";

export type AppearancePreference = "system" | "light" | "dark";

export function AppearanceSettings({
  value,
  onChange,
}: {
  value: AppearancePreference;
  onChange: (value: AppearancePreference) => void;
}) {
  const t = useUiText();
  return (
    <section
      className={styles.appearanceSection}
      aria-label={t("Light / dark appearance")}
    >
      <h3>{t("Light / dark appearance")}</h3>
      <p className={styles.settingDescription}>
        {t(
          "Choose the shell appearance. This does not change server settings.",
        )}
      </p>
      <div
        className={styles.appearanceOptions}
        role="radiogroup"
        aria-label={t("Light / dark appearance")}
      >
        {(["system", "light", "dark"] as const).map((option) => (
          <label className={styles.appearanceOption} key={option}>
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option === "system"
              ? t("Auto")
              : option === "light"
                ? t("Light")
                : t("Dark")}
          </label>
        ))}
      </div>
    </section>
  );
}
