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

export interface PreferencesSnapshot extends DisplayPreferences {
  readonly dirty: boolean;
  readonly error: string | null;
}

export type DisplayStorage = Pick<Storage, "getItem" | "setItem">;
export const SAVE_ERROR = "Browser preferences could not be saved.";

export function isDisplayTheme(value: unknown): value is DisplayTheme {
  return DISPLAY_THEMES.some((theme) => theme === value);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh";
}

/** Reject extra fields, including accidentally supplied connection credentials. */
export function parseDisplayPreferences(
  raw: string | null,
): DisplayPreferences | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== 4 ||
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
  } catch {
    return null;
  }
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
    try {
      saved = parseDisplayPreferences(
        storage?.getItem(DISPLAY_PREFERENCES_KEY) ?? null,
      );
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
    });
  }

  getSnapshot = (): PreferencesSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(preferences: DisplayPreferences, error: string | null = null) {
    const dirty = !samePreferences(preferences, this.#saved);
    if (
      samePreferences(preferences, this.#snapshot) &&
      this.#snapshot.dirty === dirty &&
      this.#snapshot.error === error
    )
      return;
    this.#snapshot = Object.freeze({
      theme: preferences.theme,
      language: preferences.language,
      vimMode: preferences.vimMode,
      dirty,
      error,
    });
    this.#listeners.forEach((listener) => listener());
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
      if (!this.#storage) throw new Error(SAVE_ERROR);
      this.#storage.setItem(
        DISPLAY_PREFERENCES_KEY,
        JSON.stringify({ version: 1, theme, language, vimMode }),
      );
      this.#saved = { theme, language, vimMode };
      this.#publish(this.#saved);
      return true;
    } catch {
      this.#publish(this.#snapshot, SAVE_ERROR);
      return false;
    }
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
