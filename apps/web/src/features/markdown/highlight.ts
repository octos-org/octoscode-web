/*
 * Adapted from DeepSeek Harness ui-primitives/highlight.ts.
 * Source revision: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
 * Copyright (c) 2026 DeepSeek. Licensed under the MIT License.
 * See THIRD_PARTY_NOTICES.md.
 */

import { createCssVariablesTheme, createHighlighterCoreSync } from "shiki/core";
import {
  createJavaScriptRegexEngine,
  defaultJavaScriptRegexConstructor,
} from "shiki/engine/javascript";
import langTypeScript from "@shikijs/langs/typescript";
import langShell from "@shikijs/langs/shellscript";
import langJson from "@shikijs/langs/json";
import type { HighlighterCore } from "shiki/core";

type LanguageModule = { default: typeof langTypeScript };

const bootLanguages = [langTypeScript, langShell, langJson];
const lazyLanguages = new Map<string, () => Promise<LanguageModule>>([
  ["python", () => import("@shikijs/langs/python")],
  ["rust", () => import("@shikijs/langs/rust")],
  ["go", () => import("@shikijs/langs/go")],
  ["java", () => import("@shikijs/langs/java")],
  ["c", () => import("@shikijs/langs/c")],
  ["yaml", () => import("@shikijs/langs/yaml")],
  ["toml", () => import("@shikijs/langs/toml")],
  ["markdown", () => import("@shikijs/langs/markdown")],
  ["html", () => import("@shikijs/langs/html")],
  ["css", () => import("@shikijs/langs/css")],
  ["sql", () => import("@shikijs/langs/sql")],
]);

const aliases = new Map<string, string>([
  ["typescript", "typescript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["javascript", "typescript"],
  ["js", "typescript"],
  ["jsx", "typescript"],
  ["shellscript", "shellscript"],
  ["bash", "shellscript"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["zsh", "shellscript"],
  ["json", "json"],
  ["jsonc", "json"],
  ["python", "python"],
  ["py", "python"],
  ["rust", "rust"],
  ["rs", "rust"],
  ["go", "go"],
  ["java", "java"],
  ["c", "c"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "toml"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["html", "html"],
  ["css", "css"],
  ["sql", "sql"],
]);

const theme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

const engine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: (pattern) =>
    defaultJavaScriptRegexConstructor(pattern, {
      lazyCompileLength: Number.POSITIVE_INFINITY,
    }),
});

let singleton: HighlighterCore | undefined;
const requested = new Set<string>();
const listeners = new Set<() => void>();
let loadCount = 0;

function highlighter(): HighlighterCore {
  singleton ??= createHighlighterCoreSync({
    themes: [theme],
    langs: bootLanguages,
    engine,
  });
  return singleton;
}

function ensureLanguage(language: string): boolean {
  const load = lazyLanguages.get(language);
  if (!load) return true;
  if (highlighter().getLoadedLanguages().includes(language)) return true;
  if (!requested.has(language)) {
    requested.add(language);
    void load().then((module) => {
      highlighter().loadLanguageSync(module.default);
      loadCount += 1;
      for (const listener of listeners) listener();
    });
  }
  return false;
}

const warmup = setTimeout(() => highlighter(), 0);
(warmup as { unref?: () => void }).unref?.();

export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function grammarLoadCount(): number {
  return loadCount;
}

export function highlightToHtml(
  code: string,
  language: string | undefined,
): string | undefined {
  const resolved = language ? aliases.get(language.toLowerCase()) : undefined;
  if (!resolved || !ensureLanguage(resolved)) return undefined;
  return highlighter().codeToHtml(code, {
    lang: resolved,
    theme: "css-variables",
  });
}
