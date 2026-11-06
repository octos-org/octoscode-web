import { describe, expect, it, vi } from "vitest";
import {
  bindPreferencesDocument,
  DISPLAY_PREFERENCES_KEY,
  DISPLAY_THEMES,
  DisplayPreferencesStore,
  isDisplayTheme,
  isUiLanguage,
  parseDisplayPreferences,
  parseTemplateShortcuts,
  RECENT_TEMPLATE_LIMIT,
  SAVE_ERROR,
  TEMPLATES_SAVE_ERROR,
  type DisplayTheme,
  type UiLanguage,
} from "./model.ts";

function storage(initial: string | null = null) {
  const values = new Map(initial ? [[DISPLAY_PREFERENCES_KEY, initial]] : []);
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
const saved = { version: 1, theme: "claude", language: "zh", vimMode: true };
const noShortcuts = { favorites: [], recent: [] };

describe("strict browser-only display preferences", () => {
  it.each(DISPLAY_THEMES)("accepts the native %s palette", (theme) => {
    expect(isDisplayTheme(theme)).toBe(true);
    expect(
      parseDisplayPreferences(JSON.stringify({ ...saved, theme })),
    ).toEqual({ theme, language: "zh", vimMode: true });
  });
  it.each([
    null,
    "",
    "not json",
    "null",
    "[]",
    "false",
    "1",
    '"theme"',
    JSON.stringify({ ...saved, version: 2 }),
    JSON.stringify({ ...saved, theme: "system" }),
    JSON.stringify({ ...saved, theme: "CODEX" }),
    JSON.stringify({ ...saved, language: "zh-CN" }),
    JSON.stringify({ ...saved, vimMode: "true" }),
    JSON.stringify({ theme: "codex", language: "en", vimMode: false }),
    JSON.stringify({ ...saved, token: "must-never-persist" }),
    JSON.stringify({ ...saved, sessionId: "not-a-display-setting" }),
    '{"version":1,"theme":"codex","language":"en","vimMode":false,"__proto__":{}}',
    JSON.stringify({ ...saved, templates: noShortcuts, token: "secret" }),
  ])("rejects malformed, extended or unsupported saved input %#", (raw) => {
    expect(parseDisplayPreferences(raw)).toBeNull();
  });
  it.each([
    ["zh", "zh"],
    ["zh-CN", "zh"],
    ["zh-TW", "zh"],
    ["ZH_hans", "zh"],
    ["en-US", "en"],
    ["fr", "en"],
    ["zhuang", "en"],
    ["", "en"],
  ])(
    "uses browser language %s only without a valid explicit save",
    (browser, language) => {
      expect(new DisplayPreferencesStore(null, browser).getSnapshot()).toEqual({
        theme: "terminal",
        language,
        vimMode: false,
        dirty: false,
        error: null,
        templates: noShortcuts,
        templatesError: null,
      });
    },
  );
  it("loads one valid namespaced save before browser fallback, without writing", () => {
    const local = storage(JSON.stringify(saved));
    const store = new DisplayPreferencesStore(local, "en-US");
    expect(store.getSnapshot()).toEqual({
      theme: "claude",
      language: "zh",
      vimMode: true,
      dirty: false,
      error: null,
      templates: noShortcuts,
      templatesError: null,
    });
    expect(local.getItem.mock.calls).toEqual([[DISPLAY_PREFERENCES_KEY]]);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
  });
  it("ignores invalid saved preferences without deleting or silently replacing them", () => {
    const raw = JSON.stringify({ ...saved, token: "unrelated" });
    const local = storage(raw);
    const store = new DisplayPreferencesStore(local, "zh-CN");
    expect(store.getSnapshot().theme).toBe("terminal");
    expect(store.getSnapshot().language).toBe("zh");
    expect(local.values.get(DISPLAY_PREFERENCES_KEY)).toBe(raw);
    expect(local.setItem).not.toHaveBeenCalled();
  });
  it("applies all choices in memory and persists exactly the display whitelist only on Save", () => {
    const local = storage();
    const store = new DisplayPreferencesStore(local);
    store.setTheme("slate");
    store.setLanguage("zh");
    store.setVimMode(true);
    expect(store.getSnapshot().dirty).toBe(true);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(store.save()).toBe(true);
    expect(local.setItem.mock.calls).toEqual([
      [
        DISPLAY_PREFERENCES_KEY,
        JSON.stringify({
          version: 1,
          theme: "slate",
          language: "zh",
          vimMode: true,
        }),
      ],
    ]);
    expect(store.getSnapshot().dirty).toBe(false);
    expect(new DisplayPreferencesStore(local, "en").getSnapshot()).toEqual(
      store.getSnapshot(),
    );
  });
  it("does not leak unsaved changes into a newly loaded application", () => {
    const local = storage(JSON.stringify(saved));
    const store = new DisplayPreferencesStore(local);
    store.setTheme("codex");
    store.setLanguage("en");
    store.setVimMode(false);
    expect(new DisplayPreferencesStore(local).getSnapshot()).toMatchObject({
      theme: "claude",
      language: "zh",
      vimMode: true,
    });
  });
  it("keeps immutable stable snapshots and only publishes real changes", () => {
    const store = new DisplayPreferencesStore(storage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const initial = store.getSnapshot();
    store.setTheme("terminal");
    store.setLanguage("en");
    store.setVimMode(false);
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    store.setTheme("codex");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(initial.theme).toBe("terminal");
    store.setTheme("terminal");
    expect(store.getSnapshot().dirty).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.setLanguage("zh");
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("validates runtime setters even when a caller bypasses TypeScript", () => {
    const store = new DisplayPreferencesStore();
    const initial = store.getSnapshot();
    store.setTheme("hacked" as DisplayTheme);
    store.setLanguage("fr" as UiLanguage);
    store.setVimMode("yes" as unknown as boolean);
    expect(store.getSnapshot()).toBe(initial);
    expect(isUiLanguage("en")).toBe(true);
    expect(isUiLanguage("zh")).toBe(true);
    expect(isUiLanguage("zh-CN")).toBe(false);
  });
  it("keeps working when storage reads and writes throw, exposing only a safe local error", () => {
    const local = {
      getItem: vi.fn(() => {
        throw new Error("private credential-containing browser error");
      }),
      setItem: vi.fn((): void => {
        throw new Error("quota or token");
      }),
    };
    const store = new DisplayPreferencesStore(local, "zh-CN");
    store.setTheme("solarized");
    expect(store.save()).toBe(false);
    expect(store.getSnapshot()).toEqual({
      theme: "solarized",
      language: "zh",
      vimMode: false,
      dirty: true,
      error: SAVE_ERROR,
      templates: noShortcuts,
      templatesError: null,
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain("token");
    local.setItem.mockImplementation(() => undefined);
    expect(store.save()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ error: null, dirty: false });
  });
  it("cannot report a successful save without browser storage", () => {
    const store = new DisplayPreferencesStore();
    expect(store.save()).toBe(false);
    expect(store.getSnapshot().error).toBe(SAVE_ERROR);
  });
});

describe("template shortcuts in the display preferences", () => {
  const withTemplates = (templates: unknown) =>
    JSON.stringify({ ...saved, templates });

  it("loads only catalog IDs, once each, and keeps the display choices", () => {
    const raw = withTemplates({
      favorites: ["fix-bug", "retired-template", "fix-bug", 7, "weekly-report"],
      recent: ["t0428-0123456789abcdef", "research-topic", null],
    });
    expect(parseDisplayPreferences(raw)).toEqual({
      theme: "claude",
      language: "zh",
      vimMode: true,
    });
    expect(parseTemplateShortcuts(raw)).toEqual({
      favorites: ["fix-bug", "weekly-report"],
      recent: ["research-topic"],
    });
  });
  it.each([
    withTemplates(null),
    withTemplates("fix-bug"),
    withTemplates(["fix-bug"]),
    withTemplates({ favorites: ["fix-bug"] }),
    withTemplates({ favorites: "fix-bug", recent: [] }),
    withTemplates({ favorites: [], recent: [], prompt: "secret" }),
    JSON.stringify({ ...saved, theme: "neon", templates: noShortcuts }),
  ])("falls back to no shortcuts for a malformed record %#", (raw) => {
    expect(parseTemplateShortcuts(raw)).toEqual(noShortcuts);
  });
  it("records a chosen template first, a repeat changes nothing, and older uses keep their order", () => {
    const local = storage(JSON.stringify(saved));
    const store = new DisplayPreferencesStore(local);
    const listener = vi.fn();
    store.subscribe(listener);
    store.recordTemplateUse("fix-bug");
    store.recordTemplateUse("weekly-report");
    const afterTwo = store.getSnapshot();
    store.recordTemplateUse("weekly-report");
    expect(store.getSnapshot()).toBe(afterTwo);
    expect(local.setItem).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);
    store.recordTemplateUse("fix-bug");
    expect(store.getSnapshot().templates.recent).toEqual([
      "fix-bug",
      "weekly-report",
    ]);
    expect(JSON.parse(local.values.get(DISPLAY_PREFERENCES_KEY)!)).toEqual({
      ...saved,
      templates: { favorites: [], recent: ["fix-bug", "weekly-report"] },
    });
  });
  it("keeps at most the recent limit and ignores IDs outside the catalog", () => {
    const store = new DisplayPreferencesStore(storage());
    const ids = [
      "explain-repository",
      "fix-bug",
      "review-changes",
      "repository-health",
      "weekly-report",
      "tidy-spreadsheet",
      "research-topic",
    ];
    for (const id of ids) store.recordTemplateUse(id);
    store.recordTemplateUse("not-in-the-catalog");
    store.toggleFavoriteTemplate("/home/someone/project");
    store.recordTemplateUse(42 as unknown as string);
    expect(store.getSnapshot().templates).toEqual({
      favorites: [],
      recent: ids.slice(-RECENT_TEMPLATE_LIMIT).reverse(),
    });
  });
  it("stars in order, unstars, and saves only template IDs beside the last saved display choices", () => {
    const local = storage(JSON.stringify(saved));
    const store = new DisplayPreferencesStore(local);
    store.setTheme("slate");
    store.toggleFavoriteTemplate("weekly-report");
    store.toggleFavoriteTemplate("fix-bug");
    store.toggleFavoriteTemplate("weekly-report");
    store.toggleFavoriteTemplate("research-topic");
    expect(store.getSnapshot()).toMatchObject({
      theme: "slate",
      dirty: true,
      templates: { favorites: ["fix-bug", "research-topic"], recent: [] },
    });
    // The unsaved palette is not written along with the shortcuts.
    expect(local.values.get(DISPLAY_PREFERENCES_KEY)).toBe(
      JSON.stringify({
        ...saved,
        templates: { favorites: ["fix-bug", "research-topic"], recent: [] },
      }),
    );
    expect(store.save()).toBe(true);
    const reloaded = new DisplayPreferencesStore(local).getSnapshot();
    expect(reloaded).toMatchObject({
      theme: "slate",
      templates: { favorites: ["fix-bug", "research-topic"], recent: [] },
    });
    store.toggleFavoriteTemplate("fix-bug");
    store.toggleFavoriteTemplate("research-topic");
    // With nothing left, the record is the plain display whitelist again.
    expect(local.values.get(DISPLAY_PREFERENCES_KEY)).toBe(
      JSON.stringify({ ...saved, theme: "slate" }),
    );
  });
  it("drops a removed template on the next write", () => {
    const local = storage(
      withTemplates({ favorites: ["retired-template"], recent: ["fix-bug"] }),
    );
    const store = new DisplayPreferencesStore(local);
    expect(store.getSnapshot().templates).toEqual({
      favorites: [],
      recent: ["fix-bug"],
    });
    expect(local.setItem).not.toHaveBeenCalled();
    store.recordTemplateUse("weekly-report");
    expect(local.values.get(DISPLAY_PREFERENCES_KEY)).not.toContain("retired");
  });
  it("keeps shortcuts in memory and says so when the browser refuses to save", () => {
    const local = storage();
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    const store = new DisplayPreferencesStore(local);
    store.toggleFavoriteTemplate("fix-bug");
    expect(store.getSnapshot()).toMatchObject({
      templates: { favorites: ["fix-bug"], recent: [] },
      templatesError: TEMPLATES_SAVE_ERROR,
      error: null,
    });
    local.setItem.mockImplementation(() => undefined);
    store.recordTemplateUse("fix-bug");
    expect(store.getSnapshot().templatesError).toBeNull();
  });
});

describe("document-only preference binding", () => {
  function root(initial: Record<string, string> = {}) {
    const attrs = new Map(Object.entries(initial));
    return {
      attrs,
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, value);
      },
      removeAttribute: (name: string) => {
        attrs.delete(name);
      },
    };
  }
  it("updates language and palette on the same document, with no persistence or Session mutation", () => {
    const local = storage();
    const store = new DisplayPreferencesStore(local);
    const documentRoot = root({ lang: "de", "data-unrelated": "preserved" });
    const release = bindPreferencesDocument(store, documentRoot);
    expect(documentRoot.getAttribute("lang")).toBe("en");
    expect(documentRoot.getAttribute("data-display-theme")).toBe("terminal");
    store.setLanguage("zh");
    store.setTheme("claude");
    expect(documentRoot.getAttribute("lang")).toBe("zh");
    expect(documentRoot.getAttribute("data-display-theme")).toBe("claude");
    expect(local.setItem).not.toHaveBeenCalled();
    release();
    expect(Object.fromEntries(documentRoot.attrs)).toEqual({
      lang: "de",
      "data-unrelated": "preserved",
    });
    store.setTheme("slate");
    expect(documentRoot.getAttribute("data-display-theme")).toBeNull();
  });
  it("does not overwrite a newer document owner during disposal", () => {
    const store = new DisplayPreferencesStore();
    const documentRoot = root();
    const release = bindPreferencesDocument(store, documentRoot);
    documentRoot.setAttribute("lang", "fr");
    documentRoot.setAttribute("data-display-theme", "external");
    release();
    expect(Object.fromEntries(documentRoot.attrs)).toEqual({
      lang: "fr",
      "data-display-theme": "external",
    });
  });
});
