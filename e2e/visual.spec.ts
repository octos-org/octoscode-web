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

async function connect(
  page: Page,
  token = "tab-scoped-e2e-token",
): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(token);
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

test("connect gate matches baseline", async ({ page, request }) => {
  // The gate probes /pair/info for the origin this browser saw and offers
  // "Found Octos on …" when the server answers. The fixture's pairing state is
  // process-wide, so without this reset the baseline captures whatever an
  // earlier spec in the same shard happened to leave staged — which is exactly
  // how the committed baseline came to contain an offer that only some shard
  // orderings reproduce. Pin the unpaired gate.
  const reset = await request.post(
    `${FIXTURE_ORIGIN}/__test__/pair/reset?mode=unsupported`,
  );
  expect(reset.status()).toBe(204);
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
  // Capture the whole page: a takeover must not push the header out of view.
  await expect(page).toHaveScreenshot("approval-card.png", SNAPSHOT);
});

test("empty session template home matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  await expect(
    page.getByRole("region", { name: "What can Octos help with?" }),
  ).toBeVisible();
  await expect(page.locator(".workspace-grid")).toHaveScreenshot(
    "session-templates.png",
    SNAPSHOT,
  );
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
  await expect(page.locator(".workspace-grid")).toHaveScreenshot(
    "session-reply.png",
    SNAPSHOT,
  );
});

test("skills settings matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    settings.getByText("lifecycle-skill", { exact: true }),
  ).toBeVisible();
  await expect(settings).toHaveScreenshot("settings-skills.png", SNAPSHOT);
});

test("memory settings matches baseline", async ({ page }) => {
  await connect(page, "memory-e2e-token");
  await startDefaultWorkspace(page);
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(settings.getByText("Protocol memory fixture.")).toBeVisible();
  await expect(settings).toHaveScreenshot("settings-memory.png", SNAPSHOT);
});

test("artifact preview matches baseline", async ({ page, request }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  const reference = new URL(page.url()).searchParams.get("s");
  const sessionId = (JSON.parse(reference!) as string[])[2]!;
  const response = await request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=budget.xlsx&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const attachment = page.locator('[data-attachment="budget.xlsx"]');
  await attachment
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await expect(attachment.getByRole("cell", { name: "Revenue" })).toBeVisible();
  await expect(attachment.locator('[class*="fileSize"]')).toHaveText(/\d/);
  await expect(attachment).toHaveScreenshot("artifact-preview.png", SNAPSHOT);
});
