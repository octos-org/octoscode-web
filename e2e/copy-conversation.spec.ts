import { expect, test, type Page } from "@playwright/test";

const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const PROMPT = "Show the Markdown transcript surface";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function startConversation(page: Page, cwd: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  await page.getByLabel("Server workspace path").fill(cwd);
  await page.getByLabel("Server workspace path").press("Enter");
}

test("copies the conversation as Markdown from the server's history", async ({
  page,
}) => {
  const cwd = `/workspace/copy-markdown-${Date.now()}`;
  await startConversation(page, cwd);
  const composer = page.getByRole("textbox", { name: "Message Octos" });
  await expect(composer).toBeEnabled();
  await composer.fill(PROMPT);
  await composer.press("Enter");
  // The last line of the fixture's reply: the turn has finished streaming.
  await expect(
    page.locator(".markdown-body").getByText("Raw HTML stays inert:"),
  ).toBeVisible();

  // The label (and so the accessible name) changes with the result, so hold
  // the button by its stable hook once found by name.
  await page.getByRole("button", { name: "Copy as Markdown" }).click();
  const copy = page.locator("[data-copy-conversation]");
  await expect(copy).toHaveAttribute("data-copy-conversation", "copied");
  await expect(copy).toHaveText("Copied");
  const markdown = await page.evaluate(() => navigator.clipboard.readText());

  const leaf = cwd.split("/").at(-1)!;
  expect(markdown.startsWith(`# ${leaf}\n\n- Workspace: \`${cwd}\`\n`)).toBe(
    true,
  );
  expect(markdown).toContain(`## User\n\n${PROMPT}\n`);
  // The assistant's Markdown is carried verbatim, not the rendered text.
  expect(markdown).toContain("## Assistant\n\n## Durable coding transcript");
  expect(markdown).toContain("| Cursor replay | Ready |");
  expect(markdown).toContain(
    "```ts\nexport function answer(value: number): number {",
  );
  expect(markdown).not.toContain("Incomplete");
});

test("says there is nothing to copy for a conversation with no messages yet", async ({
  page,
}) => {
  await startConversation(page, `/workspace/copy-empty-${Date.now()}`);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Copy as Markdown" }).click();
  const copy = page.locator("[data-copy-conversation]");
  await expect(copy).toHaveAttribute("data-copy-conversation", "empty");
  await expect(copy).toHaveText("Nothing to copy");
});

test("keeps the phone header for the workspace title: no copy button there", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startConversation(page, `/workspace/copy-phone-${Date.now()}`);
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeEnabled();
  await expect(page.locator("[data-copy-conversation]")).toHaveCount(0);
});
