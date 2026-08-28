import { expect, test, type Locator, type Page } from "@playwright/test";

const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = required("OCTOSCODE_LIVE_TOKEN");
const cwd = required("OCTOSCODE_LIVE_WORKSPACE");
const MARKER = "GLM_E2E_OK";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function productNavigation(page: Page): Locator {
  return page.getByRole("complementary", { name: "Product navigation" });
}

test("runs a GLM-5.3-Flash coding turn and restores it after refresh", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(endpoint);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const navigation = productNavigation(page);
  await expect(navigation).toBeVisible({ timeout: 30_000 });
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Add & Start" }).click();

  const permission = page.getByRole("button", { name: /^Permission:/ });
  const activateCoding = page.getByRole("button", {
    name: /^Activate coding/,
  });
  const onboarding = page.getByRole("dialog", {
    name: "Create your local coding profile",
  });
  await expect(
    permission.or(activateCoding).or(onboarding).first(),
  ).toBeVisible({ timeout: 30_000 });
  if (await onboarding.isVisible()) {
    throw new Error(
      "The live server requires Profile onboarding; configure it before the GLM gate.",
    );
  }
  if (await activateCoding.isVisible()) await activateCoding.click();

  await expect(page.locator(".workspace-title small")).toHaveText(cwd, {
    timeout: 30_000,
  });

  const launchError = page.getByRole("alert").first();
  await expect(permission.or(launchError).first()).toBeVisible({
    timeout: 30_000,
  });
  if (await launchError.isVisible()) {
    throw new Error(
      `The live Session could not open: ${await launchError.innerText()}`,
    );
  }
  await permission.click();
  const permissionMenu = page.getByRole("menu", { name: "Permission" });
  const workspaceWrite = permissionMenu
    .getByRole("menuitemradio", { name: /^Write ·/ })
    .first();
  await expect(workspaceWrite).toBeVisible();
  if ((await workspaceWrite.getAttribute("aria-checked")) !== "true") {
    await workspaceWrite.click();
    await expect(
      page.getByRole("button", { name: /^Permission: Write ·/ }),
    ).toBeVisible();
  } else {
    await page.keyboard.press("Escape");
  }

  const runtimeModel = page.getByRole("button", {
    name: /^Runtime model: .*glm[- .]?5\.3[- .]?flash/i,
  });
  await expect(runtimeModel).toBeVisible({ timeout: 30_000 });

  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await composer.fill(
    `Create GLM_E2E.md in this workspace with exactly one line: GLM-5.3-Flash web end-to-end verified. Read the file back with a tool. Do not modify anything else. After verification, reply with the exact marker ${MARKER}.`,
  );
  await page.getByRole("button", { name: "Send prompt" }).click();

  const result = page.locator(".entry-assistant").filter({ hasText: MARKER });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if ((await result.count()) > 0 && (await result.last().isVisible())) break;

    const approval = page.getByRole("dialog").filter({
      hasText: "Approval required",
    });
    if ((await approval.count()) > 0 && (await approval.first().isVisible())) {
      await approval
        .first()
        .getByRole("button", { name: /This session/ })
        .click();
    }

    const question = page.getByRole("dialog").filter({
      hasText: "Octos needs input",
    });
    if ((await question.count()) > 0 && (await question.first().isVisible())) {
      throw new Error("The bounded live task unexpectedly requested input");
    }
    await page.waitForTimeout(2_000);
  }
  await expect(result.last()).toBeVisible();

  await page.reload();

  await expect(page.locator(".workspace-title small")).toHaveText(cwd, {
    timeout: 30_000,
  });
  await expect(
    page.locator(".entry-assistant").filter({ hasText: MARKER }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^Runtime model: .*glm[- .]?5\.3[- .]?flash/i,
    }),
  ).toBeVisible({ timeout: 30_000 });

  const settingsButton = productNavigation(page).getByRole("button", {
    name: "Settings",
  });
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "General" }).click();
  await settings.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await expect(page.getByLabel("Server origin")).toHaveValue(endpoint);
  expect(
    (await page.getByLabel("Auth token").inputValue()).length,
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live model gate`);
  return value;
}
