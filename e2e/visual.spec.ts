import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${
  process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"
}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

// Visual baselines: freeze animations (skeleton pulse, stagger, spinner),
// hide the caret, and tolerate sub-1% pixel noise so only layout/color
// regressions trip the gate. Baselines were generated on the bundled
// chromium build — keep local and CI on the same engine.
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

test.use({ channel: "chromium" });

async function connect(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("region", { name: /Choose a workspace|Add workspace/ }),
  ).toBeVisible();
}

async function startDefaultWorkspace(page: Page): Promise<void> {
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace).toBeVisible();
  await addWorkspace
    .getByLabel("Server workspace path")
    .fill("/workspace/octoscode-web");
  await addWorkspace.getByRole("button", { name: "Start session" }).click();
  await expect(addWorkspace).toBeHidden();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
}

test("connect gate matches baseline", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("connect-gate.png", SNAPSHOT);
});

test("empty chooser matches baseline", async ({ page }) => {
  await connect(page);
  await expect(
    page.getByRole("region", { name: /Choose a workspace|Add workspace/ }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("workspace-chooser.png", SNAPSHOT);
});

test("approval takeover matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Request approval fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  const approval = page.getByRole("dialog", { name: "Run product checks?" });
  await expect(approval).toBeVisible();
  await expect(approval).toHaveScreenshot("approval-card.png", SNAPSHOT);
});

test("session reply matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Stream a reply fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByText("Completed with")).toBeVisible();
  // Include the entire workspace, including the composer, so layout and
  // input placement remain part of the visual regression surface.
  await expect(page.locator("main")).toHaveScreenshot(
    "session-reply.png",
    SNAPSHOT,
  );
});
