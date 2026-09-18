import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const fixtureOrigin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;

async function openSession(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(fixtureOrigin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByLabel("Server workspace path")
    .fill("/workspace/release-readiness");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByLabel("Message Octos")).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 320, height: 480 },
]) {
  test(`settings preserves its loading geometry at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "**/features/product-controls/SettingsDialog.tsx*",
      async (route) => {
        await ready;
        await route.continue();
      },
    );
    try {
      await openSession(page);
      if (viewport.width < 760)
        await page.getByRole("button", { name: "Open sessions" }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const loading = page.getByRole("dialog", {
        name: "Loading settings…",
        exact: true,
      });
      await expect(loading).toBeVisible();
      await expect(
        loading.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      const before = await loading.boundingBox();
      release();
      const loaded = page.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      await expect(loaded).toBeVisible();
      expect(await loaded.boundingBox()).toEqual(before);
      await page
        .getByRole("button", { name: "Close settings", exact: true })
        .click();
      await expect(page.getByLabel("Message Octos")).toBeVisible();
    } finally {
      release();
    }
  });
}

test("skip link bypasses navigation and multiline commands retain valid accessibility semantics", async ({
  page,
}) => {
  await openSession(page);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest("main"))),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest("aside")),
    ),
  ).toBe(false);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("/");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(composer).toHaveAttribute(
    "aria-controls",
    (await page.getByRole("listbox").getAttribute("id")) ?? "",
  );
  const paletteAudit = await new AxeBuilder({ page })
    .withRules([
      "aria-allowed-role",
      "aria-allowed-attr",
      "aria-valid-attr-value",
    ])
    .analyze();
  expect(paletteAudit.violations).toEqual([]);
  await composer.press("ArrowDown");
  const active = await composer.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await composer.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await composer.fill("Draft line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Draft line two");
  await expect(composer).toHaveValue("Draft line one\nDraft line two");
});

test("empty session search offers a direct way back and replies use the chat column", async ({
  page,
}) => {
  await openSession(page);
  // A freshly launched Session no longer hydrates the fixture's static demo
  // transcript (that is pinned deliberately by "A newly created Session must
  // not inherit the static demo transcript" in e2e/product.spec.ts), so drive
  // one turn to put real assistant prose on screen for the width measurement
  // at the end of this test.
  await page.getByLabel("Message Octos").fill("Stream a reply fixture");
  await page.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.getByText("Completed with")).toBeVisible();
  await page
    .getByRole("button", { name: "Search sessions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search sessions", exact: true })
    .fill("no-such-session-release010");
  await expect(
    page.getByText("No sessions match “no-such-session-release010”.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search sessions", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Search sessions", exact: true }),
  ).toHaveValue("");
  // A reply uses the whole chat column (code and tables need the room); it is
  // not held to a prose measure narrower than the composer beneath it.
  const width = await page.evaluate(() => {
    const reply = document.querySelector(".entry-assistant .entry-content");
    const column = document.querySelector(".timeline");
    return {
      maxWidth: reply ? getComputedStyle(reply).maxWidth : null,
      reply: reply?.getBoundingClientRect().width ?? 0,
      column: column?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(width.maxWidth).toBe("none");
  expect(width.column).toBeGreaterThan(0);
  expect(width.column - width.reply).toBeLessThan(1);
});
