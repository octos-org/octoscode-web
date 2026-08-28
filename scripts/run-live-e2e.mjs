import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

// This must exist before Playwright starts its worker process. Setting it in
// playwright.live.config.ts is too late: a failed handshake can otherwise put
// the password-field value in Playwright's automatic accessibility snapshot.
const child = spawn(
  process.execPath,
  [playwrightCli, "test", "--config", "playwright.live.config.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_NO_COPY_PROMPT: "1" },
  },
);

child.once("error", (error) => {
  console.error("Could not start the live Playwright gate:", error.message);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Live Playwright gate stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
