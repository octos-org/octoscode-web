import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * T-0420: an install goes out only after a review of what the server reports,
 * and only for what was reviewed. The registry and installs are answered here,
 * with the shapes Core 6fc12da3 returns, so nothing real is ever installed.
 */
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const SEARCH = "profile/skills/registry/search";
const INSTALL = "profile/skills/install";
const LIST = "profile/skills/list";
const REMOVE = "profile/skills/remove";

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
  installFails: string | null;
  installedVersion: string | null;
  installs: Record<string, unknown>[];
  searches: number;
  /** Runs when a search arrives, before it is answered. */
  onSearch: (() => void) | null;
}

async function fakeRegistry(page: Page, methods = [SEARCH, INSTALL, LIST]) {
  const fake: Fake = {
    packages: [SAMPLE, BARE],
    searchFails: null,
    installFails: null,
    installedVersion: "1.0.0",
    installs: [],
    searches: 0,
    onSearch: null,
  };
  const installed: { name: string; version: string | null }[] = [];
  const advertise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(advertise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? [...new Set([...entry, ...methods])].filter(
              (method) => method !== REMOVE || methods.includes(REMOVE),
            )
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
        const request = JSON.parse(String(message));
        const { id, method, params } = request;
        const reply = (result: unknown) =>
          route.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
        const refuse = (text: string) =>
          route.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: text },
            }),
          );
        const profile_id = params?.profile_id;
        if (method === LIST) {
          reply({
            profile_id,
            count: installed.length,
            skills: installed.map((skill) => ({
              ...skill,
              tool_count: 0,
              source_repo: null,
            })),
          });
        } else if (method === SEARCH) {
          fake.searches += 1;
          fake.onSearch?.();
          if (fake.searchFails) refuse(fake.searchFails);
          else reply({ profile_id, packages: fake.packages });
        } else if (method === INSTALL) {
          fake.installs.push(params);
          if (fake.installFails) refuse(fake.installFails);
          else {
            installed.push({ name: "sample", version: fake.installedVersion });
            reply({
              profile_id,
              ok: true,
              installed: ["sample"],
              skipped: ["kept"],
              deps_installed: ["shared"],
            });
          }
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
  dialog.getByRole("region", { name: "Review before installing" });
const fact = (panel: Locator, label: string) =>
  panel
    .locator("dl > div")
    .filter({ has: panel.page().getByText(label, { exact: true }) })
    .locator("dd");

test("reviews what the server reports, and installs only on confirmation", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);

  await dialog
    .getByRole("button", { name: "Review installation of sample" })
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
  await expect(panel).toContainText("npm install, cargo build");
  await expect(panel).toContainText("can't pin the version above");
  await expect(panel).not.toContainText(/safe|verified|trusted/i);
  expect(fake.installs).toHaveLength(0);

  // Cancelling sends nothing.
  await panel.getByRole("button", { name: "Cancel skill change" }).click();
  await expect(panel).toHaveCount(0);
  expect(fake.installs).toHaveLength(0);

  await dialog
    .getByRole("button", { name: "Review installation of sample" })
    .click();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await panel.getByRole("button", { name: "Confirm install" }).click();

  await expect.poll(() => fake.installs.length).toBe(1);
  expect(fake.installs[0]).toEqual({
    profile_id: expect.any(String),
    repo: "example/sample",
    force: false,
  });
  const status = dialog.getByRole("status").filter({ hasText: "Installed on" });
  await expect(status).toContainText("Installed on the server: sample 1.0.0");
  await expect(status).toContainText("Already there, not overwritten: kept");
  await expect(status).toContainText("Dependencies also installed: shared");
  await expect(status).not.toContainText("stated version");
  await expect(
    dialog.getByRole("article").filter({ hasText: "sample" }).first(),
  ).toBeVisible();
});

test("a package with missing facts says unknown, not none", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await expect(dialog.getByText(/Instruction skills/)).toHaveCount(0);

  await dialog
    .getByRole("button", { name: "Review installation of bare" })
    .click();
  const panel = review(dialog);
  for (const label of ["Version", "Author", "License", "Required tools"])
    await expect(fact(panel, label)).toHaveText("Unknown");
  await expect(fact(panel, "Executable tools")).toContainText(
    "doesn't mean it has none",
  );
});

test("a change after the review stops the install until it is reviewed again", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review installation of sample" })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Version")).toHaveText("1.0.0");

  fake.packages = [
    { ...SAMPLE, version: "6.6.6", requires: ["git", "node", "curl"] },
  ];
  await panel.getByRole("button", { name: "Confirm install" }).click();

  const alert = panel.getByRole("alert");
  await expect(alert).toContainText("nothing was installed");
  await expect(alert).toContainText("Version: 1.0.0 → 6.6.6");
  await expect(alert).toContainText(
    "Required tools: git, node → git, node, curl",
  );
  await expect(fact(panel, "Version")).toHaveText("6.6.6");
  expect(fake.installs).toHaveLength(0);

  // Now it covers what was just shown, and goes through.
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect.poll(() => fake.installs.length).toBe(1);
});

test("an entry that left the registry stops the install too", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review installation of sample" })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Version")).toHaveText("1.0.0");
  fake.packages = [BARE];
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Registry entry: Listed → Not listed",
  );
  await expect(fact(panel, "Version")).toHaveText("Unknown");
  expect(fake.installs).toHaveLength(0);
});

test("a registry that can't be read blocks the install, at review and at confirmation", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await searchRegistry(dialog, fake);

  fake.searchFails = "failed to search skill registry: timed out";
  await dialog
    .getByRole("button", { name: "Review installation of sample" })
    .click();
  const panel = review(dialog);
  await expect(panel.getByRole("alert")).toContainText("timed out");
  await expect(
    panel.getByRole("button", { name: "Confirm install" }),
  ).toHaveCount(0);
  expect(fake.installs).toHaveLength(0);

  fake.searchFails = null;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(fact(panel, "Version")).toHaveText("1.0.0");

  fake.searchFails = "failed to search skill registry: gone again";
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect(panel.getByRole("alert")).toContainText("gone again");
  await expect(
    panel.getByRole("button", { name: "Confirm install" }),
  ).toHaveCount(0);
  expect(fake.installs).toHaveLength(0);
});

test("a typed source goes out exactly as reviewed, and the server's refusal is shown", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  const repo = dialog.getByLabel("Repository or server-side path");
  const branch = dialog.getByLabel("Branch (server default: main)");
  await repo.fill("someone/else");
  await branch.fill("dev");
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  const panel = review(dialog);
  await expect(panel).toContainText("no single entry for this source");
  await expect(fact(panel, "Package")).toHaveText("Unknown");
  await expect(fact(panel, "Branch")).toHaveText("dev");

  // Editing the source drops the review: it was about something else.
  await repo.fill("someone/other");
  await expect(panel).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  await expect(fact(panel, "Source")).toHaveText("someone/other");

  fake.installFails =
    "failed to install skill: npm install failed in /srv/skills/other";
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect.poll(() => fake.installs.length).toBe(1);
  expect(fake.installs[0]).toMatchObject({
    repo: "someone/other",
    branch: "dev",
    force: false,
  });
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText(
    "The installation didn't finish: failed to install skill: npm install failed in /srv/skills/other",
  );
  await expect(alert).toContainText("Part of it may still be on the server");
  await expect(dialog).not.toContainText("Installed on the server");
});

test("a path on the server is reviewed without the registry", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  fake.searchFails = "the registry is unreachable from this server";
  const dialog = await start(page);
  await dialog
    .getByLabel("Repository or server-side path")
    .fill("/srv/skills/mine");
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  const panel = review(dialog);
  await expect(panel).toContainText("This is a path on the server");
  await expect(fact(panel, "Version")).toHaveText("Unknown");
  await expect(panel.getByText("Branch", { exact: true })).toHaveCount(0);
  expect(fake.searches).toBe(0);
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect.poll(() => fake.installs.length).toBe(1);
  expect(fake.searches).toBe(0);
});

test("a server without a registry still shows unknowns", async ({ page }) => {
  const fake = await fakeRegistry(page, [INSTALL, LIST]);
  const dialog = await start(page);
  await dialog
    .getByLabel("Repository or server-side path")
    .fill("someone/else");
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  const panel = review(dialog);
  await expect(panel).toContainText("doesn't offer a skill registry");
  expect(fake.searches).toBe(0);
});

test("says so when the server reports another version than the one reviewed", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  fake.installedVersion = "2.0.0";
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review installation of sample" })
    .click();
  await review(dialog).getByRole("button", { name: "Confirm install" }).click();
  const status = dialog.getByRole("status").filter({ hasText: "Installed on" });
  await expect(status).toContainText("sample 2.0.0");
  await expect(status).toContainText("stated version 1.0.0");
});

test("keeps sources and tokens out of browser storage", async ({ page }) => {
  const fake = await fakeRegistry(page);
  const dialog = await start(page);
  await dialog
    .getByLabel("Repository or server-side path")
    .fill("https://me:s3cret-source-token@example.com/a.git");
  await dialog
    .getByRole("button", { name: "Review installation", exact: true })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Source")).toHaveText(
    "https://[redacted]@example.com/a.git",
  );
  await panel.getByRole("button", { name: "Confirm install" }).click();
  await expect.poll(() => fake.installs.length).toBe(1);
  // What is shown is masked; what goes to the server is what was typed.
  expect(fake.installs[0]!.repo).toBe(
    "https://me:s3cret-source-token@example.com/a.git",
  );
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toContain("s3cret-source-token");
  expect(stored).not.toContain("Makes samples");
  expect(stored).not.toContain("example.com/a.git");
});

test("settings lead to the review, in Chinese and at phone width", async ({
  page,
}) => {
  const fake = await fakeRegistry(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await start(page, "zh");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭技能" }).click();

  await page.getByRole("button", { name: "打开会话列表" }).click();
  await page
    .getByRole("complementary", { name: /Product navigation|产品导航/ })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "技能", exact: true }).click();
  await settings.getByRole("button", { name: "审查并安装技能" }).click();
  await expect(settings).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("仓库或服务器端路径").fill("someone/else");
  await dialog.getByRole("button", { name: "检查安装", exact: true }).click();
  const panel = dialog.getByRole("region", { name: "安装前审查" });
  await expect(panel).toContainText("服务器可能直接运行这个来源里的代码");
  await expect(panel).toContainText("服务器未报告");
  await expect(panel.getByRole("button", { name: "确认安装" })).toBeVisible();
  const overflow = await dialog.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(fake.installs).toHaveLength(0);
});
