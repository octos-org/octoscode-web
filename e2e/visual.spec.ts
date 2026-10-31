import AxeBuilder from "@axe-core/playwright";
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

test("session header actions align with a panel badge on desktop and mobile", async ({
  page,
}) => {
  await connect(page);
  await startDefaultWorkspace(page);
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");

  const actions = page.locator(".header-actions");
  const panelButton = page.getByRole("button", { name: /^Session panel/ });
  const menuButton = page.getByRole("button", {
    name: "More actions",
    exact: true,
  });
  await expect(panelButton).toContainText("1");
  const expectAligned = async () => {
    const [panel, menu] = await Promise.all([
      panelButton.boundingBox(),
      menuButton.boundingBox(),
    ]);
    if (!panel || !menu) throw new Error("Expected both header actions");
    expect(Math.abs(panel.y - menu.y)).toBeLessThanOrEqual(1);
    expect(menu.x - (panel.x + panel.width)).toBeGreaterThanOrEqual(4);
  };

  await expectAligned();
  await expect(actions).toHaveScreenshot(
    "session-header-actions-desktop.png",
    SNAPSHOT,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAligned();
  await expect(actions).toHaveScreenshot(
    "session-header-actions-mobile.png",
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

test("connectors settings matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("button", { name: "Connectors", exact: true })
    .click();
  await expect(settings.getByText("Documentation MCP")).toBeVisible();
  await expect(settings).toHaveScreenshot("settings-connectors.png", SNAPSHOT);
});

test("scheduled tasks settings matches baseline", async ({ page }) => {
  await connect(page);
  await startDefaultWorkspace(page);
  await page
    .getByRole("complementary", { name: "Product navigation" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("button", { name: "Scheduled tasks", exact: true })
    .click();
  await expect(settings.getByText("Queue check")).toBeVisible();
  await expect(settings).toHaveScreenshot("settings-scheduled.png", SNAPSHOT);
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
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=large.csv&valid=1`,
  );
  expect(response.ok()).toBe(true);
  const attachment = page.locator('[data-attachment="large.csv"]');
  await attachment
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await expect(
    attachment.getByRole("cell", { name: "row-1", exact: true }),
  ).toBeVisible();
  await expect(attachment.locator('[class*="fileSize"]')).toHaveText(/\d/);
  await expect(attachment).toHaveScreenshot("artifact-preview.png", SNAPSHOT);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`shortcut help has an opaque themed surface (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await connect(page);
    await startDefaultWorkspace(page);
    await page.locator("#workspace-main").focus();
    await page.keyboard.type("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Command palette");
    const card = dialog.locator('[class*="card"]');
    await expect(dialog).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(card).toHaveCSS("border-style", "solid");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await expect(card).toHaveScreenshot(
      `shortcut-help-${colorScheme}.png`,
      SNAPSHOT,
    );
    if (colorScheme === "light") {
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Browser preferences", exact: true })
        .click();
      const preferences = page.locator('[role="dialog"]').filter({
        has: page.getByRole("heading", { name: "Browser preferences" }),
      });
      await preferences
        .locator('label:has-text("Language") select')
        .selectOption("zh");
      await page
        .getByRole("button", { name: "关闭偏好设置", exact: true })
        .click();
      await page.locator("#workspace-main").focus();
      await page.keyboard.type("?");
      const chinese = page.getByRole("dialog", { name: "键盘快捷键" });
      await expect(chinese).toContainText("命令面板");
      await expect(chinese).toContainText("向运行中的一轮插话");
      await expect(chinese.locator('[class*="card"]')).toHaveScreenshot(
        "shortcut-help-zh.png",
        SNAPSHOT,
      );
    }
  });

  test(`conversation search and highlights remain visible (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await connect(page);
    await startDefaultWorkspace(page);
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await composer.fill("Show the Markdown transcript surface");
    await composer.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Durable coding transcript" }),
    ).toBeVisible();
    await page.keyboard.press("Control+f");
    const search = page.getByRole("search");
    const input = page.getByPlaceholder("Search conversation");
    await input.fill("Durable");
    await expect(search.locator('[class*="count"]')).not.toContainText("0");
    await expect(input).toHaveCSS("border-style", "solid");
    await expect(input).toHaveCSS("outline-style", "solid");
    await expect(input).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      (await new AxeBuilder({ page }).include('[role="search"]').analyze())
        .violations,
    ).toEqual([]);
    await expect(search).toHaveScreenshot(
      `conversation-search-bar-${colorScheme}.png`,
      SNAPSHOT,
    );
    await expect(
      page.getByRole("heading", { name: "Durable coding transcript" }),
    ).toHaveScreenshot(
      `conversation-search-highlight-${colorScheme}.png`,
      SNAPSHOT,
    );
  });
}

test("conversation actions have a visible hover background", async ({
  page,
}) => {
  await connect(page);
  await startDefaultWorkspace(page);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Conversation actions" });
  const item = menu.getByRole("menuitem", { name: "Browser preferences" });
  await item.hover();
  await expect(item).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    (await new AxeBuilder({ page }).include('[role="menu"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(menu).toHaveScreenshot(
    "conversation-actions-hover.png",
    SNAPSHOT,
  );
});
