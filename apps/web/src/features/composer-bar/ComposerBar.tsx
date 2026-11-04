import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { InstalledSkill } from "@octos-org/octoscode-client/skills";
import { FolderIcon } from "../../ui/Icon.tsx";
import {
  ModelMenu,
  useOutsideDismiss,
  type ModelControlProps,
} from "../product-controls/SessionControlBar.tsx";
import controlStyles from "../product-controls/SessionControlBar.module.css";
import { useUiText } from "../preferences/ui-text.tsx";
import { usePreferences } from "../preferences/preferences.tsx";
import {
  formatTokenCount,
  formatUsd,
  type SessionUsage,
} from "./session-usage.ts";
import type { DraftEstimate } from "./draft-estimate.ts";
import styles from "./ComposerBar.module.css";

/**
 * The composer's settings row: where the next message runs (folder), who
 * answers (model), what it may do (permission), and which skills to lean on.
 * Every chip shows its current value and is a plain button or menu button.
 */
export function ComposerSettingsRow({ children }: { children: ReactNode }) {
  const t = useUiText();
  return (
    <div className={styles.row} role="group" aria-label={t("Message settings")}>
      {children}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? controlStyles.chevronOpen : controlStyles.chevron}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5l3-3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Popover plumbing shared by the chips: outside click and Escape close it. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  useOutsideDismiss(open, rootRef, close);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  return { open, setOpen, close, rootRef, triggerRef, onKeyDown };
}

export function FolderChip({
  name,
  path,
  disabled,
  iconOnly = false,
  onChoose,
}: {
  name: string;
  path: string;
  disabled: boolean;
  /** Phones: the header already names the folder, so the chip is its icon. */
  iconOnly?: boolean;
  onChoose: () => void;
}) {
  const t = useUiText();
  return (
    <button
      type="button"
      className={
        iconOnly
          ? `${controlStyles.trigger} ${styles.iconTrigger}`
          : controlStyles.trigger
      }
      title={path}
      aria-label={t("Folder {path}. Start a new session in another folder", {
        path,
      })}
      disabled={disabled}
      onClick={onChoose}
    >
      <span className={controlStyles.triggerIcon}>
        <FolderIcon size={14} />
      </span>
      {iconOnly ? null : (
        <span className={controlStyles.triggerLabel}>{name}</span>
      )}
    </button>
  );
}

export function ModelChip({
  runtimeLabel,
  pendingLabel,
  control,
}: {
  /** What this Session's runtime serves; the chip's value. */
  runtimeLabel: string | null;
  /** A saved Profile default the server has not started using yet. */
  pendingLabel?: string | null | undefined;
  control: ModelControlProps;
}) {
  const t = useUiText();
  const popover = usePopover();
  const menuId = useId();
  const selectedName = control.groups
    .find((group) => group.id === control.selected?.providerId)
    ?.models.find((model) => model.id === control.selected?.modelId)?.name;
  const label =
    runtimeLabel ??
    selectedName ??
    (control.state.status === "loading"
      ? control.labels.loading
      : control.labels.select);
  return (
    <div
      ref={popover.rootRef}
      className={controlStyles.control}
      onKeyDown={popover.onKeyDown}
    >
      <button
        ref={popover.triggerRef}
        type="button"
        className={controlStyles.trigger}
        aria-label={
          pendingLabel
            ? t("Model: {model}. {pending} after the server restarts", {
                model: label,
                pending: pendingLabel,
              })
            : t("Model: {model}", { model: label })
        }
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-controls={popover.open ? menuId : undefined}
        disabled={control.locked || control.state.status === "unavailable"}
        onClick={() => popover.setOpen((value) => !value)}
      >
        <span className={controlStyles.triggerLabel}>{label}</span>
        {pendingLabel ? (
          <span className={controlStyles.pendingDot} aria-hidden="true" />
        ) : null}
        <Chevron open={popover.open} />
      </button>
      {popover.open ? (
        <ModelMenu
          menuId={menuId}
          className={styles.leftMenu}
          note={t(
            "Sets this Profile’s default model for every session. The server may need a restart to switch.",
          )}
          state={control.state}
          groups={control.groups}
          selected={control.selected}
          locked={control.locked}
          labels={control.labels}
          onChoose={(providerId, model) => {
            popover.close(true);
            if (
              control.selected?.providerId === providerId &&
              control.selected.modelId === model.id
            )
              return;
            control.onSelect({ providerId, modelId: model.id });
          }}
          {...(control.onRetry ? { onRetry: control.onRetry } : {})}
        />
      ) : null}
    </div>
  );
}

type SkillsLoad =
  | { status: "idle" | "loading" }
  | { status: "ready"; skills: InstalledSkill[] }
  | { status: "error" };

/** Loads the Profile's skills each time the owning menu opens. */
function useSkillsList(open: boolean, load: () => Promise<InstalledSkill[]>) {
  const [list, setList] = useState<SkillsLoad>({ status: "idle" });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!open) return;
    let current = true;
    setList({ status: "loading" });
    loadRef.current().then(
      (skills) => current && setList({ status: "ready", skills }),
      () => current && setList({ status: "error" }),
    );
    return () => {
      current = false;
    };
  }, [open]);
  return list;
}

/** The skills menu body, shared by the Skills chip and the phone's + menu. */
function SkillsMenuItems({
  list,
  onUse,
  onManage,
}: {
  list: SkillsLoad;
  onUse: (name: string) => void;
  onManage: () => void;
}) {
  const t = useUiText();
  return (
    <>
      <p className={controlStyles.status}>
        {t("Adds a line asking Octos to use the skill. You can edit it.")}
      </p>
      {list.status === "loading" ? (
        <p className={controlStyles.status}>{t("Loading skills…")}</p>
      ) : null}
      {list.status === "error" ? (
        <p className={controlStyles.status} role="alert">
          {t("Couldn't load this Profile's skills.")}
        </p>
      ) : null}
      {list.status === "ready" && list.skills.length === 0 ? (
        <p className={controlStyles.status}>
          {t("No skills are installed in this Profile.")}
        </p>
      ) : null}
      {list.status === "ready"
        ? list.skills.map((skill) => (
            <button
              key={skill.name}
              type="button"
              role="menuitem"
              className={controlStyles.option}
              onClick={() => onUse(skill.name)}
            >
              <span className={controlStyles.optionCopy}>
                <span className={controlStyles.optionName}>{skill.name}</span>
                <span className={controlStyles.optionDescription}>
                  {[
                    skill.version ? `v${skill.version}` : null,
                    skill.toolCount > 0
                      ? t("{count} tool(s)", { count: skill.toolCount })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))
        : null}
      <button
        type="button"
        role="menuitem"
        className={`${controlStyles.option} ${styles.menuFooter}`}
        onClick={onManage}
      >
        {t("Manage skills…")}
      </button>
    </>
  );
}

export function SkillsChip({
  load,
  onUse,
  onManage,
}: {
  load: () => Promise<InstalledSkill[]>;
  onUse: (name: string) => void;
  onManage: () => void;
}) {
  const t = useUiText();
  const popover = usePopover();
  const menuId = useId();
  const list = useSkillsList(popover.open, load);
  return (
    <div
      ref={popover.rootRef}
      className={controlStyles.control}
      onKeyDown={popover.onKeyDown}
    >
      <button
        ref={popover.triggerRef}
        type="button"
        className={controlStyles.trigger}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-controls={popover.open ? menuId : undefined}
        onClick={() => popover.setOpen((value) => !value)}
      >
        <span className={controlStyles.triggerIcon}>
          <SkillIcon />
        </span>
        <span className={controlStyles.triggerLabel}>{t("Skills")}</span>
        <Chevron open={popover.open} />
      </button>
      {popover.open ? (
        <div
          id={menuId}
          className={`${controlStyles.menu} ${styles.leftMenu}`}
          role="menu"
          aria-label={t("Skills")}
          aria-busy={list.status === "loading"}
        >
          <SkillsMenuItems
            list={list}
            onUse={(name) => {
              popover.close(false);
              onUse(name);
            }}
            onManage={() => {
              popover.close(false);
              onManage();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AttachChip({ onOpen }: { onOpen: () => void }) {
  const t = useUiText();
  return (
    <button
      type="button"
      className={controlStyles.trigger}
      aria-label={t("Attach files")}
      title={t("Attach CSV, Markdown, text, PDF or image files")}
      onClick={onOpen}
    >
      <span className={controlStyles.triggerIcon}>
        <PaperclipIcon />
      </span>
      <span className={controlStyles.triggerLabel}>{t("Files")}</span>
    </button>
  );
}

/**
 * Phones (美-9): Skills and Images fold into one "+" so the settings row fits
 * a line. One level deep: files first, then the skills list in place.
 */
export function ComposerAddMenu({
  skills,
  onAttachFiles,
}: {
  skills: {
    load: () => Promise<InstalledSkill[]>;
    onUse: (name: string) => void;
    onManage: () => void;
  } | null;
  onAttachFiles: (() => void) | null;
}) {
  const t = useUiText();
  const popover = usePopover();
  const menuId = useId();
  const skillsHeadingId = useId();
  const list = useSkillsList(popover.open && skills !== null, () =>
    skills ? skills.load() : Promise.resolve([]),
  );
  return (
    <div
      ref={popover.rootRef}
      className={controlStyles.control}
      onKeyDown={popover.onKeyDown}
    >
      <button
        ref={popover.triggerRef}
        type="button"
        className={`${controlStyles.trigger} ${styles.iconTrigger}`}
        aria-label={
          skills && onAttachFiles
            ? t("Add skills or files")
            : skills
              ? t("Skills")
              : t("Attach files")
        }
        title={
          skills && onAttachFiles
            ? t("Add skills or files")
            : skills
              ? t("Skills")
              : t("Attach files")
        }
        aria-haspopup="menu"
        aria-expanded={popover.open}
        aria-controls={popover.open ? menuId : undefined}
        onClick={() => popover.setOpen((value) => !value)}
      >
        <PlusIcon />
      </button>
      {popover.open ? (
        <div
          id={menuId}
          className={`${controlStyles.menu} ${styles.leftMenu}`}
          role="menu"
          aria-label={t("Add")}
          aria-busy={list.status === "loading"}
        >
          {onAttachFiles ? (
            <button
              type="button"
              role="menuitem"
              className={`${controlStyles.option} ${styles.addOption}`}
              onClick={() => {
                popover.close(false);
                onAttachFiles();
              }}
            >
              <PaperclipIcon />
              {t("Attach files")}
            </button>
          ) : null}
          {skills ? (
            <div
              role="group"
              aria-labelledby={skillsHeadingId}
              className={styles.addSection}
            >
              <p id={skillsHeadingId} className={styles.addHeading}>
                {t("Skills")}
              </p>
              <SkillsMenuItems
                list={list}
                onUse={(name) => {
                  popover.close(false);
                  skills.onUse(name);
                }}
                onManage={() => {
                  popover.close(false);
                  skills.onManage();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function UsageChip({
  usage,
  contextPercent,
}: {
  usage: SessionUsage;
  contextPercent: number | null;
}) {
  const t = useUiText();
  const { language } = usePreferences();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const popover = usePopover();
  const panelId = useId();
  const tokens = usage.inputTokens + usage.outputTokens;
  const summary = [
    t("{count} tokens", { count: formatTokenCount(tokens, locale) }),
    usage.costUsd ? `≈${formatUsd(usage.costUsd)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const exact = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <div
      ref={popover.rootRef}
      className={controlStyles.control}
      onKeyDown={popover.onKeyDown}
    >
      <button
        ref={popover.triggerRef}
        type="button"
        className={`${controlStyles.trigger} ${styles.usage}`}
        aria-label={t("This session used {summary}", { summary })}
        aria-expanded={popover.open}
        aria-controls={popover.open ? panelId : undefined}
        onClick={() => popover.setOpen((value) => !value)}
      >
        <span className={controlStyles.triggerLabel}>{summary}</span>
      </button>
      {popover.open ? (
        <div
          id={panelId}
          className={`${controlStyles.menu} ${styles.rightMenu} ${styles.usagePanel}`}
          role="group"
          aria-label={t("Session usage")}
        >
          <dl>
            <div>
              <dt>{t("Input tokens")}</dt>
              <dd>{exact(usage.inputTokens)}</dd>
            </div>
            <div>
              <dt>{t("Output tokens")}</dt>
              <dd>{exact(usage.outputTokens)}</dd>
            </div>
            {usage.cachedTokens > 0 ? (
              <div>
                <dt>{t("Cached input tokens")}</dt>
                <dd>{exact(usage.cachedTokens)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("Estimated cost")}</dt>
              <dd>
                {usage.costUsd !== undefined
                  ? formatUsd(usage.costUsd)
                  : t("Not reported")}
              </dd>
            </div>
            {contextPercent !== null ? (
              <div>
                <dt>{t("Context window used")}</dt>
                <dd>{contextPercent}%</dd>
              </div>
            ) : null}
          </dl>
          <p>
            {t(
              "Totals for this session as reported by the server. Cost is the server’s estimate from its price table, not a bill.",
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Before sending: this message's size and what the context will hold, both
 * estimates and labelled so. No money: nothing here knows a price, and the
 * reply, tool calls and attachments are not counted.
 */
export function DraftEstimateChip({
  estimate,
  compact = false,
}: {
  estimate: DraftEstimate;
  compact?: boolean;
}) {
  const t = useUiText();
  const { language } = usePreferences();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const popover = usePopover();
  const panelId = useId();
  const count = formatTokenCount(estimate.draftTokens, locale);
  const exact = (value: number) => new Intl.NumberFormat(locale).format(value);
  const nearlyFull = estimate.reachesThreshold;
  const label = t("This message ≈{count} tokens", { count });
  return (
    <div
      ref={popover.rootRef}
      className={controlStyles.control}
      onKeyDown={popover.onKeyDown}
      data-draft-estimate
    >
      <button
        ref={popover.triggerRef}
        type="button"
        className={`${controlStyles.trigger} ${styles.usage}`}
        data-tone={nearlyFull ? "attention" : undefined}
        aria-label={
          nearlyFull
            ? t("{label}, estimated. The server will compact first.", {
                label,
              })
            : t("{label}, estimated", { label })
        }
        aria-expanded={popover.open}
        aria-controls={popover.open ? panelId : undefined}
        onClick={() => popover.setOpen((value) => !value)}
      >
        <span className={controlStyles.triggerLabel}>
          {compact ? `≈${count}` : label}
        </span>
      </button>
      {popover.open ? (
        <div
          id={panelId}
          className={`${controlStyles.menu} ${styles.rightMenu} ${styles.usagePanel}`}
          role="group"
          aria-label={t("Before sending")}
        >
          <dl>
            <div>
              <dt>{t("This message")}</dt>
              <dd>≈{exact(estimate.draftTokens)}</dd>
            </div>
            <div>
              <dt>{t("Context so far")}</dt>
              <dd>
                {estimate.contextTokens !== null
                  ? `≈${exact(estimate.contextTokens)}`
                  : t("Not reported")}
              </dd>
            </div>
            {estimate.afterPercent !== null && estimate.window !== null ? (
              <div>
                <dt>{t("After sending")}</dt>
                <dd>
                  {t("≈{percent}% of {window}", {
                    percent: estimate.afterPercent,
                    window: exact(estimate.window),
                  })}
                </dd>
              </div>
            ) : null}
            {estimate.attachments > 0 ? (
              <div>
                <dt>{t("Attachments")}</dt>
                <dd>{t("Not counted")}</dd>
              </div>
            ) : null}
          </dl>
          {nearlyFull && estimate.threshold !== null ? (
            <p className={styles.estimateWarning}>
              {t(
                "With this message the context reaches the server’s compaction threshold of about {threshold}, so it will compact older messages first.",
                { threshold: exact(estimate.threshold) },
              )}
            </p>
          ) : null}
          <p>
            {[
              t(
                "Estimated from the character count, the same way the server estimates its context. The model’s own count will differ.",
              ),
              estimate.contextSource === "prompt"
                ? t(
                    "The context is the server’s estimate of the last prompt it sent, instructions and tool definitions included.",
                  )
                : estimate.contextSource === "transcript"
                  ? t(
                      "The context is the server’s estimate of the conversation so far; instructions and tool definitions sent with every request are not in it.",
                    )
                  : t(
                      "This server has not reported the context for this session.",
                    ),
              estimate.window === null
                ? t(
                    "The context window is known after the first reply in this session.",
                  )
                : null,
              t(
                "Not included: the reply, and this turn’s tool calls and their output.",
              ),
              estimate.attachments > 0
                ? t(
                    "{count} attachments are not counted; their size is only known once sent.",
                    { count: estimate.attachments },
                  )
                : null,
              t(
                "No price before sending: nothing here knows one. Usage and the server’s cost estimate appear after the reply.",
              ),
            ]
              .filter(Boolean)
              // Chinese sentences run on without a space after 。
              .join(language === "zh" ? "" : " ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SkillIcon() {
  return (
    <svg
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
      <path d="M8 1.75 9.6 5.9l4.15.35-3.15 2.75.95 4.25L8 11 4.45 13.25l.95-4.25L2.25 6.25 6.4 5.9 8 1.75Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
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
      <path d="m13.25 7.5-5.4 5.4a3.18 3.18 0 0 1-4.5-4.5l5.6-5.6a2.12 2.12 0 0 1 3 3L6.4 11.35a1.06 1.06 0 0 1-1.5-1.5L10 4.75" />
    </svg>
  );
}
