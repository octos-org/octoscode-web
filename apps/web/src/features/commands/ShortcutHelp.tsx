import type { ReactNode } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import { CloseButton } from "../../ui/CloseButton.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./ShortcutHelp.module.css";

export interface ShortcutHelpProps {
  /** Chat mode is on in this browser, so the help explains file outputs. */
  chat: boolean;
  onClose: () => void;
}

interface Entry {
  keys: string;
  label: string;
}

const GLOBAL_ENTRIES: readonly Entry[] = [
  { keys: "?", label: "Open this help, outside the message box" },
  { keys: "⌘K / Ctrl+K", label: "Command palette" },
  { keys: "⌘F / Ctrl+F", label: "Search conversation" },
  { keys: "Alt+A", label: "Show approval panel" },
  { keys: "Alt+P", label: "Toggle peer dock" },
  { keys: "Alt+D", label: "Focus peer dispatch" },
  {
    keys: "Esc",
    label: "Close dialog / palette; clears search query, then closes",
  },
];

const COMPOSER_ENTRIES: readonly Entry[] = [
  { keys: "Enter", label: "Steer a compatible running turn" },
  { keys: "Tab", label: "Queue the draft for after the turn" },
  { keys: "Ctrl+X", label: "Send pending input now" },
];

/** A translated sentence with each `{name}` shown as the bold UI label. */
function withLabels(
  text: string,
  labels: Readonly<Record<string, string>>,
): ReactNode[] {
  return text
    .split(/\{(\w+)\}/)
    .map((part, index) =>
      index % 2 ? <strong key={index}>{labels[part] ?? part}</strong> : part,
    );
}

/**
 * Help (#21 keyboard-first discoverability, N11a-F02): how to start a task and
 * get files back, then the keyboard shortcuts. Opened from the sidebar's Help
 * button — in the drawer on a phone — or with `?` outside text inputs and
 * dialogs. It only explains; it changes no permission.
 */
export function ShortcutHelp({ chat, onClose }: ShortcutHelpProps) {
  const t = useUiText();
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.card!}
      labelledBy="help-title"
      onEscape={onClose}
      closeOnBackdrop
    >
      <div className={styles.header}>
        <h2 className={styles.title} id="help-title">
          {t("Help")}
        </h2>
        <CloseButton label={t("Close help")} onClick={onClose} />
      </div>
      <div className={styles.body}>
        <h3 className={styles.sectionTitle}>{t("Start a task")}</h3>
        <p className={styles.text}>
          {t(
            "Pick a template on the home page, or describe the task in your own words. A template only fills in the message box, so you can edit it before sending.",
          )}
        </p>
        <h3 className={styles.sectionTitle}>{t("Get files back")}</h3>
        {chat ? (
          <ul className={styles.steps}>
            <li>
              {t("A new chat answers in the conversation and saves no files.")}
            </li>
            <li>
              {withLabels(
                t(
                  "Select {allow} to let this chat save files in its own folder. The network stays blocked, and the chat waits until the server confirms the change.",
                ),
                { allow: t("Allow file outputs") },
              )}
            </li>
            <li>
              {withLabels(
                t(
                  "{turnOff} makes the chat read-only again. Files it already saved stay.",
                ),
                { turnOff: t("Turn off file outputs") },
              )}
            </li>
          </ul>
        ) : null}
        <p className={styles.text}>
          {chat
            ? t(
                "In Code, Octos works in the folder you chose, with the permission shown under the message box. A change there applies to this session only.",
              )
            : t(
                "Octos works in the folder you chose, with the permission shown under the message box. A change there applies to this session only.",
              )}
        </p>
        <p className={styles.text}>
          {withLabels(
            t(
              "Attach files with {files} in the message box, by dragging, or by pasting: text, images, Markdown, CSV and PDF, not Office files. Your attachments and the files Octos sends or saves appear in the conversation with {preview} and {download}. Files from Octos are also listed under {outputs}.",
            ),
            {
              files: t("Files"),
              preview: t("Preview"),
              download: t("Download"),
              outputs: t("Outputs"),
            },
          )}
        </p>
        <h3 className={styles.sectionTitle}>{t("Keyboard shortcuts")}</h3>
        <dl className={styles.list}>
          {GLOBAL_ENTRIES.map((entry) => (
            <div className={styles.row} key={entry.keys}>
              <dt className={styles.keys}>{entry.keys}</dt>
              <dd className={styles.label}>{t(entry.label)}</dd>
            </div>
          ))}
        </dl>
        <h3 className={styles.sectionTitle}>{t("While a turn is running")}</h3>
        <dl className={styles.list}>
          {COMPOSER_ENTRIES.map((entry) => (
            <div className={styles.row} key={entry.keys}>
              <dt className={styles.keys}>{entry.keys}</dt>
              <dd className={styles.label}>{t(entry.label)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </ModalSurface>
  );
}
