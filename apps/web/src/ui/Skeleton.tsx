import styles from "./Skeleton.module.css";

/**
 * Layout-matched loading placeholder (tasteskill: skeletons over spinners).
 * Purely decorative — pair it with a visually-hidden status label.
 */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.rows} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.row} />
      ))}
    </div>
  );
}
