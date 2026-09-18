import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISPLAY_THEMES } from "./model.ts";

const themeCss = readFileSync(
  new URL("../../app/theme.css", import.meta.url),
  "utf8",
);
const paletteStart = themeCss.indexOf(
  "/* Named colors follow the pinned native Octoscode Theme palettes.",
);
const css = themeCss.slice(paletteStart);
describe("native browser palette mappings", () => {
  it.each(DISPLAY_THEMES)(
    "has a document-scoped %s palette without requiring remounts",
    (theme) => {
      expect(css).toContain(`:root[data-display-theme="${theme}"]`);
    },
  );
  it("lets Terminal inherit browser appearance while named palettes override either OS scheme", () => {
    expect(css).toMatch(/theme="terminal"[^}]+color-scheme:\s*light dark/s);
    expect(css).toMatch(/theme="solarized"[^}]+color-scheme:\s*dark/s);
    expect(css).not.toContain("@media");
  });
  it("overrides every semantic color and syntax token instead of leaving OS-colored code", () => {
    expect(paletteStart).toBeGreaterThan(0);
    const baseCss = themeCss.slice(0, paletteStart);
    const names = new Set(
      baseCss.match(/--(?:dsw-alias-|dsw-specific-|shiki-)[\w-]+(?=:)/g),
    );
    expect(names.size).toBeGreaterThanOrEqual(50);
    for (const name of names) expect(css).toContain(`${name}:`);
    expect(css).toContain("--shiki-token-keyword: var(--display-danger)");
    expect(css).toContain("--shiki-token-string: var(--display-success)");
  });
  it("uses the four pinned native surface/accent/text palettes", () => {
    for (const [theme, surface, accent, text] of [
      ["codex", "#0f1218", "#6ebcff", "#eceff4"],
      ["claude", "#261f1a", "#f28f5d", "#f4f1ea"],
      ["slate", "#141923", "#6397ff", "#e6ecf2"],
      ["solarized", "#002b36", "#268bd2", "#eee8d5"],
    ]) {
      const selector = `:root[data-display-theme="${theme}"]`;
      const block = css.slice(css.lastIndexOf(selector)).split("}")[0]!;
      expect(block).toContain(`--display-surface: ${surface};`);
      expect(block).toContain(`--display-accent: ${accent};`);
      expect(block).toContain(`--display-text: ${text};`);
    }
  });
  it("keeps the provider hot path free of dialogs, Markdown and the Chinese catalog", () => {
    const provider = readFileSync(
      new URL("./preferences.tsx", import.meta.url),
      "utf8",
    );
    const text = readFileSync(
      new URL("./ui-text.tsx", import.meta.url),
      "utf8",
    );
    const main = readFileSync(
      new URL("../../main.tsx", import.meta.url),
      "utf8",
    );
    expect(main).toContain('import "./app/theme.css"');
    expect(provider).not.toContain("palettes.module.css");
    expect(provider).not.toContain("palettes.css");
    expect(provider).not.toMatch(
      /import.*(?:PreferencesDialog|markdown|shiki|zh\.ts)/i,
    );
    expect(text).toContain('import("./zh.ts")');
    expect(text).not.toMatch(/import\s+.+from\s+["']\.\/zh\.ts/);
  });
});
