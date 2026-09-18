import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * WEB-WORKSPACE-BROWSER-CONTRACT-5000 — browsing the SERVER's folders from the
 * Add workspace form. The fixture advertises the feature only to the browsing
 * token, so the same file covers the feature-absent path with another token.
 */

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const BROWSE_TOKEN = "workspace-browse-e2e-token";
const PLAIN_TOKEN = "tab-scoped-e2e-token";
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

async function connect(page: Page, token: string): Promise<Locator> {
  await page.goto("/");
  await expect(page.locator("#connection-title")).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const form = page.getByRole("region", { name: "Add workspace" });
  await expect(form).toBeVisible();
  return form;
}

function browser(page: Page): Locator {
  return page.getByRole("region", { name: "Browse server folders" });
}

function currentFolder(page: Page): Locator {
  return page.locator('[data-browse-path="true"]');
}

async function openBrowser(page: Page, form: Locator): Promise<Locator> {
  await form.getByRole("button", { name: "Browse server folders" }).click();
  const surface = browser(page);
  await expect(surface).toBeVisible();
  return surface;
}

test("browses the server's folders, drills in and out, and reports what the server hid", async ({
  page,
}) => {
  const form = await connect(page, BROWSE_TOKEN);
  await openBrowser(page, form);

  // An empty path box opens on the server's OWN working directory.
  await expect(currentFolder(page)).toHaveText("/srv/fixture");
  // `hidden_skipped` is reported honestly rather than silently swallowed.
  await expect(page.locator('[data-browse-notice="true"]')).toContainText(
    "2 hidden folders aren't shown.",
  );

  // Drill in.
  await page.getByRole("button", { name: "Open folder Projects" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/Projects");
  await expect(
    page.getByRole("button", { name: "Open folder octoscode-web" }),
  ).toBeVisible();

  // …and back out through the parent affordance.
  await page.getByRole("button", { name: "Go to the parent folder" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture");

  // The way up is disabled at a root, never a dead control that does nothing.
  await page.getByRole("button", { name: "Open folder archive" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/archive");
  await expect(page.locator('[data-browse-notice="true"]')).toContainText(
    "Only the first 1 folders are shown.",
  );
  for (const _step of [0, 1, 2]) {
    await page.getByRole("button", { name: "Go to the parent folder" }).click();
  }
  await expect(currentFolder(page)).toHaveText("/");
  await expect(
    page.getByRole("button", { name: "Go to the parent folder" }),
  ).toBeDisabled();

  const results = await new AxeBuilder({ page })
    .include('[data-workspace-browser="true"]')
    .analyze();
  expect(results.violations).toEqual([]);
});

test("renders bounded copy with a next step when the server refuses a folder", async ({
  page,
}) => {
  const form = await connect(page, BROWSE_TOKEN);
  await openBrowser(page, form);
  await page.getByRole("button", { name: "Open folder restricted" }).click();
  const refusal = page.locator('[data-browse-error="true"]');
  await expect(refusal).toContainText("Octos can't open that folder.");
  await expect(refusal).toContainText(
    "Pick a folder the Octos server is allowed to read.",
  );
  // The server's own prose never reaches the page.
  await expect(refusal).not.toContainText("workspace_list");
  // The folder the operator is standing in survives the refusal.
  await expect(currentFolder(page)).toHaveText("/srv/fixture");
});

test("creates a folder, moves into it, and starts a session there", async ({
  page,
}) => {
  const form = await connect(page, BROWSE_TOKEN);
  await openBrowser(page, form);
  await page.getByRole("button", { name: "Open folder Projects" }).click();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/Projects");

  // A name the server would reject is caught before any request is spent.
  await page.getByRole("button", { name: "New folder" }).click();
  const nameBox = page.getByLabel("New folder name");
  await nameBox.fill("bad/name");
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(
    page.getByText("A folder name can't contain a slash. Enter one name only."),
  ).toBeVisible();
  await expect(currentFolder(page)).toHaveText("/srv/fixture/Projects");

  const created = `e2e-app-${Date.now()}`;
  await nameBox.fill(created);
  await page.getByRole("button", { name: "Create folder" }).click();
  // §Client behaviour: creating a folder MOVES INTO it.
  await expect(currentFolder(page)).toHaveText(
    `/srv/fixture/Projects/${created}`,
  );
  await expect(page.locator('[data-browse-empty="true"]')).toBeVisible();

  // Choosing a folder fills the path box…
  await page.getByRole("button", { name: "Use this folder" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace.getByLabel("Server workspace path")).toHaveValue(
    `/srv/fixture/Projects/${created}`,
  );

  // …and the existing flow starts the session with it, unchanged.
  await addWorkspace.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeEnabled();
  await expect(
    page.getByText(`/srv/fixture/Projects/${created}`, { exact: true }).first(),
  ).toBeVisible();
});

test("picking a subfolder fills the path box without leaving the browser's parent", async ({
  page,
}) => {
  const form = await connect(page, BROWSE_TOKEN);
  await openBrowser(page, form);
  await page.getByRole("button", { name: "Use folder Projects" }).click();
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace.getByLabel("Server workspace path")).toHaveValue(
    "/srv/fixture/Projects",
  );

  // Re-opening browses from the TYPED path, not the working directory again.
  await openBrowser(page, addWorkspace);
  await expect(currentFolder(page)).toHaveText("/srv/fixture/Projects");
});

test("shows no Browse affordance at all when the server does not advertise the feature", async ({
  page,
}) => {
  const form = await connect(page, PLAIN_TOKEN);
  await expect(form.getByLabel("Server workspace path")).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Browse server folders" }),
  ).toHaveCount(0);
  await expect(page.locator("[data-workspace-browse]")).toHaveCount(0);
  await expect(form.getByText("Browse", { exact: false })).toHaveCount(0);
  await expect(browser(page)).toHaveCount(0);

  // The typed-path form still works exactly as it did before the feature.
  await form.getByLabel("Server workspace path").fill("/workspace/no-browse");
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeEnabled();
});
