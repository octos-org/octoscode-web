import type { TurnActivity } from "./turn-activity.ts";
import styles from "./TimelineFolds.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface TurnActivityIndicatorProps {
  activity: TurnActivity | null;
}

/**
 * The animated glyph + status word while a response is being produced
 * (TUI parity: galaxy spinner + Thinking/Running/Writing). Renders nothing
 * once the turn ends; the CSS animation respects prefers-reduced-motion.
 */
export function TurnActivityIndicator({
  activity,
}: TurnActivityIndicatorProps) {
  const t = useUiText();
  if (!activity) return null;
  // Judge #8: tool words localize through the recorded template; the tool
  // NAME is interpolated untranslated (server data, §1 copy rules).
  const word = activity.template
    ? t(activity.template, { ...activity.params })
    : t(activity.label);
  return (
    <p className="turn-activity" role="status">
      <span className={styles.activityWave}>
        <span className={styles.thinkingSpinner} aria-hidden="true">
          ◠
        </span>{" "}
        {word}
      </span>
    </p>
  );
}