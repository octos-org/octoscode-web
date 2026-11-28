import { expect, test } from "@playwright/test";

import { connectAndStartWorkspace } from "./fixture-session";

/**
 * Help (N11a-F02): a visible Help button opens the help on a desktop and from
 * the phone drawer, without a keyboard. It explains getting files back, keeps
 * the `?` shortcut outside the message box, and returns focus to its opener.
 */
test("Help opens from the sidebar on desktop and phone and returns focus", async ({
  page,
}) => {
  await connectAndStartWorkspace(page, "/srv/work/help");
  const dialog = page.getByRole("dialog", { name: "Help" });
  const help = page.getByRole("button", { name: "Help", exact: true });

  // In the message box `?` is text, not a shortcut.
  const composer = page.locator(".composer textarea");
  await composer.press("?");
  await expect(composer).toHaveValue("?");
  await expect(dialog).toHaveCount(0);

  await help.click();
  await expect(
    dialog.getByRole("heading", { name: "Get files back" }),
  ).toBeVisible();
  await expect(dialog.getByText(/^Attach files with Files/)).toBeVisible();
  // Chat is off in this browser, so the help does not describe it.
  await expect(dialog.getByText("Allow file outputs")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();

  // Outside a text field `?` opens the same help.
  await help.press("?");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close help" }).click();
  await expect(dialog).toHaveCount(0);

  // A phone opens it from the drawer, above it, and goes back to the drawer.
  await page.addInitScript(() =>
    localStorage.setItem("octoscode-web.two-modes", "on"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Open sessions" }).click();
  const drawer = page.getByRole("dialog", { name: "Sessions and workspaces" });
  const drawerHelp = drawer.getByRole("button", { name: "Help", exact: true });
  await drawerHelp.click();
  await expect(dialog.getByText("Allow file outputs")).toBeVisible();
  await expect(dialog).toBeInViewport();
  await dialog.getByRole("button", { name: "Close help" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawerHelp).toBeFocused();
});
