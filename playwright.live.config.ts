import { defineConfig, devices } from "@playwright/test";

const webPort = livePort("OCTOSCODE_LIVE_WEB_PORT", 4_174);
const webOrigin = `http://127.0.0.1:${webPort}`;
const proxyTarget = required("OCTOSCODE_LIVE_PROXY_TARGET");
const proxyOrigin = required("OCTOSCODE_LIVE_PROXY_ORIGIN");

export default defineConfig({
  testDir: "./e2e-live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webOrigin,
    channel: "chrome",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: `pnpm --filter @octos-org/octoscode-web build && pnpm --filter @octos-org/octoscode-web exec vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: webOrigin,
    env: {
      VITE_OCTOS_DEFAULT_ENDPOINT: webOrigin,
      OCTOSCODE_DEV_PROXY_TARGET: proxyTarget,
      OCTOSCODE_DEV_PROXY_ORIGIN: proxyOrigin,
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live model gate`);
  return value;
}

function livePort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}
