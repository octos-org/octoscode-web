import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "apps/web/dist");
const nginx = await readFile(resolve(root, "deploy/nginx.conf"), "utf8");
const html = await readFile(resolve(dist, "index.html"), "utf8");
const manifest = JSON.parse(
  await readFile(resolve(dist, "octoscode-web-build.json"), "utf8"),
);
const runtime = JSON.parse(
  await readFile(resolve(root, "packages/client/core-runtime.json"), "utf8"),
);

for (const required of [
  "Content-Security-Policy",
  "default-src 'none'",
  "connect-src 'self'",
  'Referrer-Policy "no-referrer"',
  'X-Content-Type-Options "nosniff"',
  "Permissions-Policy",
  "log_format octoscode_privacy",
  '"$request_method $uri"',
  'Cache-Control "public, max-age=31536000, immutable"',
  'Cache-Control "no-cache"',
  "proxy_set_header Upgrade $http_upgrade",
  "try_files $uri $uri/ /index.html",
]) {
  assert(
    nginx.includes(required),
    `nginx deployment contract is missing ${required}`,
  );
}

const logFormat = nginx.match(/log_format octoscode_privacy ([\s\S]*?);/)?.[0];
assert(logFormat, "nginx privacy log format is missing");
for (const forbidden of [
  "$request_uri",
  "$args",
  "$query_string",
  "$request ",
]) {
  assert(
    !logFormat.includes(forbidden),
    `nginx privacy log exposes ${forbidden}`,
  );
}

assert(manifest.schema_version === 2, "build manifest schema is invalid");
assert(
  manifest.supported_octos_contract?.protocol === "octos-ui/v1alpha1",
  "build manifest protocol is invalid",
);
for (const key of ["repository", "tag", "version", "revision"]) {
  assert(
    manifest.verified_core_runtime?.[key] === runtime[key],
    `build manifest runtime ${key} is invalid`,
  );
}
for (const key of [
  "required_web_methods",
  "required_web_features",
  "required_solo_onboarding_methods",
  "forward_compatible_methods",
]) {
  assert(
    JSON.stringify(manifest.verified_core_runtime?.[key]) ===
      JSON.stringify(runtime[key]),
    `build manifest runtime ${key} is invalid`,
  );
}

const initialAssets = [
  ...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g),
].map((match) => match[1]);
assert(initialAssets.length >= 2, "built index has no initial assets");
let initialJavaScriptBytes = 0;
let initialCssBytes = 0;
for (const asset of initialAssets) {
  assert(
    asset.startsWith("/assets/"),
    `unexpected initial asset path ${asset}`,
  );
  assert(
    /-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(asset),
    `asset is not content-hashed: ${asset}`,
  );
  const size = (await stat(resolve(dist, asset.slice(1)))).size;
  if (asset.endsWith(".js")) initialJavaScriptBytes += size;
  if (asset.endsWith(".css")) initialCssBytes += size;
}
assert(
  initialJavaScriptBytes <= 350 * 1024,
  `initial JavaScript budget exceeded: ${initialJavaScriptBytes} bytes`,
);
assert(
  initialCssBytes <= 80 * 1024,
  `initial CSS budget exceeded: ${initialCssBytes} bytes`,
);

const assetFiles = await readdir(resolve(dist, "assets"));
assert(
  assetFiles.every((name) => !name.endsWith(".map")),
  "production distribution must not publish source maps",
);

process.stdout.write(
  `Verified deployment contract (${initialJavaScriptBytes} B initial JS, ${initialCssBytes} B initial CSS).\n`,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
