import { findTaskTemplate } from "../templates/task-templates.ts";

export const DISPLAY_PREFERENCES_KEY = "octoscode.web.display.v1";
export const DISPLAY_THEMES = [
  "terminal",
  "codex",
  "claude",
  "slate",
  "solarized",
] as const;
export type DisplayTheme = (typeof DISPLAY_THEMES)[number];
export type UiLanguage = "en" | "zh";

export interface DisplayPreferences {
  readonly theme: DisplayTheme;
  readonly language: UiLanguage;
  readonly vimMode: boolean;
}

/**
 * Starred and recently used starter templates, as public catalog IDs only:
 * never a prompt, draft, Session, folder or credential.
 */
export interface TemplateShortcuts {
  /** In the order they were starred. */
  readonly favorites: readonly string[];
  /** Most recently chosen first. */
  readonly recent: readonly string[];
}

export interface PreferencesSnapshot extends DisplayPreferences {
  readonly dirty: boolean;
  readonly error: string | null;
  readonly templates: TemplateShortcuts;
  /** Set when the last shortcut change stayed in memory only. */
  readonly templatesError: string | null;
}

export type DisplayStorage = Pick<Storage, "getItem" | "setItem">;
export const SAVE_ERROR = "Browser preferences could not be saved.";
export const TEMPLATES_SAVE_ERROR =
  "Favorites and recent templates could not be saved in this browser. They will reset when the page reloads.";
export const RECENT_TEMPLATE_LIMIT = 6;
const NO_SHORTCUTS: TemplateShortcuts = Object.freeze({
  favorites: Object.freeze([]),
  recent: Object.freeze([]),
});

export function isDisplayTheme(value: unknown): value is DisplayTheme {
  return DISPLAY_THEMES.some((theme) => theme === value);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh";
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reject extra fields, including accidentally supplied connection credentials. */
export function parseDisplayPreferences(
  raw: string | null,
): DisplayPreferences | null {
  const row = parseRecord(raw);
  if (
    !row ||
    Object.keys(row).length !== (Object.hasOwn(row, "templates") ? 5 : 4) ||
    row.version !== 1 ||
    !isDisplayTheme(row.theme) ||
    !isUiLanguage(row.language) ||
    typeof row.vimMode !== "boolean"
  )
    return null;
  return Object.freeze({
    theme: row.theme,
    language: row.language,
    vimMode: row.vimMode,
  });
}

/** Keeps only IDs the current catalog still has, once each, in order. */
function knownTemplateIds(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const id of value) {
    if (ids.length >= limit) break;
    if (typeof id === "string" && findTaskTemplate(id) && !ids.includes(id))
      ids.push(id);
  }
  return Object.freeze(ids);
}

/**
 * Removed templates and unknown IDs are dropped, so the home falls back to
 * its default layout. Anything else in the record is not a shortcut.
 */
export function parseTemplateShortcuts(raw: string | null): TemplateShortcuts {
  if (!parseDisplayPreferences(raw)) return NO_SHORTCUTS;
  const templates = parseRecord(raw)?.templates;
  if (!templates || typeof templates !== "object" || Array.isArray(templates))
    return NO_SHORTCUTS;
  const row = templates as Record<string, unknown>;
  if (
    Object.keys(row).length !== 2 ||
    !Array.isArray(row.favorites) ||
    !Array.isArray(row.recent)
  )
    return NO_SHORTCUTS;
  return Object.freeze({
    favorites: knownTemplateIds(row.favorites, Number.POSITIVE_INFINITY),
    recent: knownTemplateIds(row.recent, RECENT_TEMPLATE_LIMIT),
  });
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function samePreferences(a: DisplayPreferences, b: DisplayPreferences) {
  return (
    a.theme === b.theme && a.language === b.language && a.vimMode === b.vimMode
  );
}

/** No Core, Session, draft or authentication data enters this store. */
export class DisplayPreferencesStore {
  readonly #storage: DisplayStorage | null;
  readonly #listeners = new Set<() => void>();
  #saved: DisplayPreferences;
  #snapshot: PreferencesSnapshot;

  constructor(storage: DisplayStorage | null = null, browserLanguage = "en") {
    this.#storage = storage;
    let saved: DisplayPreferences | null = null;
    let templates = NO_SHORTCUTS;
    try {
      const raw = storage?.getItem(DISPLAY_PREFERENCES_KEY) ?? null;
      saved = parseDisplayPreferences(raw);
      templates = parseTemplateShortcuts(raw);
    } catch {
      // Denied/private browser storage must not prevent using the application.
    }
    this.#saved = saved ?? {
      theme: "terminal",
      language: /^zh(?:-|_|$)/i.test(browserLanguage) ? "zh" : "en",
      vimMode: false,
    };
    this.#snapshot = Object.freeze({
      ...this.#saved,
      dirty: false,
      error: null,
      templates,
      templatesError: null,
    });
  }

  getSnapshot = (): PreferencesSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(
    preferences: DisplayPreferences,
    error: string | null = null,
    templates: TemplateShortcuts = this.#snapshot.templates,
    templatesError: string | null = this.#snapshot.templatesError,
  ) {
    const dirty = !samePreferences(preferences, this.#saved);
    if (
      samePreferences(preferences, this.#snapshot) &&
      this.#snapshot.dirty === dirty &&
      this.#snapshot.error === error &&
      this.#snapshot.templates === templates &&
      this.#snapshot.templatesError === templatesError
    )
      return;
    this.#snapshot = Object.freeze({
      theme: preferences.theme,
      language: preferences.language,
      vimMode: preferences.vimMode,
      dirty,
      error,
      templates,
      templatesError,
    });
    this.#listeners.forEach((listener) => listener());
  }

  /** Saved display choices plus the shortcuts; nothing else is written. */
  #write(display: DisplayPreferences, templates: TemplateShortcuts) {
    if (!this.#storage) throw new Error(SAVE_ERROR);
    const { theme, language, vimMode } = display;
    this.#storage.setItem(
      DISPLAY_PREFERENCES_KEY,
      JSON.stringify(
        templates.favorites.length || templates.recent.length
          ? {
              version: 1,
              theme,
              language,
              vimMode,
              templates: {
                favorites: templates.favorites,
                recent: templates.recent,
              },
            }
          : { version: 1, theme, language, vimMode },
      ),
    );
  }

  setTheme = (theme: DisplayTheme): void => {
    if (isDisplayTheme(theme)) this.#publish({ ...this.#snapshot, theme });
  };

  setLanguage = (language: UiLanguage): void => {
    if (isUiLanguage(language)) this.#publish({ ...this.#snapshot, language });
  };

  setVimMode = (vimMode: boolean): void => {
    if (typeof vimMode === "boolean")
      this.#publish({ ...this.#snapshot, vimMode });
  };

  save = (): boolean => {
    const { theme, language, vimMode } = this.#snapshot;
    try {
      this.#write({ theme, language, vimMode }, this.#snapshot.templates);
      this.#saved = { theme, language, vimMode };
      this.#publish(this.#saved, null, this.#snapshot.templates, null);
      return true;
    } catch {
      this.#publish(this.#snapshot, SAVE_ERROR);
      return false;
    }
  };

  /**
   * Shortcuts save at once, beside the last saved display choices; unsaved
   * dialog changes stay unsaved. Unknown IDs and repeats change nothing.
   */
  #setTemplates(next: TemplateShortcuts) {
    const current = this.#snapshot.templates;
    if (
      sameIds(next.favorites, current.favorites) &&
      sameIds(next.recent, current.recent)
    )
      return;
    const templates = Object.freeze({
      favorites: Object.freeze([...next.favorites]),
      recent: Object.freeze([...next.recent]),
    });
    let templatesError: string | null = null;
    try {
      this.#write(this.#saved, templates);
    } catch {
      templatesError = TEMPLATES_SAVE_ERROR;
    }
    this.#publish(
      this.#snapshot,
      this.#snapshot.error,
      templates,
      templatesError,
    );
  }

  toggleFavoriteTemplate = (id: string): void => {
    if (typeof id !== "string" || !findTaskTemplate(id)) return;
    const { favorites, recent } = this.#snapshot.templates;
    this.#setTemplates({
      favorites: favorites.includes(id)
        ? favorites.filter((favorite) => favorite !== id)
        : [...favorites, id],
      recent,
    });
  };

  /** Call only when the person chooses a template, never on render or restore. */
  recordTemplateUse = (id: string): void => {
    if (typeof id !== "string" || !findTaskTemplate(id)) return;
    const { favorites, recent } = this.#snapshot.templates;
    this.#setTemplates({
      favorites,
      recent: [id, ...recent.filter((used) => used !== id)].slice(
        0,
        RECENT_TEMPLATE_LIMIT,
      ),
    });
  };
}

/** One subscription updates document presentation without replacing its children. */
export function bindPreferencesDocument(
  store: DisplayPreferencesStore,
  root: Pick<HTMLElement, "getAttribute" | "setAttribute" | "removeAttribute">,
): () => void {
  const previousLanguage = root.getAttribute("lang");
  const previousTheme = root.getAttribute("data-display-theme");
  const apply = () => {
    const { language, theme } = store.getSnapshot();
    root.setAttribute("lang", language);
    root.setAttribute("data-display-theme", theme);
  };
  apply();
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    const { language, theme } = store.getSnapshot();
    for (const [name, current, previous] of [
      ["lang", language, previousLanguage],
      ["data-display-theme", theme, previousTheme],
    ] as const) {
      if (root.getAttribute(name) !== current) continue;
      if (previous === null) root.removeAttribute(name);
      else root.setAttribute(name, previous);
    }
  };
}
