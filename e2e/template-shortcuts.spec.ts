import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const storageKey = "octoscode.web.display.v1";
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const home = (page: Page) =>
  page.getByRole("region", { name: "What can Octos help with?" });
const group = (page: Page, name: "Favorites" | "Recently used") =>
  home(page).getByRole("region", { name, exact: true });
const card = (page: Page, id: string) =>
  home(page).locator(`li[data-template="${id}"]`);
const rows = (page: Page, name: "Favorites" | "Recently used") =>
  group(page, name)
    .locator("[data-shortcut-template]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-shortcut-template")),
    );
const stored = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null") as unknown,
    storageKey,
  );

async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(origin);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await expect(page.getByLabel("Server workspace path")).toBeVisible();
}

async function startSession(page: Page, cwd: string) {
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(composer(page)).toBeEnabled();
}

function countTurnStarts(page: Page): string[] {
  const starts: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (String(payload).includes('"method":"turn/start"')) starts.push("");
    }),
  );
  return starts;
}

test("favorites and recent templates keep their order, save only template IDs and survive a reload", async ({
  page,
}) => {
  const starts = countTurnStarts(page);
  await connect(page);
  await startSession(page, "/workspace/template-shortcuts");
  await expect(group(page, "Favorites")).toHaveCount(0);
  await expect(group(page, "Recently used")).toHaveCount(0);

  // Star from the cards: favorites keep the order they were starred in.
  const starFix = card(page, "fix-bug").getByRole("button", {
    name: "Favorite: Fix a bug",
  });
  await expect(starFix).toHaveAttribute("aria-pressed", "false");
  const top = async (id: string) => (await card(page, id).boundingBox())!.y;
  const before = await top("fix-bug");
  await starFix.click();
  await expect(starFix).toHaveAttribute("aria-pressed", "true");
  // The Favorites row appears above the card without moving it from under
  // the pointer.
  expect(Math.abs((await top("fix-bug")) - before)).toBeLessThan(2);
  await card(page, "weekly-report")
    .getByRole("button", { name: "Favorite: Write a weekly report" })
    .click();
  expect(await rows(page, "Favorites")).toEqual(["fix-bug", "weekly-report"]);
  // Starring is not using: the message box and recent list stay as they were.
  await expect(composer(page)).toHaveValue("");
  await expect(group(page, "Recently used")).toHaveCount(0);

  // A double click is one use, and Undo still returns to the empty box.
  // Recent rows keep the order this home opened with, so nothing is
  // reordered under the second click.
  await card(page, "review-changes")
    .getByRole("button", { name: "Use this: Review recent changes" })
    .dblclick();
  await expect(composer(page)).toHaveValue(/^Review the recent changes/);
  expect(await stored(page)).toMatchObject({
    templates: { recent: ["review-changes"] },
  });
  await expect(group(page, "Recently used")).toHaveCount(0);
  await home(page).getByRole("button", { name: "Undo" }).click();
  await expect(composer(page)).toHaveValue("");

  await card(page, "research-topic")
    .getByRole("button", { name: "Use this: Research a topic" })
    .click();
  // A favorite used from its row moves to the front of the recent record.
  await group(page, "Favorites")
    .getByRole("button", { name: "Use this: Fix a bug" })
    .click();
  await expect(composer(page)).toHaveValue(/^Help me fix a bug\./);
  expect(await stored(page)).toEqual({
    version: 1,
    theme: "terminal",
    language: "en",
    vimMode: false,
    templates: {
      favorites: ["fix-bug", "weekly-report"],
      recent: ["fix-bug", "research-topic", "review-changes"],
    },
  });
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  expect(raw).not.toContain("Help me");
  expect(raw).not.toContain("/workspace");
  expect(raw).not.toContain("tab-scoped");
  expect(starts).toEqual([]);

  // The next home shows the new order; a favorite is listed once, under
  // Favorites.
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  expect(await rows(page, "Favorites")).toEqual(["fix-bug", "weekly-report"]);
  expect(await rows(page, "Recently used")).toEqual([
    "research-topic",
    "review-changes",
  ]);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);

  // Unstarring from the Favorites row keeps focus on that template's star,
  // now in the recent list, where its last use puts it first.
  const favoriteRow = group(page, "Favorites").getByRole("button", {
    name: "Favorite: Fix a bug",
  });
  await favoriteRow.focus();
  await page.keyboard.press("Enter");
  expect(await rows(page, "Favorites")).toEqual(["weekly-report"]);
  expect(await rows(page, "Recently used")).toEqual([
    "fix-bug",
    "research-topic",
    "review-changes",
  ]);
  await expect(
    group(page, "Recently used").getByRole("button", {
      name: "Favorite: Fix a bug",
    }),
  ).toBeFocused();
  await group(page, "Favorites")
    .getByRole("button", { name: "Favorite: Write a weekly report" })
    .click();
  await expect(group(page, "Favorites")).toHaveCount(0);
  await expect(
    card(page, "weekly-report").getByRole("button", {
      name: "Favorite: Write a weekly report",
    }),
  ).toBeFocused();

  // Shortcut rows stack on a phone without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  const recent = group(page, "Recently used").locator(
    "[data-shortcut-template]",
  );
  // The phone layout may still be settling after the resize; measure both
  // rows in one frame until it has.
  await expect(recent).toHaveCount(3);
  await expect
    .poll(() =>
      recent.evaluateAll((rows) => {
        const [first, second] = rows.map((row) => row.getBoundingClientRect());
        return (
          !!first &&
          !!second &&
          second.x === first.x &&
          second.y > first.y + first.height &&
          first.right <= 390
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(starts).toEqual([]);
});

test("removed or unknown template IDs are ignored and the default home returns", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        theme: "slate",
        language: "en",
        vimMode: false,
        templates: {
          favorites: ["retired-template", "../../etc/passwd"],
          recent: ["t0428-not-a-template", "removed-report"],
        },
      }),
    );
  }, storageKey);
  await connect(page);
  await startSession(page, "/workspace/template-shortcuts-unknown");
  await expect(home(page).locator("li[data-template]")).toHaveCount(9);
  await expect(group(page, "Favorites")).toHaveCount(0);
  await expect(group(page, "Recently used")).toHaveCount(0);
  await expect(
    home(page)
      .getByRole("button", { name: /^Favorite: / })
      .first(),
  ).toHaveAttribute("aria-pressed", "false");
  // The display choices beside them still load.
  await expect(page.locator("html")).toHaveAttribute(
    "data-display-theme",
    "slate",
  );

  // The next change writes only catalog IDs.
  await card(page, "tidy-spreadsheet")
    .getByRole("button", { name: "Favorite: Clean up a spreadsheet" })
    .click();
  expect(await stored(page)).toEqual({
    version: 1,
    theme: "slate",
    language: "en",
    vimMode: false,
    templates: { favorites: ["tidy-spreadsheet"], recent: [] },
  });
});

test("a favorite chosen before a folder is recorded and still fills the new session", async ({
  page,
}) => {
  await connect(page);
  const gallery = page.getByRole("region", {
    name: "Or start from a template",
  });
  await gallery
    .getByRole("button", { name: "Favorite: Polish a draft" })
    .click();
  await gallery
    .getByRole("region", { name: "Favorites", exact: true })
    .getByRole("button", { name: "Use this: Polish a draft" })
    .click();
  await expect(gallery.getByRole("status")).toContainText(
    "“Polish a draft” is ready. Choose a folder to start.",
  );
  await page.reload();
  await expect(gallery.getByRole("status")).toContainText(
    "“Polish a draft” is ready.",
  );
  await startSession(page, "/workspace/template-shortcuts-pending");
  await expect(composer(page)).toHaveValue(/^Polish \[the text pasted here/);
  expect(await stored(page)).toMatchObject({
    templates: { favorites: ["polish-writing"], recent: ["polish-writing"] },
  });
});

test("a click on a template below the fold keeps the page still, so a double click stays on it", async ({
  page,
}) => {
  await connect(page);
  const gallery = page.getByRole("region", {
    name: "Or start from a template",
  });
  const slide = gallery.getByRole("button", {
    name: "Use this: Draft a slide outline",
  });
  await slide.scrollIntoViewIfNeeded();
  const before = (await slide.boundingBox())!.y;
  await slide.dblclick();
  await expect(gallery.getByRole("status")).toContainText(
    "“Draft a slide outline” is ready. Choose a folder to start.",
  );
  expect(Math.abs((await slide.boundingBox())!.y - before)).toBeLessThan(2);
  // Still connected: the second click did not land on the folder controls.
  await expect(page.getByLabel("Server workspace path")).toBeFocused();
  await expect(page.getByLabel("Server origin")).toHaveCount(0);
  expect(await stored(page)).toMatchObject({
    templates: { favorites: [], recent: ["slide-outline"] },
  });

  // From the keyboard, focus moves on to the folder field and shows it.
  await gallery
    .getByRole("button", { name: "Use this: Polish a draft" })
    .press("Enter");
  await expect(page.getByLabel("Server workspace path")).toBeFocused();
  await expect(page.getByLabel("Server workspace path")).toBeInViewport();
});
