import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * T-0420: a skill source is reviewed against what the server reports, read
 * only. `profile/skills/install` takes a repo and a branch, nothing immutable,
 * so no confirmation here could hold the install to what was reviewed: the
 * page must never send one. The registry is answered here with the shapes
 * Core 6fc12da3 returns, and every install request is counted.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SEARCH = "profile/skills/registry/search";
const INSTALL = "profile/skills/install";
const LIST = "profile/skills/list";

const SAMPLE = {
  name: "sample",
  description: "Makes samples",
  repo: "example/sample",
  version: "1.0.0",
  author: "Example Author",
  license: "MIT",
  skills: ["sample-one", "sample-two"],
  requires: ["git", "node"],
  provides_tools: true,
  tags: ["demo"],
  installed: false,
  installed_skills: [] as string[],
};
// What the one real registry row looks like: every optional fact missing.
const BARE = {
  name: "bare",
  description: "Says little",
  repo: "example/bare",
  version: null,
  author: null,
  license: null,
  skills: [] as string[],
  requires: [] as string[],
  provides_tools: false,
  tags: [] as string[],
  installed: false,
  installed_skills: [] as string[],
};

interface Fake {
  packages: Record<string, unknown>[];
  searchFails: string | null;
  searches: number;
  /** Every install request the page sends, answered or not. */
  installs: Record<string, unknown>[];
}

async function fakeRegistry(page: Page, methods = [SEARCH, INSTALL, LIST]) {
  const fake: Fake = {
    packages: [SAMPLE, BARE],
    searchFails: null,
    searches: 0,
    installs: [],
  };
  const advertise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(advertise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? [...new Set([...entry, ...methods])]
          : advertise(entry),
      ]),
    );
  };
  await page.routeWebSocket(
    (url) => url.origin === FIXTURE_ORIGIN.replace("http:", "ws:"),
    (route) => {
      const server = route.connectToServer();
      server.onMessage((message) =>
        route.send(JSON.stringify(advertise(JSON.parse(String(message))))),
      );
      route.onMessage((message) => {
        const { id, method, params } = JSON.parse(String(message));
        const reply = (result: unknown) =>
          route.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
        const profile_id = params?.profile_id;
        if (method === LIST) {
          reply({ profile_id, count: 0, skills: [] });
        } else if (method === SEARCH) {
          fake.searches += 1;
          if (fake.searchFails)
            route.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32603, message: fake.searchFails },
              }),
            );
          else reply({ profile_id, packages: fake.packages });
        } else if (method === INSTALL) {
          fake.installs.push(params);
          reply({
            profile_id,
            ok: true,
            installed: ["sample"],
            skipped: [],
            deps_installed: [],
          });
        } else server.send(message);
      });
    },
  );
  return fake;
}

async function start(page: Page, display?: "zh") {
  if (display === "zh")
    await page.addInitScript(() =>
      localStorage.setItem(
        "octoscode.web.display.v1",
        JSON.stringify({
          version: 1,
          theme: "terminal",
          language: "zh",
          vimMode: false,
        }),
      ),
    );
  await page.goto("/");
  await page.locator("#connection-origin").fill(FIXTURE_ORIGIN);
  const token = page.getByLabel(/^(Auth token|访问令牌)$/);
  await token.fill("tab-scoped-e2e-token");
  await token.press("Enter");
  const path = page.getByLabel(/^(Server workspace path|服务器工作区路径)$/);
  await path.fill(`/workspace/skill-review-${Date.now()}`);
  await path.press("Enter");
  const composer = page.getByRole("textbox", {
    name: /^(Message Octos|给 Octos 发消息)$/,
  });
  await expect(composer).toBeEnabled();
  await composer.fill("/skills");
  await composer.press("Enter");
  return page.getByRole("dialog", { name: /^(Profile skills|配置档案技能)$/ });
}

async function searchRegistry(dialog: Locator, fake: Fake) {
  await dialog.getByRole("button", { name: "Search registry" }).click();
  await expect(dialog.getByText("Makes samples")).toBeVisible();
  fake.searches = 0;
}

const review = (dialog: Locator) =>
  dialog.getByRole("region", { name: "Source review" });
const fact = (panel: Locator, label: string) =>
  panel
    .locator("dl > div")
    .filter({ has: panel.page().getByText(label, { exact: true }) })
    .locator("dd");
/** Nothing in the dialog may offer to install, in either language. */
async function expectNoInstallControl(dialog: Locator) {
  await expect(
    dialog.getByRole("button", { name: /install|安装/i }),
  ).toHaveCount(0);
}

test("reviews what the server reports, read only", async ({ page }) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);

  await dialog
    .getByRole("button", { name: "Review the source of sample" })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Source")).toHaveText("example/sample");
  await expect(fact(panel, "Branch")).toHaveText("main (server default)");
  await expect(fact(panel, "Package")).toHaveText("sample");
  await expect(fact(panel, "Version")).toHaveText("1.0.0");
  await expect(fact(panel, "Author")).toHaveText("Example Author");
  await expect(fact(panel, "License")).toHaveText("MIT");
  await expect(fact(panel, "Skills included")).toHaveText(
    "sample-one, sample-two",
  );
  await expect(fact(panel, "Required tools")).toHaveText("git, node");
  await expect(fact(panel, "Executable tools")).toHaveText(
    "The registry says it provides them",
  );
  await expect(fact(panel, "Signature or checksum")).toHaveText(
    "Not reported by the server",
  );
  await expect(panel).toContainText("Installing isn't offered here");
  await expect(panel).toContainText("immutable commit or version");
  await expect(panel.getByRole("link", { name: "#2321" })).toBeVisible();
  await expect(panel).toContainText("npm install, cargo build");
  await expect(panel).not.toContainText(/safe|verified|trusted/i);
  await expectNoInstallControl(dialog);

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await panel.getByRole("button", { name: "Close review" }).click();
  await expect(panel).toHaveCount(0);
  expect(fake.installs).toHaveLength(0);
});

test("a source that moves after its review never gets an install sent", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review the source of sample" })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Version")).toHaveText("1.0.0");

  // The branch behind the reviewed package moves on, and the registry with it.
  fake.packages = [
    { ...SAMPLE, version: "6.6.6", requires: ["git", "node", "curl"] },
  ];
  await expectNoInstallControl(dialog);
  // What the review showed stays what was read; nothing acts on it.
  await expect(fact(panel, "Version")).toHaveText("1.0.0");
  for (const button of await panel.getByRole("button").all())
    if ((await button.textContent()) !== "Close review") await button.click();

  // Pointing the same source at another branch drops the review.
  const repo = dialog.getByLabel("Repository or server-side path");
  const branch = dialog.getByLabel("Branch (server default: main)");
  await expect(repo).toHaveValue("example/sample");
  await branch.fill("moved");
  await expect(panel).toHaveCount(0);
  await branch.press("Enter");
  await repo.press("Enter");
  await dialog.getByRole("button", { name: "Review source" }).click();
  await expect(fact(panel, "Branch")).toHaveText("moved");
  await expect(fact(panel, "Version")).toHaveText("6.6.6");
  await expectNoInstallControl(dialog);
  await page.keyboard.press("Enter");
  expect(fake.installs).toEqual([]);
});

test("keeps sources and tokens out of browser storage", async ({ page }) => {
  await fakeRegistry(page);
  const dialog = await start(page);
  await dialog
    .getByLabel("Repository or server-side path")
    .fill("https://me:s3cret-source-token@example.com/a.git");
  await dialog.getByRole("button", { name: "Review source" }).click();
  await expect(fact(review(dialog), "Source")).toHaveText(
    "https://[redacted]@example.com/a.git",
  );
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain("s3cret-source-token");
  expect(stored).not.toContain("example.com/a.git");
});
