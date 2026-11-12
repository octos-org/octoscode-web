import type { WorkMode } from "@octos-org/octoscode-client/protocol";
import { useUiLanguage, useUiText } from "../preferences/ui-text.tsx";
import { WORK_MODE_NAMES } from "./work-mode.ts";
import { MenuIcon } from "../../ui/ShellIcons.tsx";
import styles from "./ModeHome.module.css";

interface ModeHomeProps {
  mode: WorkMode;
  /** Chats the list shows; Chat's home only points at them for now. */
  chatCount: number;
  compact: boolean;
  sidebarOpen: boolean;
  onOpenSessions: () => void;
  newSessionAvailable: boolean;
  onNewSession: () => void;
  navigationTriggerClassName: string;
}

/**
 * What a mode shows when it has no Session of its own selected. The Session
 * that was open stays open behind it, untouched, for the other mode.
 */
export function ModeHome({
  mode,
  chatCount,
  compact,
  sidebarOpen,
  onOpenSessions,
  newSessionAvailable,
  onNewSession,
  navigationTriggerClassName,
}: ModeHomeProps) {
  const t = useUiText();
  const title = WORK_MODE_NAMES[useUiLanguage()][mode];
  return (
    <div className={`conversation ${styles.pane}`}>
      <header className="conversation-header">
        {compact ? (
          <button
            type="button"
            className={navigationTriggerClassName}
            aria-label={t("Open sessions")}
            aria-haspopup="dialog"
            aria-expanded={sidebarOpen}
            onClick={onOpenSessions}
          >
            <MenuIcon size={20} />
          </button>
        ) : null}
      </header>
      <section className={styles.body} aria-labelledby="mode-home-title">
        <h1 id="mode-home-title">{title}</h1>
        {mode === "chat" ? (
          <p>
            {chatCount > 0
              ? t("Choose a chat from the list.")
              : t("No chats yet.")}
          </p>
        ) : (
          <>
            <p>{t("Choose a session from the list, or start a new one.")}</p>
            {newSessionAvailable ? (
              <button type="button" onClick={onNewSession}>
                {t("New session")}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
