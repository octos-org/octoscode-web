import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(root, "apps/web/src");
const files = (
  await Promise.all([
    walk(sourceRoot),
    walk(resolve(root, "packages/client/src")),
  ])
).flat();
const cssFiles = files.filter((file) => file.endsWith(".css"));
const sourceFiles = files.filter((file) => /\.(?:ts|tsx)$/.test(file));
const violations = [];
const generatedContractPath = resolve(
  root,
  "packages/client/src/generated/core-contract.ts",
);
const generatedContract = await readFile(generatedContractPath, "utf8");
const generatedVocabulary = [
  ...valuesFromObject("CORE_UI_METHODS"),
  ...valuesFromObject("CORE_UI_FEATURES"),
];
const legacyGlobalCss = new Set([
  resolve(sourceRoot, "app/theme.css"),
  resolve(sourceRoot, "app/styles.css"),
  resolve(sourceRoot, "features/markdown/markdown.css"),
]);

for (const file of cssFiles) {
  const text = await readFile(file, "utf8");
  if (!file.endsWith(".module.css") && !legacyGlobalCss.has(file)) {
    violations.push(`${relative(file)} is new global CSS; use a CSS Module`);
  }
  if (
    !file.endsWith("/app/theme.css") &&
    /#[0-9a-f]{3,8}\b|rgba?\(/i.test(text)
  ) {
    violations.push(`${relative(file)} contains a color outside theme.css`);
  }
  if (/--ds-(?!w-)/.test(text)) {
    violations.push(`${relative(file)} uses the retired --ds-* token prefix`);
  }
  for (const match of text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    if (Number(match[1]) < 11) {
      violations.push(`${relative(file)} contains sub-11px text`);
    }
  }
  for (const match of text.matchAll(/font:\s*[^;]*?\s(\d+(?:\.\d+)?)px\//g)) {
    if (Number(match[1]) < 11) {
      violations.push(`${relative(file)} contains sub-11px shorthand text`);
    }
  }
}

for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  if (/\bstyle\s*=\s*\{\{/.test(text)) {
    violations.push(`${relative(file)} contains an inline JSX style`);
  }
  if (file !== generatedContractPath && !/\.test\.[cm]?[jt]sx?$/.test(file)) {
    for (const value of generatedVocabulary) {
      if (text.includes(`"${value}"`) || text.includes(`'${value}'`)) {
        violations.push(
          `${relative(file)} handwrites generated Core vocabulary ${value}`,
        );
      }
    }
  }
}

const globalStyle = resolve(sourceRoot, "app/styles.css");
const globalStyleLines = (await readFile(globalStyle, "utf8")).split(
  "\n",
).length;
const globalStyleBudget = 2_877;
if (globalStyleLines > globalStyleBudget) {
  violations.push(
    `apps/web/src/app/styles.css grew to ${globalStyleLines} lines (budget ${globalStyleBudget}); new feature styles belong in CSS Modules`,
  );
}

const markdownStyle = await readFile(
  resolve(sourceRoot, "features/markdown/markdown.css"),
  "utf8",
);
if (
  !/\.markdown-body a\s*\{[^}]*text-decoration:\s*underline;/s.test(
    markdownStyle,
  )
) {
  violations.push(
    "markdown transcript links must remain distinguishable without color",
  );
}

const adrDirectory = resolve(root, "docs/adr");
for (const name of (await readdir(adrDirectory)).filter((name) =>
  /^\d{4}-.*\.md$/.test(name),
)) {
  const text = await readFile(resolve(adrDirectory, name), "utf8");
  if (
    !/^# ADR \d{4}: .+\n\n- Status: (?:Proposed|Accepted|Superseded)\n- Date: \d{4}-\d{2}-\d{2}\n/.test(
      text,
    )
  ) {
    violations.push(`docs/adr/${name} does not use canonical ADR metadata`);
  }
}

for (const workflow of await walk(resolve(root, ".github/workflows"))) {
  const text = await readFile(workflow, "utf8");
  for (const match of text.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)) {
    if (!/^[a-f0-9]{40}$/.test(match[1])) {
      violations.push(
        `${relative(workflow)} uses an unpinned action ref ${match[1]}`,
      );
    }
  }
  if (text.includes("--clobber")) {
    violations.push(`${relative(workflow)} permits release asset replacement`);
  }
}

if (violations.length) {
  throw new Error(
    `Repository policy violations:\n- ${violations.join("\n- ")}`,
  );
}
process.stdout.write(
  `Verified UI token, CSS ownership, inline-style, and ADR metadata policies (${globalStyleLines}/${globalStyleBudget} global CSS lines).\n`,
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

function relative(file) {
  return file.slice(root.length + 1);
}

function valuesFromObject(name) {
  const body = generatedContract.match(
    new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`),
  )?.[1];
  if (!body) throw new Error(`Could not read generated ${name}`);
  return [...body.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
}
