import { expect, test, type Page } from "@playwright/test";
import { connect as connectForm } from "./fixture-session";
import { openSettings } from "./sessions";

async function connect(page: Page) {
  await connectForm(page);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
}

async function chooseTheme(page: Page, name: "Auto" | "Light" | "Dark") {
  const settings = await openSettings(page);
  await settings.getByRole("radio", { name, exact: true }).check();
  await settings.getByRole("button", { name: /Close/ }).click();
}

test("blocked localStorage property keeps connection, session launch, and theme usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Browser storage blocked", "SecurityError");
      },
    });
  });

  await connect(page);
  expect(
    await page.evaluate(() => {
      try {
        void window.localStorage;
        return null;
      } catch (error) {
        return error instanceof DOMException ? error.name : "unknown";
      }
    }),
  ).toBe("SecurityError");
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/blocked-localStorage");
  await page.getByRole("button", { name: "Start session" }).click();
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeVisible();
  // Retargeted after the v0.10.0 rebase: this gate proves the launched
  // Session rendered its conversation surface. A fresh Session no longer
  // inherits the fixture's static demo transcript (pinned by
  // e2e/product.spec.ts), so the surface it renders is the conversation
  // empty state instead of that transcript's "external links" prose.
  await expect(
    page.getByRole("heading", {
      name: "What can Octos help with?",
    }),
  ).toBeVisible();
  await composer.fill("Keep this draft while changing the theme.");

  await chooseTheme(page, "Dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await chooseTheme(page, "Light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await chooseTheme(page, "Auto");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(composer).toHaveValue(
    "Keep this draft while changing the theme.",
  );
  await expect(
    page.getByText("Client view unavailable", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
