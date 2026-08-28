import { defineConfig, devices } from "@playwright/test";

const fixturePort = testPort("OCTOSCODE_E2E_FIXTURE_PORT", 50_080);
const webPort = testPort("OCTOSCODE_E2E_WEB_PORT", 4_173);
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const fixtureProfileAuthToken = "profile-scoped-e2e-token";
const fixtureAuthTokens = [
  "tab-scoped-e2e-token",
  "remember-this-tab-token",
  "forget-me-token",
  fixtureProfileAuthToken,
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI ? {} : { channel: "chrome" as const }),
      },
    },
  ],
  webServer: [
    {
      command: "pnpm mock:server",
      url: `${fixtureOrigin}/health`,
      env: {
        OCTOSCODE_MOCK_PORT: String(fixturePort),
        OCTOSCODE_MOCK_AUTH_MODE: "required",
        OCTOSCODE_MOCK_AUTH_TOKENS: fixtureAuthTokens.join(","),
        OCTOSCODE_MOCK_PROFILE_AUTH_TOKEN: fixtureProfileAuthToken,
        OCTOSCODE_MOCK_PROFILE_AUTH_ID: "coding",
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @octos-org/octoscode-web exec vite --host 127.0.0.1 --port ${webPort}`,
      url: webOrigin,
      env: { VITE_OCTOS_DEFAULT_ENDPOINT: fixtureOrigin },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});

function testPort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}
