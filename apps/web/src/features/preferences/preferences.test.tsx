import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DisplayPreferencesStore } from "./model.ts";
import { PreferencesProvider, usePreferences } from "./preferences.tsx";
import { PreferencesDialog } from "./PreferencesDialog.tsx";
import {
  UiTextProvider,
  createUiText,
  requestUiCatalog,
  useUiText,
  type UiCatalog,
} from "./ui-text.tsx";

function ReadPreferences() {
  const preferences = usePreferences();
  return (
    <output>
      {preferences.theme}/{preferences.language}/{String(preferences.vimMode)}/
      {String(preferences.dirty)}
    </output>
  );
}
function ReadText() {
  const t = useUiText();
  return (
    <output>{t("Hello {name}: {count}", { name: "Alice", count: 2 })}</output>
  );
}

describe("display provider and cold dialog", () => {
  it("supports deterministic English feature rendering without a provider", () => {
    expect(renderToStaticMarkup(<ReadPreferences />)).toBe(
      "<output>terminal/en/false/false</output>",
    );
    expect(renderToStaticMarkup(<ReadText />)).toBe(
      "<output>Hello Alice: 2</output>",
    );
  });
  it("does not allow unprovided feature code to mutate a global preference singleton", () => {
    function UnprovidedWriter() {
      const preferences = usePreferences();
      preferences.setLanguage("zh");
      preferences.setTheme("codex");
      preferences.setVimMode(true);
      expect(preferences.save()).toBe(false);
      return null;
    }
    renderToStaticMarkup(<UnprovidedWriter />);
    expect(renderToStaticMarkup(<ReadPreferences />)).toBe(
      "<output>terminal/en/false/false</output>",
    );
  });
  it("reads the injected stable store and shows changes without saving", () => {
    const local = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const store = new DisplayPreferencesStore(local);
    const render = () =>
      renderToStaticMarkup(
        <PreferencesProvider store={store}>
          <ReadPreferences />
        </PreferencesProvider>,
      );
    expect(render()).toBe("<output>terminal/en/false/false</output>");
    store.setTheme("solarized");
    store.setLanguage("zh");
    store.setVimMode(true);
    expect(render()).toBe("<output>solarized/zh/true/true</output>");
    expect(local.setItem).not.toHaveBeenCalled();
  });
  it("renders all five native palettes, explicit browser-only Save and accessible labels", () => {
    const html = renderToStaticMarkup(<PreferencesDialog onClose={() => {}} />);
    for (const text of [
      "Browser preferences",
      "Language",
      "Theme",
      "Vim editing",
      "Save browser preferences",
      "Close preferences",
      "only in this browser",
      "code highlighting",
    ])
      expect(html).toContain(text);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('value="terminal" selected=""');
    for (const theme of ["codex", "claude", "slate", "solarized"])
      expect(html).toContain(`value="${theme}"`);
    expect(html).toContain('value="en" selected=""');
    expect(html).toContain('value="zh"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('checked=""');
  });
  it("translates source-authored dialog labels through injected catalog, not user data", () => {
    const html = renderToStaticMarkup(
      <UiTextProvider
        language="zh"
        catalog={{
          "Browser preferences": "浏览器偏好设置",
          Language: "语言",
          Theme: "主题",
          "Vim editing": "Vim 编辑",
          "Save browser preferences": "保存浏览器偏好设置",
        }}
      >
        <PreferencesDialog onClose={() => {}} />
      </UiTextProvider>,
    );
    for (const text of [
      "浏览器偏好设置",
      "语言",
      "主题",
      "Vim 编辑",
      "保存浏览器偏好设置",
    ])
      expect(html).toContain(text);
  });
  it("exposes a failed Save honestly and retains unsaved controls", () => {
    const store = new DisplayPreferencesStore();
    store.setTheme("slate");
    store.save();
    const html = renderToStaticMarkup(
      <PreferencesProvider store={store}>
        <PreferencesDialog onClose={() => {}} />
      </PreferencesProvider>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Browser preferences could not be saved.");
    expect(html).toContain("Unsaved browser preferences.");
    expect(html).toContain('value="slate" selected=""');
  });
});

describe("safe source-key UI text", () => {
  it("uses an explicit Chinese catalog with source fallback and named interpolation", () => {
    const t = createUiText("zh", {
      "Hello {name}: {count}": "你好 {name}：{count}",
    });
    expect(t("Hello {name}: {count}", { name: "Alice", count: 0 })).toBe(
      "你好 Alice：0",
    );
    expect(t("Unknown {thing}", { thing: "original" })).toBe(
      "Unknown original",
    );
    expect(t("Missing {value}", {})).toBe("Missing {value}");
    expect(t("Raw $& {value}", { value: "$& {name}" })).toBe(
      "Raw $& $& {name}",
    );
  });
  it("does not translate English mode or inherited object properties", () => {
    expect(createUiText("en", { Hello: "你好" })("Hello")).toBe("Hello");
    const inherited = Object.create({ Hello: "wrong" }) as UiCatalog;
    expect(createUiText("zh", inherited)("Hello")).toBe("Hello");
    expect(createUiText("zh", {})("constructor")).toBe("constructor");
    expect(createUiText()("{constructor}", {})).toBe("{constructor}");
  });
  it("interpolates before React escapes text, never injecting HTML", () => {
    const html = renderToStaticMarkup(
      <UiTextProvider
        language="zh"
        catalog={{ "Hello {name}: {count}": "<script>{name}</script> {count}" }}
      >
        <ReadText />
      </UiTextProvider>,
    );
    expect(html).toBe("<output>&lt;script&gt;Alice&lt;/script&gt; 2</output>");
  });
  it("accepts a successful owned lazy catalog", async () => {
    const receive = vi.fn();
    requestUiCatalog(async () => ({ Hello: "你好" }), receive);
    await vi.waitFor(() =>
      expect(receive).toHaveBeenCalledWith({ Hello: "你好" }),
    );
  });
  it("drops a slow Chinese catalog after language change or provider disposal", async () => {
    let resolve!: (catalog: UiCatalog) => void;
    const pending = new Promise<UiCatalog>((done) => {
      resolve = done;
    });
    const receive = vi.fn();
    const cancel = requestUiCatalog(() => pending, receive);
    cancel();
    resolve({ Hello: "你好" });
    await pending;
    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "retains source fallback after a lazy catalog rejection (sync=%s)",
    async (synchronous) => {
      const receive = vi.fn();
      requestUiCatalog(() => {
        if (synchronous) throw new Error("load failed");
        return Promise.reject(new Error("load failed"));
      }, receive);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(receive).not.toHaveBeenCalled();
      expect(createUiText("zh")("Hello")).toBe("Hello");
    },
  );
});
