import { defineConfig, devices } from "@playwright/test";

const fixturePort = testPort("OCTOSCODE_E2E_FIXTURE_PORT", 50_080);
const webPort = testPort("OCTOSCODE_E2E_WEB_PORT", 4_173);
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const fixtureProfileAuthToken = "profile-scoped-e2e-token";
const fixtureAuthTokens = [
  "tab-scoped-e2e-token",
  // WEB-WORKSPACE-BROWSER-CONTRACT-5000: the fixture advertises
  // `onboarding.workspace_browse.v1` only to this token, so the same server
  // also serves the feature-absent (no Browse affordance) case.
  "workspace-browse-e2e-token",
  // plan.todos.v1: the fixture streams a plan sequence only to the first
  // token, and drops the feature entirely for the second, so one server
  // serves both the plan card and the feature-absent (no card) case.
  "plan-fixture-e2e-token",
  "plan-absent-e2e-token",
  "remember-this-tab-token",
  "forget-me-token",
  fixtureProfileAuthToken,
];
const e2eChannel = explicitBrowserChannel("OCTOSCODE_E2E_CHANNEL");
const buildCommand =
  process.env.OCTOSCODE_E2E_SKIP_BUILD === "1" ? "" : "pnpm build && ";

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
        // Default to the Playwright-bundled Chromium so the product gate runs
        // on any machine that ran `playwright install chromium`. Developers
        // with a real browser may opt into a release channel explicitly;
        // CI keeps the hermetic bundled default.
        ...(e2eChannel ? { channel: e2eChannel } : {}),
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
      command: `${buildCommand}pnpm --filter @octos-org/octoscode-web exec vite preview --host 127.0.0.1 --port ${webPort}`,
      url: webOrigin,
      env: { VITE_OCTOS_DEFAULT_ENDPOINT: fixtureOrigin },
      reuseExistingServer: false,
      timeout: 120_000,
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

function explicitBrowserChannel(name: string): string | undefined {
  const channel = process.env[name]?.trim();
  if (!channel) return undefined;
  return channel;
}
