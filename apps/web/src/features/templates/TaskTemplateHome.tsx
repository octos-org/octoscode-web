import { useId, useRef, useState, type MouseEvent } from "react";
import type { TemplateShortcuts, UiLanguage } from "../preferences/model.ts";
import { EyeIcon, PencilIcon, SearchIcon, StarIcon } from "../../ui/Icon.tsx";
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
  chatLead: string;
  chooserHeading: string;
  chooserLead: string;
  workspaceLead: string;
  workspacePending: string;
  categories: Record<TaskTemplateCategory, string>;
  access: Record<TaskTemplateAccess, string>;
  example: string;
  use: string;
  resume: string;
  applied: string;
  appliedReadOnly: string;
  undo: string;
  pending: string;
  cancel: string;
  needsWrite: string;
  allowWrite: string;
  readSwitching: string;
  restoreSwitching: string;
  favorites: string;
  recent: string;
  favorite: string;
  addFavorite: string;
  removeFavorite: string;
  shortcutsUnsaved: string;
  search: string;
  searchPlaceholder: string;
  scene: string;
  all: string;
  showing: string;
  noMatch: string;
  noMatchIn: string;
  clearFilters: string;
}

const COPY: Record<UiLanguage, HomeCopy> = {
  en: {
    heading: "What can Octos help with?",
    sessionLead:
      "Working in {workspace}. Start from a template, or describe the task below.",
    chatLead:
      "Start from a template, or ask anything below. Answers and drafts appear here in the chat.",
    chooserHeading: "Or start from a template",
    chooserLead:
      "Pick one, then choose a folder above. The request goes into the message box for you to edit.",
    workspaceLead:
      "Start a conversation in {workspace}. Choose a template, edit the request, then send.",
    workspacePending:
      "“{title}” is selected. Use it again to retry opening the same conversation.",
    categories: { code: "Code", office: "Office", general: "General" },
    access: {
      read: "Reads only",
      write: "Edits files",
      draft: "Draft in chat",
    },
    example: "Example result",
    use: "Use this",
    resume: "Continue where you left off",
    applied:
      "“{title}” is in the message box. Fill in the bracketed parts, then send.",
    appliedReadOnly:
      "“{title}” is in the message box, and this session is now read only. Fill in the bracketed parts, then send.",
    undo: "Undo",
    pending: "“{title}” is ready. Choose a folder to start.",
    cancel: "Cancel",
    needsWrite: "This template edits files, but this session is read-only.",
    allowWrite: "Switch to workspace write",
    readSwitching: "Switching to read-only before this template can send…",
    restoreSwitching: "Restoring the previous permission…",
    favorites: "Favorites",
    recent: "Recently used",
    favorite: "Favorite",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    shortcutsUnsaved:
      "Favorites and recent templates could not be saved in this browser. They will reset when the page reloads.",
    search: "Search templates",
    searchPlaceholder: "Search by name or description",
    scene: "Scene",
    all: "All",
    showing: "Showing {shown} of {total} templates.",
    noMatch: "No template matches “{query}”.",
    noMatchIn: "No {scene} template matches “{query}”.",
    clearFilters: "Show all templates",
  },
  zh: {
    heading: "想让 Octos 帮你做什么？",
    sessionLead:
      "在 {workspace} 里工作。挑一个模板改改，或者直接在下面写需求。",
    chatLead: "挑一个模板，或者直接在下面提问。回答和草稿都写在对话里。",
    chooserHeading: "也可以先挑一个模板",
    chooserLead: "选好后在上面选文件夹，需求会填进输入框，改好再发送。",
    workspaceLead: "在 {workspace} 中新建会话。挑一个模板，编辑需求后再发送。",
    workspacePending: "已选「{title}」，再次使用会重试打开同一会话。",
    categories: { code: "编程", office: "办公", general: "通用" },
    access: { read: "只读", write: "会改文件", draft: "在对话里起草" },
    example: "示例结果",
    use: "做同款",
    resume: "继续上次的会话",
    applied: "已把「{title}」填进输入框，改好【】里的内容再发送。",
    appliedReadOnly:
      "已把「{title}」填进输入框，这个会话现在是只读。改好【】里的内容再发送。",
    undo: "撤销",
    pending: "已选「{title}」，选好文件夹就开始。",
    cancel: "取消",
    needsWrite: "这个模板会改文件，但当前会话是只读。",
    allowWrite: "切换到工作区写入",
    readSwitching: "正在切换到只读，确认后才会发送…",
    restoreSwitching: "正在恢复模板前的权限…",
    favorites: "收藏",
    recent: "最近使用",
    favorite: "收藏",
    addFavorite: "加入收藏",
    removeFavorite: "取消收藏",
    shortcutsUnsaved: "收藏和最近使用没能存进这个浏览器，刷新页面后会清空。",
    search: "搜索模板",
    searchPlaceholder: "按名称或说明搜索",
    scene: "场景",
    all: "全部",
    showing: "显示 {shown} 个，共 {total} 个模板。",
    noMatch: "没有模板匹配「{query}」。",
    noMatchIn: "{scene}里没有模板匹配「{query}」。",
    clearFilters: "显示全部模板",
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
  variant: "session" | "chooser" | "workspace";
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
  /** Public catalog IDs from the display preferences; unknown IDs are skipped. */
  shortcuts?: TemplateShortcuts | undefined;
  shortcutsUnsaved?: boolean | undefined;
  onToggleFavorite?: ((templateId: string) => void) | undefined;
  /** `pointer` when clicked or tapped: the page must not move under it. */
  onUse: (template: TaskTemplate, by: TemplateUseSource) => void;
  /** The catalog to show; the shipped one unless a test passes another. */
  catalog?: readonly TaskTemplate[] | undefined;
  /** A chat's home (two-modes): no folder in the lead, no search or scenes. */
  chat?: boolean | undefined;
}

export type SceneFilter = TaskTemplateCategory | "all";

const searchable = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/**
 * Every word of the query appears in the template's name, description or
 * scene, in either language: the same query finds the same templates
 * whatever language the page is in. Prompts and examples are not searched.
 */
export function templateMatches(
  template: TaskTemplate,
  query: string,
): boolean {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchable(
    (["en", "zh"] as const)
      .flatMap((language) => [
        template.copy[language].title,
        template.copy[language].summary,
        COPY[language].categories[template.category],
      ])
      .join("\n"),
  );
  return words.every((word) => text.includes(word));
}

/** A browsing view only: nothing about the templates themselves changes. */
export function browseTemplates(
  catalog: readonly TaskTemplate[],
  scene: SceneFilter,
  query: string,
): TaskTemplate[] {
  return catalog.filter(
    (template) =>
      (scene === "all" || template.category === scene) &&
      templateMatches(template, query),
  );
}

export type TemplateUseSource = "pointer" | "keyboard";

/** Recent rows leave out favorites, which already sit right above them. */
export const RECENT_TEMPLATES_SHOWN = 3;

function catalogTemplates(
  catalog: readonly TaskTemplate[],
  ids: readonly string[],
): TaskTemplate[] {
  return ids.flatMap(
    (id) => catalog.find((template) => template.id === id) ?? [],
  );
}

function scrollParent(node: HTMLElement): Element | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
  }
  return document.scrollingElement;
}

/**
 * A row or notice that appears above the clicked control would push it from
 * under the pointer, and the second click of a double click would land on
 * whatever moved there. Scroll by the shift so the control stays put.
 */
function keepUnderPointer(event: MouseEvent<HTMLElement>, change: () => void) {
  const anchor = event.currentTarget;
  if (event.detail === 0) {
    change();
    return;
  }
  const before = anchor.getBoundingClientRect().top;
  change();
  requestAnimationFrame(() => {
    if (!anchor.isConnected) return;
    const shift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(shift) >= 1) scrollParent(anchor)?.scrollBy(0, shift);
  });
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
  shortcuts,
  shortcutsUnsaved = false,
  onToggleFavorite,
  onUse,
  catalog = TASK_TEMPLATES,
  chat = false,
}: TaskTemplateHomeProps) {
  const copy = COPY[language];
  const headingId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [scene, setScene] = useState<SceneFilter>("all");
  const [query, setQuery] = useState("");
  const scenes = TASK_TEMPLATE_CATEGORIES.filter((category) =>
    catalog.some((template) => template.category === category),
  );
  const shown = browseTemplates(catalog, scene, query);
  const filtering = scene !== "all" || query.trim() !== "";
  const clearFilters = () => {
    setScene("all");
    setQuery("");
    searchRef.current?.focus();
  };
  const homeRef = useRef<HTMLElement>(null);
  // Recent rows keep the order this home opened with: reordering them under
  // a double click would hand its second click to another template. The
  // next home (a new Session or a reload) shows the updated order.
  const [recentAtOpen] = useState(() => shortcuts?.recent ?? []);
  const favorites = catalogTemplates(catalog, shortcuts?.favorites ?? []);
  const favoriteIds = new Set(favorites.map((template) => template.id));
  const recent = catalogTemplates(catalog, recentAtOpen)
    .filter((template) => !favoriteIds.has(template.id))
    .slice(0, RECENT_TEMPLATES_SHOWN);
  const favorite = onToggleFavorite
    ? {
        ids: favoriteIds,
        onToggle: onToggleFavorite,
        // A starred or unstarred shortcut row moves; keep focus on the
        // template's star wherever it now sits first.
        onToggleMoved: (templateId: string) => {
          onToggleFavorite(templateId);
          requestAnimationFrame(() =>
            homeRef.current
              ?.querySelector<HTMLElement>(
                `[data-favorite="${CSS.escape(templateId)}"]`,
              )
              ?.focus(),
          );
        },
      }
    : null;
  const noticeTemplate = notice
    ? findTaskTemplate(notice.templateId)
    : undefined;
  const noticeTitle = noticeTemplate?.copy[language].title ?? "";
  const session = variant === "session";
  return (
    <section
      ref={homeRef}
      className={styles.home}
      data-variant={variant}
      aria-labelledby={headingId}
    >
      <header className={styles.intro}>
        <h2 id={headingId}>{session ? copy.heading : copy.chooserHeading}</h2>
        <p>
          {chat
            ? copy.chatLead
            : session
              ? fill(copy.sessionLead, { workspace: workspaceName ?? "" })
              : variant === "workspace"
                ? fill(copy.workspaceLead, { workspace: workspaceName ?? "" })
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
              {fill(
                notice.kind === "pending"
                  ? variant === "workspace"
                    ? copy.workspacePending
                    : copy.pending
                  : noticeTemplate.access === "read" && !readAccess?.error
                    ? copy.appliedReadOnly
                    : copy.applied,
                { title: noticeTitle },
              )}
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
        {shortcutsUnsaved ? (
          <p data-tone="warn">{copy.shortcutsUnsaved}</p>
        ) : null}
      </div>
      {(
        [
          ["favorites", favorites],
          ["recent", recent],
        ] as const
      ).map(([kind, templates]) =>
        templates.length > 0 ? (
          <ShortcutGroup
            key={kind}
            kind={kind}
            templates={templates}
            language={language}
            selectedId={notice?.templateId}
            disabled={templatesDisabled}
            favorite={favorite}
            onUse={onUse}
          />
        ) : null,
      )}
      {catalog.length > 0 && !chat ? (
        <div className={styles.browse}>
          <div className={styles.searchField}>
            <SearchIcon size={14} />
            <input
              ref={searchRef}
              type="search"
              className={styles.search}
              aria-label={copy.search}
              placeholder={copy.searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div
            className={styles.scenes}
            role="radiogroup"
            aria-label={copy.scene}
          >
            {(["all", ...scenes] as const).map((value) => (
              <label key={value} className={styles.scene}>
                <input
                  type="radio"
                  name={`${headingId}-scene`}
                  value={value}
                  checked={scene === value}
                  onChange={() => setScene(value)}
                />
                <span>
                  {value === "all" ? copy.all : copy.categories[value]}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {/* Announced as it changes; the home's one status region keeps its notices. */}
      <p className={styles.count} aria-live="polite" aria-atomic="true">
        {filtering
          ? fill(copy.showing, {
              shown: String(shown.length),
              total: String(catalog.length),
            })
          : ""}
      </p>
      {filtering && shown.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {fill(scene === "all" ? copy.noMatch : copy.noMatchIn, {
              query: query.trim(),
              scene: scene === "all" ? "" : copy.categories[scene],
            })}
          </p>
          <button type="button" onClick={clearFilters}>
            {copy.clearFilters}
          </button>
        </div>
      ) : null}
      {scenes.map((category) => (
        <TemplateGroup
          key={category}
          category={category}
          templates={shown.filter((template) => template.category === category)}
          language={language}
          selectedId={notice?.templateId}
          disabled={templatesDisabled}
          favorite={favorite}
          onUse={onUse}
        />
      ))}
    </section>
  );
}

interface FavoriteControl {
  ids: ReadonlySet<string>;
  onToggle: (templateId: string) => void;
  onToggleMoved: (templateId: string) => void;
}

function namedLabel(language: UiLanguage, label: string, title: string) {
  return `${label}${language === "zh" ? "：" : ": "}${title}`;
}

function FavoriteToggle({
  template,
  language,
  favorite,
  moves,
}: {
  template: TaskTemplate;
  language: UiLanguage;
  favorite: FavoriteControl;
  moves: boolean;
}) {
  const copy = COPY[language];
  const starred = favorite.ids.has(template.id);
  return (
    <button
      type="button"
      className={styles.favorite}
      data-favorite={template.id}
      aria-pressed={starred}
      aria-label={namedLabel(
        language,
        copy.favorite,
        template.copy[language].title,
      )}
      title={starred ? copy.removeFavorite : copy.addFavorite}
      onClick={(event) =>
        moves
          ? favorite.onToggleMoved(template.id)
          : keepUnderPointer(event, () => favorite.onToggle(template.id))
      }
    >
      <StarIcon size={15} />
    </button>
  );
}

function use(
  event: MouseEvent<HTMLElement>,
  template: TaskTemplate,
  onUse: (template: TaskTemplate, by: TemplateUseSource) => void,
) {
  keepUnderPointer(event, () =>
    onUse(template, event.detail === 0 ? "keyboard" : "pointer"),
  );
}

function AccessLabel({
  access,
  language,
}: {
  access: TaskTemplateAccess;
  language: UiLanguage;
}) {
  return (
    <span className={styles.access} data-access={access}>
      {access === "write" ? <PencilIcon size={13} /> : <EyeIcon size={13} />}
      {COPY[language].access[access]}
    </span>
  );
}

function ShortcutGroup({
  kind,
  templates,
  language,
  selectedId,
  disabled,
  favorite,
  onUse,
}: {
  kind: "favorites" | "recent";
  templates: readonly TaskTemplate[];
  language: UiLanguage;
  selectedId: string | undefined;
  disabled: boolean;
  favorite: FavoriteControl | null;
  onUse: (template: TaskTemplate, by: TemplateUseSource) => void;
}) {
  const copy = COPY[language];
  const headingId = useId();
  return (
    <section
      className={styles.group}
      data-shortcuts={kind}
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>{copy[kind]}</h3>
      <ol className={styles.shortcuts}>
        {templates.map((template) => {
          const text = template.copy[language];
          return (
            <li
              key={template.id}
              className={styles.shortcut}
              data-shortcut-template={template.id}
              data-selected={template.id === selectedId || undefined}
            >
              <button
                type="button"
                className={styles.shortcutUse}
                aria-label={namedLabel(language, copy.use, text.title)}
                disabled={disabled}
                onClick={(event) => use(event, template, onUse)}
              >
                <span className={styles.shortcutTitle}>{text.title}</span>
                <AccessLabel access={template.access} language={language} />
              </button>
              {favorite ? (
                <FavoriteToggle
                  template={template}
                  language={language}
                  favorite={favorite}
                  moves
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TemplateGroup({
  category,
  templates,
  language,
  selectedId,
  disabled,
  favorite,
  onUse,
}: {
  category: TaskTemplateCategory;
  templates: readonly TaskTemplate[];
  language: UiLanguage;
  selectedId: string | undefined;
  disabled: boolean;
  favorite: FavoriteControl | null;
  onUse: (template: TaskTemplate, by: TemplateUseSource) => void;
}) {
  const copy = COPY[language];
  const headingId = useId();
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
              <div className={styles.cardHead}>
                <h4>{text.title}</h4>
                {favorite ? (
                  <FavoriteToggle
                    template={template}
                    language={language}
                    favorite={favorite}
                    moves={false}
                  />
                ) : null}
              </div>
              <p className={styles.summary}>{text.summary}</p>
              <figure className={styles.example}>
                <figcaption>{copy.example}</figcaption>
                <p>{text.example}</p>
              </figure>
              <div className={styles.footer}>
                <AccessLabel access={template.access} language={language} />
                <button
                  type="button"
                  className={styles.use}
                  aria-label={namedLabel(language, copy.use, text.title)}
                  disabled={disabled}
                  onClick={(event) => use(event, template, onUse)}
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
