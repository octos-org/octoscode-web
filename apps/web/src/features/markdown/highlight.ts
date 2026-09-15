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
import type {
  HighlighterCore,
  LanguageRegistration,
  MaybeArray,
} from "shiki/core";

type LanguageModule = { default: MaybeArray<LanguageRegistration> };

// Load only the grammars requested by a visible code block or diff.
const lazyLanguages = new Map<string, () => Promise<LanguageModule>>([
  ["typescript", () => import("@shikijs/langs/typescript")],
  ["shellscript", () => import("@shikijs/langs/shellscript")],
  ["json", () => import("@shikijs/langs/json")],
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
    langs: [],
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
    void load()
      .then((module) => {
        highlighter().loadLanguageSync(module.default);
        loadCount += 1;
        for (const listener of listeners) listener();
      })
      .catch(() => {
        // Highlighting is optional. A missing grammar must leave readable,
        // copyable plain code without an unhandled background rejection.
      });
  }
  return false;
}

export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function grammarLoadCount(): number {
  return loadCount;
}

export function isGrammarLoaded(language: string | undefined): boolean {
  const resolved = language ? aliases.get(language.toLowerCase()) : undefined;
  return Boolean(
    resolved && singleton?.getLoadedLanguages().includes(resolved),
  );
}

export function highlightToHtml(
  code: string,
  language: string | undefined,
): string | undefined {
  const resolved = language ? aliases.get(language.toLowerCase()) : undefined;
  if (!resolved || !ensureLanguage(resolved)) return undefined;
  return removeInlineTokenStyles(
    highlighter().codeToHtml(code, {
      lang: resolved,
      theme: "css-variables",
      structure: "inline",
    }),
  );
}

export interface HighlightToken {
  content: string;
  className: string;
}

/** Text tokens for surfaces that combine syntax with their own annotations. */
export function highlightToTokens(
  code: string,
  language: string | undefined,
): HighlightToken[][] | undefined {
  const resolved = language ? aliases.get(language.toLowerCase()) : undefined;
  if (!resolved || !ensureLanguage(resolved)) return undefined;
  try {
    const { tokens } = highlighter().codeToTokens(code, {
      lang: resolved,
      theme: "css-variables",
    });
    return tokens.map((line) =>
      line.map((token) => {
        // Neither source text nor grammar attributes can become HTML, CSS, or
        // attributes. Only this existing, closed vocabulary reaches the DOM.
        const classes = [
          shikiStyleClasses.get(`color:${token.color}`) ??
            "shiki-color-foreground",
        ];
        const fontStyle = token.fontStyle ?? 0;
        if (fontStyle > 0) {
          if (fontStyle & 1) classes.push("shiki-italic");
          if (fontStyle & 2) classes.push("shiki-bold");
          if (fontStyle & 4) classes.push("shiki-underline");
        }
        return { content: token.content, className: classes.join(" ") };
      }),
    );
  } catch {
    // A grammar failure must never hide an authoritative code preview.
    return undefined;
  }
}

const shikiStyleClasses = new Map([
  ["background-color:var(--shiki-background)", "shiki-bg"],
  ["color:var(--shiki-foreground)", "shiki-color-foreground"],
  ["color:var(--shiki-token-constant)", "shiki-color-constant"],
  ["color:var(--shiki-token-string)", "shiki-color-string"],
  ["color:var(--shiki-token-comment)", "shiki-color-comment"],
  ["color:var(--shiki-token-keyword)", "shiki-color-keyword"],
  ["color:var(--shiki-token-parameter)", "shiki-color-parameter"],
  ["color:var(--shiki-token-function)", "shiki-color-function"],
  [
    "color:var(--shiki-token-string-expression)",
    "shiki-color-string-expression",
  ],
  ["color:var(--shiki-token-punctuation)", "shiki-color-punctuation"],
  ["color:var(--shiki-token-link)", "shiki-color-link"],
  ["font-style:italic", "shiki-italic"],
  ["font-weight:bold", "shiki-bold"],
  ["text-decoration:underline", "shiki-underline"],
]);

/** Converts Shiki's closed CSS-variable style vocabulary into static classes. */
function removeInlineTokenStyles(html: string): string | undefined {
  let valid = true;
  const transformed = html.replace(
    /(<(?:pre|span)\b[^>]*?) style="([^"]*)"/g,
    (_match, prefix: string, style: string) => {
      const classes = style
        .split(";")
        .filter(Boolean)
        .map((declaration) => shikiStyleClasses.get(declaration));
      if (classes.some((name) => name === undefined)) {
        valid = false;
        return prefix;
      }
      const names = classes.join(" ");
      if (!names) return prefix;
      return prefix.includes('class="')
        ? prefix.replace('class="', `class="${names} `)
        : `${prefix} class="${names}"`;
    },
  );
  return valid && !transformed.includes(' style="') ? transformed : undefined;
}
