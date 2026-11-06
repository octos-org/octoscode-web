import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const origin = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const home = (page: Page) =>
  page.getByRole("region", { name: "What can Octos help with?" });
const cards = (page: Page) =>
  home(page)
    .locator("li[data-template]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-template")),
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

function methodsSent(page: Page): string[] {
  const methods: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      const method = JSON.parse(String(payload)).method;
      if (method) methods.push(method);
    }),
  );
  return methods;
}

test("search and a scene combine, say how many match, and clear back to every template", async ({
  page,
}) => {
  const methods = methodsSent(page);
  await connect(page);
  await startSession(page, "/workspace/template-browse");
  const search = home(page).getByRole("searchbox", {
    name: "Search templates",
  });
  const scene = (name: string) =>
    home(page).getByRole("radio", { name, exact: true });
  await expect(scene("All")).toBeChecked();
  expect(await cards(page)).toHaveLength(9);
  await expect(
    home(page).getByRole("heading", { name: "Office" }),
  ).toBeVisible();

  // A draft in the message box survives browsing.
  await composer(page).fill("my unsent draft");
  const opens = methods.filter((m) => m === "session/open").length;

  await search.fill("spreadsheet");
  expect(await cards(page)).toEqual(["tidy-spreadsheet"]);
  await expect(home(page).getByText("Showing 1 of 9 templates.")).toBeVisible();

  await scene("Code").check();
  expect(await cards(page)).toEqual([]);
  const empty = home(page).getByText("No Code template matches “spreadsheet”.");
  await expect(empty).toBeVisible();
  await home(page).getByRole("button", { name: "Show all templates" }).click();
  await expect(scene("All")).toBeChecked();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  expect(await cards(page)).toHaveLength(9);
  await expect(home(page).getByText(/^Showing/)).toHaveCount(0);

  // Chinese words find the same template in the English page.
  await search.fill("周报");
  expect(await cards(page)).toEqual(["weekly-report"]);
  await search.fill("");

  // Scenes are radios: arrow keys move between them.
  await scene("All").focus();
  await page.keyboard.press("ArrowRight");
  await expect(scene("Code")).toBeChecked();
  expect(await cards(page)).toEqual([
    "explain-repository",
    "fix-bug",
    "review-changes",
    "repository-health",
  ]);
  await page.keyboard.press("ArrowRight");
  await expect(scene("Office")).toBeChecked();
  expect(await cards(page)).toEqual([
    "weekly-report",
    "tidy-spreadsheet",
    "polish-writing",
    "slide-outline",
  ]);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);

  await expect(composer(page)).toHaveValue("my unsent draft");
  expect(methods.filter((m) => m === "session/open")).toHaveLength(opens);
  expect(methods).not.toContain("turn/start");
});

test("a filtered pick fills the box as before; favorites stay put and a reload starts from every template", async ({
  page,
}) => {
  await connect(page);
  await startSession(page, "/workspace/template-browse-pick");
  const search = home(page).getByRole("searchbox", {
    name: "Search templates",
  });
  await home(page).getByRole("radio", { name: "Office", exact: true }).check();
  await search.fill("slide");
  await home(page)
    .locator('li[data-template="slide-outline"]')
    .getByRole("button", { name: "Favorite: Draft a slide outline" })
    .click();
  const favorites = home(page).getByRole("region", {
    name: "Favorites",
    exact: true,
  });
  await expect(favorites.locator("[data-shortcut-template]")).toHaveCount(1);
  // Favorites are not filtered: another search keeps them.
  await search.fill("bug");
  await expect(
    home(page).getByText("No Office template matches “bug”."),
  ).toBeVisible();
  await expect(favorites.locator("[data-shortcut-template]")).toHaveCount(1);

  await search.fill("slide");
  await home(page)
    .getByRole("button", { name: "Use this: Draft a slide outline" })
    .last()
    .click();
  await expect(composer(page)).toHaveValue(/^Draft a slide outline on \[topic/);

  await page.reload();
  await expect(composer(page)).toBeEnabled();
  await expect(
    home(page).getByRole("radio", { name: "All", exact: true }),
  ).toBeChecked();
  await expect(
    home(page).getByRole("searchbox", { name: "Search templates" }),
  ).toHaveValue("");
  await expect(favorites.locator("[data-shortcut-template]")).toHaveCount(1);
});

test("browsing before a folder opens nothing, and the bar wraps on a phone", async ({
  page,
}) => {
  const methods = methodsSent(page);
  await connect(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const gallery = page.getByRole("region", {
    name: "Or start from a template",
  });
  await gallery
    .getByRole("searchbox", { name: "Search templates" })
    .fill("draft");
  await gallery.getByRole("radio", { name: "Office", exact: true }).check();
  await expect(gallery.locator("li[data-template]")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  const box = await gallery
    .getByRole("radiogroup", { name: "Scene" })
    .boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(methods).not.toContain("session/open");
  expect(methods).not.toContain("turn/start");
});
