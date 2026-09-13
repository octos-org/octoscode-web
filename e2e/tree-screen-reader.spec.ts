import { expect, test, type Page } from "@playwright/test";
import { virtual } from "@guidepup/virtual-screen-reader";

const FIXTURE_ORIGIN = `http://127.0.0.1:${
  process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"
}`;
const COMPOSER_PLACEHOLDER = "Ask Octos to change, explain, or review code…";

test.use({ channel: "chromium" });

async function connectAndStart(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const chooser = page.getByRole("region", { name: "Choose a workspace" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Add workspace" }).click();
  const add = page.getByRole("region", { name: "Add workspace" });
  await expect(add).toBeVisible();
  await add
    .getByLabel("Server workspace path")
    .fill("/workspace/octoscode-web");
  await add.getByRole("button", { name: "Add & Start" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
}

test("sidebar tree announces workspace and session rows with usable names", async ({
  page,
}) => {
  await connectAndStart(page);

  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible();

  // Walk the tree with the Virtual Screen Reader, collecting what a screen
  // reader user hears per stop.
  const container = await page.evaluateHandle(() =>
    document.querySelector('[role="tree"]'),
  );
  await virtual.start({ container });
  const phrases: string[] = [];
  while (true) {
    await virtual.next();
    const phrase = await virtual.lastSpokenPhrase();
    if (!phrase || phrase.includes("end of")) break;
    phrases.push(phrase);
  }
  await virtual.stop();

  const joined = phrases.join("\n");
  // Workspace group: announced with its label.
  expect(joined).toContain("octoscode-web");
  // Session rows announce the accessible name with separators, not a
  // concatenation like "Session 5683b0f3now".
  expect(joined).toMatch(/Session [0-9a-f]{8}, /);
});
