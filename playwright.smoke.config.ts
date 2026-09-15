import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testMatch: "**/*.smoke.ts",
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
