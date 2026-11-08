import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
}

async function chooseTheme(page: Page, name: "Auto" | "Light" | "Dark") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("radio", { name, exact: true }).check();
  await settings.getByRole("button", { name: /Close/ }).click();
}

async function resolvedColors(page: Page) {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.append(probe);
    const colors: Record<string, string> = {};
    for (const name of rootStyle) {
      if (!/^--(?:dsw-(?:alias|specific)|shiki)/.test(name)) continue;
      // A custom property's computed text may still contain light-dark().
      // Resolve the color as a rendered property to test the actual palette.
      probe.style.color = `var(${name})`;
      colors[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return colors;
  });
}

test("theme choices preserve one palette across manual and system modes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await connect(page);
  const light = await resolvedColors(page);
  expect(Object.keys(light).length).toBeGreaterThan(50);
  expect(light["--dsw-alias-bg-base"]).toBe("rgb(255, 255, 255)");

  await chooseTheme(page, "Dark");
  const dark = await resolvedColors(page);
  expect(dark["--dsw-alias-bg-base"]).toBe("rgb(21, 21, 23)");
  expect(dark).not.toEqual(light);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await resolvedColors(page)).toEqual(dark);

  await chooseTheme(page, "Light");
  expect(await resolvedColors(page)).toEqual(light);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await resolvedColors(page)).toEqual(light);

  await chooseTheme(page, "Auto");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => resolvedColors(page)).toEqual(dark);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => resolvedColors(page)).toEqual(light);

  await chooseTheme(page, "Dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await resolvedColors(page)).toEqual(dark);
});

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
