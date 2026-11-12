import { expect, test, type Page } from "@playwright/test";

/** The mock fixture server the e2e project starts (apps/web/scripts/mock-ui-server.mjs). */
export const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
/** The tab-scoped token the fixture accepts; not a real credential. */
export const FIXTURE_TOKEN = "tab-scoped-e2e-token";
export const COMPOSER_PLACEHOLDER =
  "Ask Octos to change, explain, or review code…";

/**
 * Connect to the fixture and start a Session in `cwd` through the product's
 * own connect form and workspace chooser, every control activated with Enter.
 * Resolves once the started path is shown and the composer accepts input.
 */
export async function connectAndStartWorkspace(
  page: Page,
  cwd: string,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token").fill(FIXTURE_TOKEN);
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .press("Enter");
  const chooser = page.getByRole("region", {
    name: /Choose a workspace|Add workspace/,
  });
  await expect(chooser).toBeVisible();
  if (
    await chooser.getByRole("button", { name: "Add workspace" }).isVisible()
  ) {
    await chooser.getByRole("button", { name: "Add workspace" }).press("Enter");
  }
  const add = page.getByRole("region", { name: "Add workspace" });
  await add.getByLabel("Server workspace path").fill(cwd);
  await add
    .getByRole("button", { name: /^(Add & Start|Start session)$/ })
    .press("Enter");
  await expect(page.getByText(cwd, { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeEnabled();
}

/** Opens `url` and connects from the connect form with `token`. */
export async function connect(
  page: Page,
  url = "/",
  token = FIXTURE_TOKEN,
): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

/** Opens a saved conversation link: connect, then Open conversation. */
export async function openLink(
  page: Page,
  url: string,
  token = FIXTURE_TOKEN,
): Promise<void> {
  await connect(page, url, token);
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Connect with `token` and start a Session by typing `cwd` into the workspace
 * path (past the folder browser, for tokens that advertise it), Enter for each
 * step. Resolves once the composer accepts input.
 */
export async function startSession(
  page: Page,
  cwd: string,
  token = FIXTURE_TOKEN,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  const manual = page.getByRole("button", { name: "Enter path manually" });
  const path = page.getByLabel("Server workspace path");
  await expect(manual.or(path).first()).toBeVisible();
  if (await manual.isVisible()) await manual.click();
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
}

/**
 * A `/srv/work` folder owned by this test run. The fixture keeps Sessions and
 * staged peers for the whole process, so a retry or `--repeat-each` run in a
 * fixed folder also matches the rows an earlier run left behind (T-0435).
 */
export function runFolder(name: string): string {
  const { retry, repeatEachIndex } = test.info();
  return `/srv/work/${name}-run${repeatEachIndex}-${retry}`;
}

/** The open Session's id, read from the `?s=` reference in the address. */
export async function openSessionId(page: Page): Promise<string> {
  let reference: string | null = null;
  await expect
    .poll(() => (reference = new URL(page.url()).searchParams.get("s")))
    .not.toBeNull();
  return (JSON.parse(reference!) as string[])[2]!;
}

/**
 * Deliver `name` to the Session the way Core's send_file does and open its
 * preview. `body` is the file; without one the fixture writes a sample.
 */
export async function previewDelivery(
  page: Page,
  sessionId: string,
  name: string,
  body?: Buffer,
) {
  const response = await page.request.post(
    `${FIXTURE_ORIGIN}/__test__/deliver-file?session_id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}&valid=1`,
    body ? { data: body } : {},
  );
  expect(response.ok()).toBe(true);
  const item = page.locator(`[data-attachment="${name}"]`);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = item
    .locator(".artifact-preview, [data-artifact-kind]")
    .last();
  await expect(preview).toBeVisible();
  return { item, preview };
}
