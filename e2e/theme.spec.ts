import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Theme:/ })).toBeVisible();
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

test("theme cycle preserves one palette across manual and system modes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await connect(page);
  const light = await resolvedColors(page);
  expect(Object.keys(light).length).toBeGreaterThan(50);
  expect(light["--dsw-alias-bg-base"]).toBe("rgb(255, 255, 255)");

  await page
    .getByRole("button", { name: "Theme: system", exact: true })
    .click();
  const dark = await resolvedColors(page);
  expect(dark["--dsw-alias-bg-base"]).toBe("rgb(21, 21, 23)");
  expect(dark).not.toEqual(light);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await resolvedColors(page)).toEqual(dark);

  await page.getByRole("button", { name: "Theme: dark", exact: true }).click();
  expect(await resolvedColors(page)).toEqual(light);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await resolvedColors(page)).toEqual(light);

  await page.getByRole("button", { name: "Theme: light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => resolvedColors(page)).toEqual(dark);
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => resolvedColors(page)).toEqual(light);

  await page
    .getByRole("button", { name: "Theme: system", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await resolvedColors(page)).toEqual(dark);
});

test("manual light preserves readable conversation and settings colors on a dark OS", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("dsw-theme", "light"));
  await connect(page);
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/theme-review");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("link", { name: "external links" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
      .violations,
  ).toEqual([]);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Forget server" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze())
      .violations,
  ).toEqual([]);
});

for (const method of ["getItem", "setItem", "removeItem"] as const) {
  test(`theme ${method} failure keeps the app usable and the in-memory theme active`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((failedMethod) => {
      const original = Storage.prototype[failedMethod];
      Storage.prototype[failedMethod] = function (
        key: string,
        ...args: string[]
      ) {
        if (key === "dsw-theme") {
          throw new DOMException(
            "Theme preference unavailable",
            failedMethod === "setItem" ? "QuotaExceededError" : "SecurityError",
          );
        }
        return Reflect.apply(original, this, [key, ...args]);
      };
    }, method);
    await connect(page);
    await page
      .getByRole("button", { name: "Theme: system", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Theme: dark", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Theme: light", exact: true })
      .click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(page.getByLabel("Server workspace path")).toBeVisible();
    await expect(
      page.getByText("Client view unavailable", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const storageKind of ["localStorage", "sessionStorage"] as const) {
  test(`blocked ${storageKind} property keeps connection, session launch, and theme usable`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((kind) => {
      Object.defineProperty(window, kind, {
        configurable: true,
        get() {
          throw new DOMException("Browser storage blocked", "SecurityError");
        },
      });
    }, storageKind);

    await connect(page);
    expect(
      await page.evaluate((kind) => {
        try {
          void window[kind];
          return null;
        } catch (error) {
          return error instanceof DOMException ? error.name : "unknown";
        }
      }, storageKind),
    ).toBe("SecurityError");
    await page
      .getByLabel("Server workspace path")
      .fill(`/workspace/blocked-${storageKind}`);
    await page.getByRole("button", { name: "Start session" }).click();
    const composer = page.getByRole("textbox", { name: "Message Octos" });
    await expect(composer).toBeVisible();
    await expect(
      page.getByRole("link", { name: "external links" }),
    ).toBeVisible();
    await composer.fill("Keep this draft while changing the theme.");

    await page
      .getByRole("button", { name: "Theme: system", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Theme: dark", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Theme: light", exact: true })
      .click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(composer).toHaveValue(
      "Keep this draft while changing the theme.",
    );
    await expect(
      page.getByText("Client view unavailable", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
