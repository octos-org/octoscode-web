import { useId } from "react";
import type { WorkMode } from "@octos-org/octoscode-client/protocol";
import { useUiLanguage, useUiText } from "../preferences/ui-text.tsx";
import { WORK_MODE_NAMES } from "./work-mode.ts";
import styles from "./WorkModeSwitch.module.css";

interface WorkModeSwitchProps {
  mode: WorkMode;
  /** The server keeps every chat in its own workspace and lists chats. */
  chatAvailable: boolean;
  onModeChange: (mode: WorkMode) => void;
}

/**
 * Chat / Code at the top of the sidebar. Switching only changes which list
 * and which Session is on screen: it never sends a permission or profile
 * change. Without the server's chat support Chat stays visible but off, and
 * says why, instead of opening a chat in a shared folder.
 */
export function WorkModeSwitch({
  mode,
  chatAvailable,
  onModeChange,
}: WorkModeSwitchProps) {
  const t = useUiText();
  const names = WORK_MODE_NAMES[useUiLanguage()];
  const noteId = useId();
  const choose = (next: WorkMode) => {
    if (next === mode || (next === "chat" && !chatAvailable)) return;
    onModeChange(next);
  };
  return (
    <div className={styles.root}>
      <div className={styles.switch} role="group" aria-label={t("Work mode")}>
        <button
          type="button"
          aria-pressed={mode === "chat"}
          aria-disabled={chatAvailable ? undefined : true}
          aria-describedby={chatAvailable ? undefined : noteId}
          onClick={() => choose("chat")}
        >
          {names.chat}
        </button>
        <button
          type="button"
          aria-pressed={mode === "code"}
          onClick={() => choose("code")}
        >
          {names.code}
        </button>
      </div>
      {chatAvailable ? null : (
        <p id={noteId} className={styles.note}>
          {t(
            "Chat needs a server that gives every chat its own folder. This server does not yet.",
          )}
        </p>
      )}
    </div>
  );
}
