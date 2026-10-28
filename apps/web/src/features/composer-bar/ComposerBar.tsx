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
  onChoose,
}: {
  name: string;
  path: string;
  disabled: boolean;
  onChoose: () => void;
}) {
  const t = useUiText();
  return (
    <button
      type="button"
      className={controlStyles.trigger}
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
      <span className={controlStyles.triggerLabel}>{name}</span>
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
  const [list, setList] = useState<SkillsLoad>({ status: "idle" });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!popover.open) return;
    let current = true;
    setList({ status: "loading" });
    loadRef.current().then(
      (skills) => current && setList({ status: "ready", skills }),
      () => current && setList({ status: "error" }),
    );
    return () => {
      current = false;
    };
  }, [popover.open]);
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
                  onClick={() => {
                    popover.close(false);
                    onUse(skill.name);
                  }}
                >
                  <span className={controlStyles.optionCopy}>
                    <span className={controlStyles.optionName}>
                      {skill.name}
                    </span>
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
            onClick={() => {
              popover.close(false);
              onManage();
            }}
          >
            {t("Manage skills…")}
          </button>
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
      aria-label={t("Attach images")}
      onClick={onOpen}
    >
      <span className={controlStyles.triggerIcon}>
        <PaperclipIcon />
      </span>
      <span className={controlStyles.triggerLabel}>{t("Images")}</span>
    </button>
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
