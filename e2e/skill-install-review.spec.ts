import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, startSession } from "./fixture-session";
import { sendError, sendResult } from "./wire";

/**
 * T-0420/T-0555: a skill source is reviewed against what the server reports.
 * A Core without `profile.skills.reviewed_install.v1` keeps the review
 * read-only and the page must never send an install; a Core WITH it installs
 * exactly the reviewed commit+digest and nothing else. The registry is
 * answered here with the shapes Core returns, and every install frame is
 * counted.
 */
const SEARCH = "profile/skills/registry/search";
const INSTALL = "profile/skills/install";
const INSTALL_REVIEWED = "profile/skills/install_reviewed";
const LIST = "profile/skills/list";
const REVIEWED_FEATURE = "profile.skills.reviewed_install.v1";
const REVIEWED_COMMIT = "a".repeat(40);
const REVIEWED_DIGEST = "b".repeat(64);
const REVIEWED_AT = "2026-11-11T00:00:00Z";

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
  searches: number;
  /** Every install request the page sends, answered or not. */
  installs: Record<string, unknown>[];
  /** Typed refusal the next reviewed install answers with, or "hang". */
  installFails: string | null;
  /** Skills the server lists after the install, for the re-read. */
  listed: Record<string, unknown>[];
}

/** The reviewed sample pins its commit and this host's signed artifact. */
const REVIEWED = {
  ...SAMPLE,
  name: "reviewed",
  repo: "example/reviewed",
  skills: ["reviewed-one"],
  source_commit: REVIEWED_COMMIT,
  reviewed_at: REVIEWED_AT,
  binaries: {
    "linux-x86_64": {
      url: "https://hub.example/reviewed-linux.tar.gz",
      sha256: REVIEWED_DIGEST,
      signature: "sig-1",
    },
  },
};

async function fakeRegistry(page: Page, options: { reviewed?: boolean } = {}) {
  const methods = options.reviewed
    ? [SEARCH, INSTALL, INSTALL_REVIEWED, LIST]
    : [SEARCH, INSTALL, LIST];
  const fake: Fake = {
    packages: options.reviewed ? [REVIEWED, BARE] : [SAMPLE, BARE],
    searches: 0,
    installs: [],
    installFails: null,
    listed: [],
  };
  const advertise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(advertise);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "supported_methods" && Array.isArray(entry)
          ? [...new Set([...entry, ...methods])]
          : key === "supported_features" && Array.isArray(entry)
            ? [
                ...new Set([
                  ...entry,
                  ...(options.reviewed ? [REVIEWED_FEATURE] : []),
                ]),
              ]
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
        const reply = (result: unknown) => sendResult(route, id, result);
        const profile_id = params?.profile_id;
        if (method === LIST) {
          reply({
            profile_id,
            count: fake.listed.length,
            skills: fake.listed,
          });
        } else if (method === SEARCH) {
          fake.searches += 1;
          reply({
            profile_id,
            packages: fake.packages,
            ...(options.reviewed ? { server_platform: "linux-x86_64" } : {}),
          });
        } else if (method === INSTALL_REVIEWED) {
          fake.installs.push(params);
          if (fake.installFails === "hang") {
            // Never reply: the client's request timeout makes the outcome
            // genuinely unknown while the socket stays healthy.
          } else if (fake.installFails) {
            sendError(route, id, {
              code: -32602,
              message: `registry entry changed`,
              data: { kind: fake.installFails },
            });
          } else {
            fake.listed = [
              {
                name: "reviewed-one",
                version: "1.0.0",
                tool_count: 0,
                source_repo: "example/reviewed",
                source_commit: REVIEWED_COMMIT,
                reviewed_at: REVIEWED_AT,
                artifact_sha256: REVIEWED_DIGEST,
              },
            ];
            reply({
              profile_id,
              ok: true,
              installed: ["reviewed"],
              package: "reviewed",
              repo: "example/reviewed",
              source_commit: REVIEWED_COMMIT,
              reviewed_at: REVIEWED_AT,
              platform: "linux-x86_64",
              artifact_sha256: REVIEWED_DIGEST,
              artifact_bytes: 42,
            });
          }
        } else if (method === INSTALL) {
          // The legacy branch-following method must never be called.
          fake.installs.push({ legacy: true, ...params });
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

async function start(page: Page) {
  await startSession(page, `/workspace/skill-review-${Date.now()}`);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await composer.fill("/skills");
  await composer.press("Enter");
  return page.getByRole("dialog", { name: "Profile skills" });
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
  await expect(panel).toContainText("Installing isn't offered");
  await expect(panel).toContainText("immutable commit and checksum");
  await expect(panel.getByRole("link", { name: "#2321" })).toBeVisible();
  await expect(panel).toContainText("npm install, cargo build");
  await expect(panel).not.toContainText(/safe|verified|trusted/i);
  await expectNoInstallControl(dialog);

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  // Pointing the same source at another branch drops the stale review; the
  // new review is still read-only, even from the keyboard.
  const repo = dialog.getByLabel("Repository or server-side path");
  const branch = dialog.getByLabel("Branch (server default: main)");
  await expect(repo).toHaveValue("example/sample");
  await branch.fill("moved");
  await expect(panel).toHaveCount(0);
  await branch.press("Enter");
  await repo.press("Enter");
  await dialog.getByRole("button", { name: "Review source" }).click();
  await expect(fact(panel, "Branch")).toHaveText("moved");
  await expectNoInstallControl(dialog);
  await page.keyboard.press("Enter");
  await panel.getByRole("button", { name: "Close review" }).click();
  await expect(panel).toHaveCount(0);
  expect(fake.installs).toHaveLength(0);
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

test("installs exactly the reviewed object and re-reads the server", async ({
  page,
}) => {
  const fake = await fakeRegistry(page, { reviewed: true });
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review the source of reviewed" })
    .click();
  const panel = review(dialog);
  await expect(fact(panel, "Reviewed commit")).toHaveText(REVIEWED_COMMIT);
  await expect(fact(panel, "Signature or checksum")).toHaveText(
    REVIEWED_DIGEST,
  );
  await expect(panel).toContainText("install exactly this reviewed commit");

  await panel
    .getByRole("button", { name: "Install this reviewed object" })
    .click();
  const confirm = dialog.getByRole("region", {
    name: "Confirm skill change",
  });
  await expect(confirm).toContainText(REVIEWED_COMMIT);
  await expect(confirm).toContainText(REVIEWED_DIGEST);
  await confirm.getByRole("button", { name: "Confirm install" }).click();

  // The request carries the reviewed identity, never the legacy method.
  await expect.poll(() => fake.installs.length).toBe(1);
  expect(fake.installs).toEqual([
    {
      profile_id: "_main",
      package: "reviewed",
      repo: "example/reviewed",
      source_commit: REVIEWED_COMMIT,
      reviewed_at: REVIEWED_AT,
      platform: "linux-x86_64",
      artifact: { sha256: REVIEWED_DIGEST, signature: "sig-1" },
      force: false,
    },
  ]);
  await expect(dialog.getByRole("status").last()).toContainText(
    REVIEWED_COMMIT.slice(0, 12),
  );
  // The installed row shows what the server reports after the re-read.
  await expect(dialog.getByText(REVIEWED_COMMIT).first()).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("a changed registry refuses the install and nothing else happens", async ({
  page,
}) => {
  const fake = await fakeRegistry(page, { reviewed: true });
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review the source of reviewed" })
    .click();
  await review(dialog)
    .getByRole("button", { name: "Install this reviewed object" })
    .click();
  fake.installFails = "reviewed_install_registry_mismatch";
  await dialog
    .getByRole("region", { name: "Confirm skill change" })
    .getByRole("button", { name: "Confirm install" })
    .click();

  await expect(dialog.getByRole("alert")).toContainText(
    "registry changed since this review",
  );
  // The review is stale: it is closed, and the list was re-read unchanged.
  await expect(review(dialog)).toHaveCount(0);
  await expect(dialog.getByText("Makes samples")).toHaveCount(0);
  await expect(dialog.getByRole("status", { name: /installed/i })).toHaveCount(
    0,
  );
  await expect.poll(() => fake.installs.length).toBe(1);
  expect(fake.installs[0]).not.toHaveProperty("legacy");
});

test("an unconfirmed install is re-read from the server, never claimed", async ({
  page,
}) => {
  // The client waits 30s before calling an unanswered request unknown.
  test.setTimeout(120_000);
  const fake = await fakeRegistry(page, { reviewed: true });
  const dialog = await start(page);
  await searchRegistry(dialog, fake);
  await dialog
    .getByRole("button", { name: "Review the source of reviewed" })
    .click();
  await review(dialog)
    .getByRole("button", { name: "Install this reviewed object" })
    .click();
  // The socket drops before any receipt: the outcome is genuinely unknown.
  fake.installFails = "hang";
  await dialog
    .getByRole("region", { name: "Confirm skill change" })
    .getByRole("button", { name: "Confirm install" })
    .click();

  // The alert lands only after the client's 30s request timeout.
  await expect(dialog.getByRole("alert")).toContainText(
    "did not confirm this install",
    { timeout: 45_000 },
  );
  await expect(dialog.getByRole("alert")).not.toContainText(/installed/i);
  await expect.poll(() => fake.installs.length).toBe(1);
});
