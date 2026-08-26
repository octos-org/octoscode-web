import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceMetadataPath = resolve(
  repositoryRoot,
  "packages/client/contract-source.json",
);
const generatedPath = resolve(
  repositoryRoot,
  "packages/client/src/generated/core-contract.ts",
);

const mode = process.argv.includes("--write") ? "write" : "check";
const sourceArgumentIndex = process.argv.indexOf("--source");
const sourcePath =
  sourceArgumentIndex >= 0 ? process.argv[sourceArgumentIndex + 1] : undefined;
if (sourceArgumentIndex >= 0 && !sourcePath) {
  throw new Error("--source requires a path to ui_protocol.rs");
}

const metadata = JSON.parse(await readFile(sourceMetadataPath, "utf8"));
validateMetadata(metadata);
const source = sourcePath
  ? await readFile(resolve(sourcePath))
  : await fetchPinnedSource(metadata);
verifyGitBlob(source, metadata.contract_blob);
const generated = generateContractIndex(source.toString("utf8"), metadata);

if (mode === "write") {
  await mkdir(dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, generated);
  process.stdout.write(`Wrote ${generatedPath}\n`);
} else {
  const current = await readFile(generatedPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write(
      "Generated Core contract index is stale. Run pnpm contract:update.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Verified Core contract ${metadata.revision} (${metadata.contract_blob}).\n`,
    );
  }
}

async function fetchPinnedSource(sourceMetadata) {
  const repository = new URL(sourceMetadata.repository);
  const [owner, name] = repository.pathname.split("/").filter(Boolean);
  if (repository.hostname !== "github.com" || !owner || !name) {
    throw new Error("contract repository must be a canonical GitHub URL");
  }
  const blobEndpoint = `repos/${owner}/${name}/git/blobs/${sourceMetadata.contract_blob}`;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", blobEndpoint, "-H", "Accept: application/vnd.github.raw+json"],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    return Buffer.from(stdout);
  } catch (cliReason) {
    const url = new URL(
      `https://raw.githubusercontent.com/${owner}/${name}/${sourceMetadata.revision}/${sourceMetadata.path}`,
    );
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain",
        "User-Agent": "octoscode-web-contract",
      },
      signal: AbortSignal.timeout(30_000),
    }).catch((fetchReason) => {
      throw new AggregateError(
        [cliReason, fetchReason],
        "Could not fetch the pinned Core contract through GitHub CLI or raw HTTPS",
      );
    });
    if (!response.ok) {
      throw new Error(
        `Core contract fetch failed with HTTP ${response.status}`,
        { cause: cliReason },
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

function validateMetadata(value) {
  for (const key of ["repository", "revision", "contract_blob", "path"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`contract-source.json has invalid ${key}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(value.revision)) {
    throw new Error("contract revision must be a full Git commit SHA");
  }
  if (!/^[0-9a-f]{40}$/.test(value.contract_blob)) {
    throw new Error("contract blob must be a Git SHA-1");
  }
  if (value.path.startsWith("/") || value.path.includes("..")) {
    throw new Error("contract path must stay repository-relative");
  }
}

function verifyGitBlob(source, expected) {
  const header = Buffer.from(`blob ${source.byteLength}\0`);
  const actual = createHash("sha1").update(header).update(source).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Core contract blob mismatch: expected ${expected}, received ${actual}`,
    );
  }
}

function generateContractIndex(source, sourceMetadata) {
  const protocol = requiredStringConstant(source, "UI_PROTOCOL_V1");
  const schemaVersion = requiredIntegerConstant(
    source,
    "UI_PROTOCOL_SCHEMA_VERSION",
  );
  const capabilitiesSchemaVersion = requiredIntegerConstant(
    source,
    "UI_PROTOCOL_CAPABILITIES_SCHEMA_VERSION",
  );
  const jsonrpc = requiredStringConstant(source, "JSON_RPC_VERSION");
  const featureEntries = uniqueEntries(
    [
      ...source.matchAll(
        /pub const UI_PROTOCOL_FEATURE_([A-Z0-9_]+): &str\s*=\s*"([^"]+)";/gs,
      ),
    ].map((match) => [match[1], match[2]]),
    "feature",
  );
  const methodsStart = source.indexOf("pub mod methods {");
  const methodsEnd = source.indexOf(
    "\n}\n\n/// Reason codes for `approval/cancelled`",
    methodsStart,
  );
  if (methodsStart < 0 || methodsEnd < 0) {
    throw new Error("Could not locate the Core methods module");
  }
  const methodsSource = source.slice(methodsStart, methodsEnd);
  const methodEntries = uniqueEntries(
    [
      ...methodsSource.matchAll(
        /pub const ([A-Z0-9_]+): &str\s*=\s*"([^"]+)";/gs,
      ),
    ].map((match) => [match[1], match[2]]),
    "method",
  );
  if (featureEntries.length < 10 || methodEntries.length < 50) {
    throw new Error(
      `Core contract parse was suspiciously small (${featureEntries.length} features, ${methodEntries.length} methods)`,
    );
  }
  const methodValues = Object.fromEntries(methodEntries);
  const featureValues = Object.fromEntries(featureEntries);
  const knownFeatures = extractReferences(
    source,
    "UI_PROTOCOL_KNOWN_FEATURES",
    "UI_PROTOCOL_FEATURE_",
  ).map((name) => requiredEntry(featureValues, name, "feature"));
  const serverMethods = extractReferences(
    source,
    "UI_PROTOCOL_FIRST_SERVER_METHODS",
    "methods::",
  ).map((name) => requiredEntry(methodValues, name, "method"));
  const notifications = extractReferences(
    source,
    "UI_PROTOCOL_NOTIFICATION_METHODS",
    "methods::",
  ).map((name) => requiredEntry(methodValues, name, "method"));

  const protocolEntries = Object.entries({
    protocol,
    schema_version: schemaVersion,
    capabilities_schema_version: capabilitiesSchemaVersion,
    jsonrpc,
  });
  return `${"// Generated by scripts/sync-core-contract.mjs. Do not edit by hand.\n"}\nexport const CORE_UI_CONTRACT_SOURCE = ${formatObject(
    Object.entries(sourceMetadata),
  )} as const;\n\nexport const CORE_UI_PROTOCOL = ${formatObject(
    protocolEntries,
  )} as const;\n\nexport const CORE_UI_FEATURES = ${formatObject(
    featureEntries,
  )} as const;\n\nexport const CORE_UI_METHODS = ${formatObject(
    methodEntries,
  )} as const;\n\nexport const CORE_UI_KNOWN_FEATURES = ${formatArray(
    knownFeatures,
  )} as const;\n\nexport const CORE_UI_SERVER_METHODS = ${formatArray(
    serverMethods,
  )} as const;\n\nexport const CORE_UI_NOTIFICATION_METHODS = ${formatArray(
    notifications,
  )} as const;\n`;
}

function formatObject(entries) {
  return `{\n${entries
    .map(([key, value]) => {
      const serialized = JSON.stringify(value);
      const line = `  ${key}: ${serialized},`;
      return line.length > 80 ? `  ${key}:\n    ${serialized},` : line;
    })
    .join("\n")}\n}`;
}

function formatArray(values) {
  return `[\n${values.map((value) => `  ${JSON.stringify(value)},`).join("\n")}\n]`;
}

function requiredStringConstant(source, name) {
  const match = source.match(
    new RegExp(`pub const ${name}: &str\\s*=\\s*"([^"]+)";`, "s"),
  );
  if (!match) throw new Error(`Core contract is missing ${name}`);
  return match[1];
}

function requiredIntegerConstant(source, name) {
  const match = source.match(new RegExp(`pub const ${name}: u32 = ([0-9]+);`));
  if (!match) throw new Error(`Core contract is missing ${name}`);
  return Number(match[1]);
}

function extractReferences(source, constant, prefix) {
  const start = source.indexOf(`pub const ${constant}: &[&str] = &[`);
  const end = source.indexOf("];", start);
  if (start < 0 || end < 0) {
    throw new Error(`Core contract is missing ${constant}`);
  }
  const body = source.slice(start, end);
  return [...body.matchAll(new RegExp(`${prefix}([A-Z0-9_]+)`, "g"))].map(
    (match) => match[1],
  );
}

function requiredEntry(entries, name, kind) {
  const value = entries[name];
  if (!value) throw new Error(`Unknown ${kind} reference ${name}`);
  return value;
}

function uniqueEntries(entries, kind) {
  const unique = new Map();
  for (const [name, value] of entries) {
    const previous = unique.get(name);
    if (previous !== undefined && previous !== value) {
      throw new Error(
        `Core contract has conflicting ${kind} ${name}: ${previous} and ${value}`,
      );
    }
    unique.set(name, value);
  }
  return [...unique.entries()];
}
