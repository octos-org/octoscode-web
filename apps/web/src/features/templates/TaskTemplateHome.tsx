import { useId } from "react";
import type { UiLanguage } from "../preferences/model.ts";
import { EyeIcon, PencilIcon } from "../../ui/Icon.tsx";
import {
  TASK_TEMPLATES,
  TASK_TEMPLATE_CATEGORIES,
  findTaskTemplate,
  type TaskTemplate,
  type TaskTemplateAccess,
  type TaskTemplateCategory,
} from "./task-templates.ts";
import styles from "./TaskTemplateHome.module.css";

interface HomeCopy {
  heading: string;
  sessionLead: string;
  chooserHeading: string;
  chooserLead: string;
  categories: Record<TaskTemplateCategory, string>;
  access: Record<TaskTemplateAccess, string>;
  example: string;
  use: string;
  resume: string;
  applied: string;
  undo: string;
  pending: string;
  cancel: string;
  needsWrite: string;
  allowWrite: string;
  readSwitching: string;
  restoreSwitching: string;
}

const COPY: Record<UiLanguage, HomeCopy> = {
  en: {
    heading: "What can Octos help with?",
    sessionLead:
      "Working in {workspace}. Start from a template, or describe the task below.",
    chooserHeading: "Or start from a template",
    chooserLead:
      "Pick one, then choose a folder above. The request goes into the message box for you to edit.",
    categories: { code: "Code", general: "General" },
    access: { read: "Reads only", write: "Edits files" },
    example: "Example result",
    use: "Use this",
    resume: "Continue where you left off",
    applied:
      "“{title}” is in the message box. Fill in the bracketed parts, then send.",
    undo: "Undo",
    pending: "“{title}” is ready. Choose a folder to start.",
    cancel: "Cancel",
    needsWrite: "This template edits files, but this session is read-only.",
    allowWrite: "Switch to workspace write",
    readSwitching: "Switching to read-only before this template can send…",
    restoreSwitching: "Restoring the previous permission…",
  },
  zh: {
    heading: "想让 Octos 帮你做什么？",
    sessionLead:
      "在 {workspace} 里工作。挑一个模板改改，或者直接在下面写需求。",
    chooserHeading: "也可以先挑一个模板",
    chooserLead: "选好后在上面选文件夹，需求会填进输入框，改好再发送。",
    categories: { code: "编程", general: "通用" },
    access: { read: "只读", write: "会改文件" },
    example: "示例结果",
    use: "做同款",
    resume: "继续上次的会话",
    applied: "已把「{title}」填进输入框，改好【】里的内容再发送。",
    undo: "撤销",
    pending: "已选「{title}」，选好文件夹就开始。",
    cancel: "取消",
    needsWrite: "这个模板会改文件，但当前会话是只读。",
    allowWrite: "切换到工作区写入",
    readSwitching: "正在切换到只读，确认后才会发送…",
    restoreSwitching: "正在恢复模板前的权限…",
  },
};

function fill(text: string, values: Record<string, string>): string {
  return text.replace(
    /\{(\w+)\}/g,
    (token, name: string) => values[name] ?? token,
  );
}

export interface TemplateNotice {
  kind: "applied" | "pending";
  templateId: string;
  /** Applied only, and only while the message box still holds the template. */
  onUndo?: (() => void) | undefined;
  /** Pending only: drop the selection before a folder is chosen. */
  onCancel?: (() => void) | undefined;
}

export interface ResumeTarget {
  workspace: string;
  lastOpenedAt: number;
  onOpen: () => void;
}

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
];

/** "3 hours ago" / "3 小时前"; older than a week reads as a date. */
export function formatOpenedAt(
  timestamp: number,
  language: UiLanguage,
  now = Date.now(),
): string {
  const locale = language === "zh" ? "zh-CN" : "en";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed >= 7 * 86_400_000) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(timestamp);
  }
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < 60_000) return format.format(0, "second");
  const [unit, size] =
    [...RELATIVE_STEPS].reverse().find(([, step]) => elapsed >= step) ??
    RELATIVE_STEPS[0]!;
  return format.format(-Math.floor(elapsed / size), unit);
}

export function ResumeSessionLink({
  language,
  target,
}: {
  language: UiLanguage;
  target: ResumeTarget;
}) {
  const copy = COPY[language];
  return (
    <button type="button" className={styles.resume} onClick={target.onOpen}>
      <span className={styles.resumeLabel}>{copy.resume}</span>
      <span className={styles.resumeDetail}>
        {`${target.workspace} · ${formatOpenedAt(target.lastOpenedAt, language)}`}
      </span>
      <svg
        className={styles.resumeArrow}
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 8h10M9 4l4 4-4 4" />
      </svg>
    </button>
  );
}

export interface TaskTemplateHomeProps {
  variant: "session" | "chooser";
  language: UiLanguage;
  workspaceName?: string | undefined;
  resume?: ResumeTarget | null | undefined;
  notice?: TemplateNotice | null | undefined;
  /** Offered when the chosen template edits files and the Session is read-only. */
  writeAccess?: { busy: boolean; onAllow: () => void } | null | undefined;
  readAccess?:
    | {
        action: "read" | "restore";
        busy: boolean;
        error: string | null;
      }
    | null
    | undefined;
  templatesDisabled?: boolean | undefined;
  onUse: (template: TaskTemplate) => void;
}

export function TaskTemplateHome({
  variant,
  language,
  workspaceName,
  resume,
  notice,
  writeAccess,
  readAccess,
  templatesDisabled = false,
  onUse,
}: TaskTemplateHomeProps) {
  const copy = COPY[language];
  const headingId = useId();
  const noticeTemplate = notice
    ? findTaskTemplate(notice.templateId)
    : undefined;
  const noticeTitle = noticeTemplate?.copy[language].title ?? "";
  const session = variant === "session";
  return (
    <section
      className={styles.home}
      data-variant={variant}
      aria-labelledby={headingId}
    >
      <header className={styles.intro}>
        <h2 id={headingId}>{session ? copy.heading : copy.chooserHeading}</h2>
        <p>
          {session
            ? fill(copy.sessionLead, { workspace: workspaceName ?? "" })
            : copy.chooserLead}
        </p>
      </header>
      {session && resume ? (
        <ResumeSessionLink language={language} target={resume} />
      ) : null}
      <div className={styles.status} role="status">
        {notice && noticeTemplate ? (
          <p>
            <span>
              {fill(notice.kind === "applied" ? copy.applied : copy.pending, {
                title: noticeTitle,
              })}
            </span>
            {notice.kind === "applied" && notice.onUndo ? (
              <button type="button" onClick={notice.onUndo}>
                {copy.undo}
              </button>
            ) : null}
            {notice.kind === "pending" && notice.onCancel ? (
              <button type="button" onClick={notice.onCancel}>
                {copy.cancel}
              </button>
            ) : null}
          </p>
        ) : null}
        {writeAccess ? (
          <p data-tone="warn">
            <span>{copy.needsWrite}</span>
            <button
              type="button"
              disabled={writeAccess.busy}
              onClick={writeAccess.onAllow}
            >
              {copy.allowWrite}
            </button>
          </p>
        ) : null}
        {readAccess?.busy ? (
          <p>
            {readAccess.action === "restore"
              ? copy.restoreSwitching
              : copy.readSwitching}
          </p>
        ) : null}
        {readAccess?.error ? <p data-tone="warn">{readAccess.error}</p> : null}
      </div>
      {TASK_TEMPLATE_CATEGORIES.map((category) => (
        <TemplateGroup
          key={category}
          category={category}
          language={language}
          selectedId={notice?.templateId}
          disabled={templatesDisabled}
          onUse={onUse}
        />
      ))}
    </section>
  );
}

function TemplateGroup({
  category,
  language,
  selectedId,
  disabled,
  onUse,
}: {
  category: TaskTemplateCategory;
  language: UiLanguage;
  selectedId: string | undefined;
  disabled: boolean;
  onUse: (template: TaskTemplate) => void;
}) {
  const copy = COPY[language];
  const headingId = useId();
  const templates = TASK_TEMPLATES.filter(
    (template) => template.category === category,
  );
  if (templates.length === 0) return null;
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h3 id={headingId}>{copy.categories[category]}</h3>
      <ul className={styles.grid}>
        {templates.map((template) => {
          const text = template.copy[language];
          return (
            <li
              key={template.id}
              className={styles.card}
              data-template={template.id}
              data-selected={template.id === selectedId || undefined}
            >
              <h4>{text.title}</h4>
              <p className={styles.summary}>{text.summary}</p>
              <figure className={styles.example}>
                <figcaption>{copy.example}</figcaption>
                <p>{text.example}</p>
              </figure>
              <div className={styles.footer}>
                <span className={styles.access} data-access={template.access}>
                  {template.access === "read" ? (
                    <EyeIcon size={13} />
                  ) : (
                    <PencilIcon size={13} />
                  )}
                  {copy.access[template.access]}
                </span>
                <button
                  type="button"
                  className={styles.use}
                  aria-label={`${copy.use}${language === "zh" ? "：" : ": "}${text.title}`}
                  disabled={disabled}
                  onClick={() => onUse(template)}
                >
                  {copy.use}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
