import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "vite";
import { describe, expect, it } from "vitest";
import { loadChineseCatalog } from "./ui-text.tsx";

/**
 * Missing-translation gate (audit W1/H2). The UI falls back to English for
 * any source string the zh catalog lacks, silently, so this walks the shipped
 * source and fails on:
 *  - a literal `t("…")` key with no zh entry;
 *  - an aria-label, placeholder, title or alt written as a literal, which
 *    `t()` never sees, so a screen reader reads English in zh;
 *  - visible JSX text with English words, for the same reason.
 * Strings built elsewhere and passed to `t()` as variables are not visible
 * here; the zh screen scan in the audit tools covers those.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
// Names and code that read the same in every language.
const VERBATIM = new Set([
  "Octos",
  "Octoscode",
  "octoscode",
  "web",
  "GitHub",
  // The language picker names each language in itself.
  "English",
  // A command the user types.
  "octoscode onboard",
  // The case-sensitive search toggle's glyph.
  "Aa",
]);
const NAMED_ATTRIBUTES = new Set(["aria-label", "placeholder", "title", "alt"]);

interface Node {
  type: string;
  [key: string]: unknown;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith("-copy.ts") &&
      entry.name !== "zh.ts"
      ? [path]
      : [];
  });
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const value = node as Node;
  if (typeof value.type === "string") visit(value);
  for (const key in value) if (key !== "parent") walk(value[key], visit);
}

function literalText(node: unknown): string | null {
  const value = node as Node | null;
  if (value?.type === "Literal" && typeof value.value === "string")
    return value.value;
  if (
    value?.type === "TemplateLiteral" &&
    Array.isArray(value.expressions) &&
    value.expressions.length === 0
  )
    return (value.quasis as { value: { cooked: string } }[])[0]!.value.cooked;
  return null;
}

/** Example paths, URLs and code samples are not prose. */
const english = (text: string) =>
  /[A-Za-z]{2}/.test(text) &&
  !VERBATIM.has(text.trim()) &&
  !/^\s*(https?:\/\/|\/|~\/|\[)/.test(text);

/**
 * The strings an expression can render as-is: literals and template text,
 * through ternaries, `&&`/`||` and `+`. A call such as `t(…)` ends the search.
 */
function renderedStrings(node: unknown): string[] {
  const value = node as Node | null;
  if (!value) return [];
  switch (value.type) {
    case "Literal":
      return typeof value.value === "string" ? [value.value] : [];
    case "TemplateLiteral":
      return (value.quasis as { value: { cooked: string } }[]).map(
        (quasi) => quasi.value.cooked,
      );
    case "ConditionalExpression":
      return [
        ...renderedStrings(value.consequent),
        ...renderedStrings(value.alternate),
      ];
    case "LogicalExpression":
    case "BinaryExpression":
      return [...renderedStrings(value.left), ...renderedStrings(value.right)];
    default:
      return [];
  }
}

const findings = (() => {
  const keys = new Map<string, string>();
  const attributes: string[] = [];
  const texts: string[] = [];
  for (const path of sources(SRC)) {
    const name = relative(SRC, path);
    const source = readFileSync(path, "utf8");
    const parsed = parseSync(path, source, {
      lang: path.endsWith(".tsx") ? "tsx" : "ts",
    });
    expect(parsed.errors, name).toEqual([]);
    const line = (offset: number) => source.slice(0, offset).split("\n").length;
    walk(parsed.program, (node) => {
      if (
        node.type === "CallExpression" &&
        (node.callee as Node).type === "Identifier" &&
        (node.callee as Node).name === "t"
      ) {
        const key = literalText((node.arguments as unknown[])[0]);
        if (key !== null && english(key)) keys.set(key, name);
      } else if (node.type === "JSXAttribute") {
        if ((node.value as Node | null)?.type === "JSXExpressionContainer")
          (node.value as Node).inAttribute = true;
        const attribute = (node.name as Node).name as string;
        if (!NAMED_ATTRIBUTES.has(attribute)) return;
        let value = node.value as Node | null;
        if (value?.type === "JSXExpressionContainer")
          value = value.expression as Node;
        for (const text of renderedStrings(value))
          if (english(text))
            attributes.push(
              `${name}:${line(node.start as number)} ${attribute}="${text}"`,
            );
      } else if (
        node.type === "JSXExpressionContainer" &&
        node.inAttribute !== true
      ) {
        for (const text of renderedStrings(node.expression))
          if (english(text))
            texts.push(`${name}:${line(node.start as number)} ${text.trim()}`);
      } else if (node.type === "JSXText") {
        const text = String(node.value).replace(/\s+/g, " ").trim();
        if (text && english(text))
          texts.push(`${name}:${line(node.start as number)} ${text}`);
      }
    });
  }
  return { keys, attributes, texts };
})();

describe("zh catalog coverage", () => {
  it("translates every literal t() key", async () => {
    const catalog = await loadChineseCatalog();
    const missing = [...findings.keys]
      .filter(([key]) => !Object.prototype.hasOwnProperty.call(catalog, key))
      .map(([key, file]) => `${file}: ${key}`);
    expect(missing.sort()).toEqual([]);
  });

  it("routes accessible names, placeholders and tooltips through t()", () => {
    expect(findings.attributes.sort()).toEqual([]);
  });

  it("routes visible text through t()", () => {
    expect(findings.texts.sort()).toEqual([]);
  });
});
