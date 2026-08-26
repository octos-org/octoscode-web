import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { arch, platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("Usage: node scripts/fetch-pinned-core.mjs OUTPUT_DIRECTORY");
}

const contract = JSON.parse(
  await readFile(resolve(root, "packages/client/core-runtime.json"), "utf8"),
);
const platformKey = `${platform() === "darwin" ? "darwin" : platform()}-${arch()}`;
const asset = contract.assets?.[platformKey];
if (
  !asset ||
  typeof asset.name !== "string" ||
  typeof asset.sha256 !== "string" ||
  !/^[a-f0-9]{64}$/.test(asset.sha256) ||
  basename(asset.name) !== asset.name
) {
  throw new Error(`Pinned Core ${platformKey} asset metadata is invalid`);
}

const url = `${contract.repository}/releases/download/${contract.tag}/${asset.name}`;
let response;
let latestDownloadError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) break;
    latestDownloadError = new Error(
      `Pinned Core download failed with HTTP ${response.status}`,
    );
    await response.body?.cancel();
  } catch (reason) {
    latestDownloadError = reason;
  }
}
if (!response?.ok) {
  throw new Error("Pinned Core download failed after three attempts", {
    cause: latestDownloadError,
  });
}
const maximumAssetBytes = 512 * 1024 * 1024;
const declaredSize = Number(response.headers.get("content-length"));
if (Number.isFinite(declaredSize) && declaredSize > maximumAssetBytes) {
  throw new Error(`Pinned Core asset is unexpectedly large: ${declaredSize}`);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > maximumAssetBytes) {
  throw new Error(`Pinned Core asset exceeded ${maximumAssetBytes} bytes`);
}
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== asset.sha256) {
  throw new Error(`Pinned Core checksum mismatch: expected ${asset.sha256}`);
}

await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length !== 0) {
  throw new Error(
    `Pinned Core output directory is not empty: ${outputDirectory}`,
  );
}
const archive = resolve(outputDirectory, asset.name);
await writeFile(archive, bytes, { flag: "wx" });
const { stdout: listing } = await execFileAsync("tar", ["-tzf", archive]);
for (const entry of listing.split("\n").filter(Boolean)) {
  if (entry.startsWith("/") || entry.split("/").includes("..")) {
    throw new Error(`Pinned Core archive contains an unsafe path: ${entry}`);
  }
}
await execFileAsync("tar", ["-xzf", archive, "-C", outputDirectory]);
process.stdout.write(
  `Verified and extracted ${contract.tag} (${contract.revision.slice(0, 7)}) to ${outputDirectory}\n`,
);
