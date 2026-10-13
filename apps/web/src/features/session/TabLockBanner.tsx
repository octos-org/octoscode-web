import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./TabLockBanner.module.css";

export interface TabLockBannerProps {
  onTakeOver: () => void;
}

/**
 * Advisory banner shown when another tab holds the session lock (#56,
 * first slice). App.submit gates dispatch while this is visible; take
 * over to regain sending.
 */
export function TabLockBanner({ onTakeOver }: TabLockBannerProps) {
  const t = useUiText();
  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>
        {t(
          "This session is open in another tab. Sending is disabled here until you take over.",
        )}
      </span>
      <button type="button" className={styles.takeOver} onClick={onTakeOver}>
        {t("Take over here")}
      </button>
    </div>
  );
}
