import styles from "./tab-lock-banner.module.css";

export interface TabLockBannerProps {
  onTakeOver: () => void;
}

/**
 * Advisory banner shown when another tab holds the session lock (#56,
 * first slice). Editing is not gated yet — this only informs.
 */
export function TabLockBanner({ onTakeOver }: TabLockBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>
        This session is also open in another tab. Inputs here may conflict with
        it.
      </span>
      <button type="button" className={styles.takeOver} onClick={onTakeOver}>
        Take over here
      </button>
    </div>
  );
}
