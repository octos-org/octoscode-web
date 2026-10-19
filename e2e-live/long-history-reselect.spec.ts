import { expect, test, type Locator, type Page } from "@playwright/test";

// Long-history / multi-session acceptance probe for the 0.20 ledger: three
// completed sessions with distinct markers on real Core, cycled through
// repeated reselections, then a reload — no reordering, no cross-session
// mixing, everything still present. One-off acceptance tool for
// docs/release-readiness-020.md; keep the landmarks boring on purpose.
const endpoint = `http://127.0.0.1:${process.env.OCTOSCODE_LIVE_WEB_PORT ?? "4174"}`;
const token = required("OCTOSCODE_LIVE_TOKEN");
const cwd = required("OCTOSCODE_LIVE_WORKSPACE");
const SESSIONS = 3;
const CYCLES = 18;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the probe`);
  return value;
}

function productNavigation(page: Page): Locator {
  return page.getByRole("complementary", { name: "Product navigation" });
}

function timeline(page: Page): Locator {
  return page.getByRole("log", { name: "Conversation timeline" });
}

async function sessionOrder(
  navigation: Locator,
  tags: string[],
): Promise<number[]> {
  const texts = await navigation
    .locator('button[role="treeitem"]')
    .allTextContents();
  return tags.map((tag) => texts.findIndex((text) => text.includes(tag)));
}

async function waitTurnSettled(page: Page, marker: string): Promise<void> {
  await expect(
    page.locator(".entry-assistant").filter({ hasText: marker }).last(),
  ).toBeVisible({ timeout: 4 * 60_000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0, { timeout: 60_000 });
}

test("three sessions survive repeated reselection and reload", async ({
  page,
}) => {
  test.setTimeout(12 * 60_000);
  await page.goto("/");
  await page.getByLabel("Server origin").fill(endpoint);
  await page.getByLabel("Auth token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const navigation = productNavigation(page);
  await expect(navigation).toBeVisible({ timeout: 30_000 });
  const addWorkspace = page.getByRole("region", { name: "Add workspace" });
  await expect(addWorkspace).toBeVisible();
  await addWorkspace.getByLabel("Server workspace path").fill(cwd);
  await addWorkspace.getByRole("button", { name: "Start session" }).click();

  const workspaceLabel = cwd.split("/").filter(Boolean).at(-1) ?? cwd;
  // Unique prompt prefixes become unique session titles; select treeitems by
  // tag, never by the whole treeitem text (state/timestamp words churn).
  const tags = ["Probe A7", "Probe B3", "Probe C9"];
  const markers: string[] = [];

  for (let index = 0; index < SESSIONS; index += 1) {
    if (index > 0) {
      const workspace = navigation.getByRole("treeitem", {
        name: workspaceLabel,
        exact: true,
      });
      await workspace
        .getByRole("button", { name: workspaceLabel, exact: true })
        .hover();
      await navigation
        .getByRole("button", { name: `New session in ${workspaceLabel}` })
        .click();
    }

    const marker = `LONGHIST_PROBE_S${index + 1}`;
    markers.push(marker);
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill(
      `${tags[index]}. Acceptance probe. Reply with the exact marker ${marker} and nothing else. Use no tools.`,
    );
    await page.getByRole("button", { name: "Send prompt" }).click();
    await waitTurnSettled(page, marker);

    await expect(
      navigation.locator('button[role="treeitem"]', { hasText: tags[index] }),
    ).toHaveCount(1);
  }

  const orderAtStart = await sessionOrder(navigation, tags);
  // Sidebar sorts newest-first; what matters is that the order is a valid
  // permutation and never changes across reselections and reloads.
  expect([...orderAtStart].sort((a, b) => a - b)).toEqual([0, 1, 2]);

  // Cycle selections; each session must show only its own marker.
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    const index = cycle % SESSIONS;
    const target = navigation
      .locator('button[role="treeitem"]', { hasText: tags[index] })
      .first();
    await target.click();
    await expect(target).toHaveAttribute("aria-current", "page");
    await expect(timeline(page).getByText(markers[index]).last()).toBeVisible({
      timeout: 30_000,
    });
    for (const other of markers) {
      if (other === markers[index]) continue;
      await expect(timeline(page).getByText(other)).toHaveCount(0);
    }
  }

  // Reload: every session still holds its own marker.
  for (let index = 0; index < SESSIONS; index += 1) {
    const target = navigation
      .locator('button[role="treeitem"]', { hasText: tags[index] })
      .first();
    await target.click();
    // Selection must be applied before reloading, or the app restores a
    // different session and the marker check would read the wrong timeline.
    await expect(target).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(
      productNavigation(page).locator('button[role="treeitem"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    // The reload must restore the session that was selected, not the most
    // recently updated one.
    await expect(
      navigation
        .locator('button[role="treeitem"]', { hasText: tags[index] })
        .first(),
    ).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    await expect(timeline(page).getByText(markers[index]).last()).toBeVisible({
      timeout: 30_000,
    });
    for (const other of markers) {
      if (other === markers[index]) continue;
      await expect(timeline(page).getByText(other)).toHaveCount(0);
    }
  }

  expect(await sessionOrder(navigation, tags)).toEqual(orderAtStart);

  const settingsButton = productNavigation(page).getByRole("button", {
    name: "Settings",
  });
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "General" }).click();
  await settings.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
});
