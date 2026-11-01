import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

it("defines every DSW and display custom property referenced by CSS", () => {
  const definitions = new Set<string>();
  const references = new Map<string, string[]>();
  for (const path of cssFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, path);
    const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/(--(?:dsw|display)-[\w-]+)\s*:/g)) {
      definitions.add(match[1]!);
    }
    for (const match of css.matchAll(/var\(\s*(--(?:dsw|display)-[\w-]+)/g)) {
      const name = match[1]!;
      const line = css.slice(0, match.index).split("\n").length;
      references.set(name, [
        ...(references.get(name) ?? []),
        `${relativePath}:${line}`,
      ]);
    }
  }
  const missing = [...references]
    .filter(([name]) => !definitions.has(name))
    .map(([name, locations]) => `${name} (${locations.join(", ")})`)
    .sort();
  expect(missing).toEqual([]);
});
