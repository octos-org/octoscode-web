import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SNAPSHOT = {
  animations: "disabled" as const,
  caret: "hide" as const,
  maxDiffPixelRatio: 0.01,
};

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).click();
  }
  const path = page.getByLabel("Server workspace path");
  await path.fill(workspace);
  await path.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

test("keeps Chat and Trajectory fixed when the panel badge appears", async ({
  page,
}) => {
  await start(page, "/workspace/diff-review");
  const tabs = page.getByRole("navigation", { name: "Session views" });
  const before = await tabs.boundingBox();
  expect(before).not.toBeNull();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");
  await expect(
    page.getByRole("button", { name: "Session panel, 1 changed" }),
  ).toBeVisible();
  const after = await tabs.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  await expect(page.locator(".conversation-header").first()).toHaveScreenshot(
    "session-header-badge.png",
    SNAPSHOT,
  );
});

test("keeps Trajectory clickable beside header actions at narrow and resized widths", async ({
  page,
}) => {
  await start(page, "/workspace/diff-review");
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("Review syntax fixture");
  await composer.press("Enter");
  const panelButton = page.getByRole("button", {
    name: "Session panel, 1 changed",
  });
  await panelButton.click();
  const trajectory = page.getByRole("button", {
    name: "Trajectory",
    exact: true,
  });
  const expectClickable = async () => {
    expect(
      await trajectory.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          document
            .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.closest("button") === element
        );
      }),
    ).toBe(true);
    await trajectory.click();
    await expect(trajectory).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
  };

  for (const width of [900, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await expectClickable();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  const edge = page.getByRole("separator", { name: "Resize session panel" });
  const before = Number(await edge.getAttribute("aria-valuenow"));
  const box = await edge.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 - 180,
    box!.y + box!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await edge.getAttribute("aria-valuenow")))
    .toBeGreaterThan(before + 150);
  await expectClickable();
});

test("consolidates appearance and browser preferences in Settings", async ({
  page,
}) => {
  await start(page, "/workspace/small-ui-settings");
  const navigation = page.getByRole("complementary", {
    name: "Product navigation",
  });
  await expect(navigation.getByRole("button", { name: /^Theme:/ })).toHaveCount(
    0,
  );
  const addWorkspace = navigation
    .getByRole("button", { name: "Add workspace", exact: true })
    .first();
  expect((await addWorkspace.boundingBox())!.height).toBe(32);
  const selected = navigation
    .locator('[role="treeitem"][aria-selected="true"]')
    .first();
  await expect(selected).toBeVisible();
  expect(
    await selected.evaluate((element) => getComputedStyle(element).boxShadow),
  ).toContain("inset");

  await navigation
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const appearance = dialog.getByRole("region", {
    name: "Light / dark appearance",
  });
  await appearance.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await appearance.getByRole("radio", { name: "Light", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const browser = dialog.getByRole("region", { name: "Browser preferences" });
  await expect(browser.getByLabel("Language")).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "Save browser preferences" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await expect(dialog).toHaveScreenshot(
    "settings-general-unified.png",
    SNAPSHOT,
  );
  await dialog.getByRole("button", { name: /Close/ }).click();

  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Conversation actions" });
  await expect(
    menu.getByRole("menuitem", { name: "Browser preferences" }),
  ).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /Copy/ })).toBeVisible();
});
