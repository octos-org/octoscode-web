import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN, FIXTURE_TOKEN, startSession } from "./fixture-session";
import { openSettings } from "./sessions";

const TAB_KEY = "octoscode-web.tab-connection.v3";
const DRAFT_PREFIX = "octoscode-web.draft.v1:";

async function start(page: Page) {
  await startSession(page, "/workspace/storage-check");
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function warnsOnLeave(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function reopen(page: Page, url: string, token = FIXTURE_TOKEN) {
  await page.goto(url);
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page.getByLabel("Auth token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page
    .getByRole("button", { name: "Open conversation", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toBeVisible();
}

async function connectionAction(
  page: Page,
  action: "Disconnect" | "Forget server",
) {
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: action, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect to Octos" }),
  ).toBeVisible();
}

test("closed-tab drafts restore only for the authenticated principal and Forget clears that principal", async ({
  page,
  context,
}) => {
  await start(page);
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await input.fill("First session, owner A");
  const firstUrl = page.url();
  const second = await context.newPage();
  await start(second);
  await second
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Second session, owner A");
  const secondUrl = second.url();
  await input.fill("Updated first session, owner A");
  await expect.poll(() => warnsOnLeave(page)).toBe(false);
  await expect.poll(() => warnsOnLeave(second)).toBe(false);
  await page.close();
  await second.close();

  const restored = await context.newPage();
  await reopen(restored, firstUrl, "remember-this-tab-token");
  await expect(
    restored.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Updated first session, owner A");
  const otherOwner = await context.newPage();
  await reopen(otherOwner, secondUrl, "forget-me-token");
  await expect(
    otherOwner.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  await otherOwner
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Same session, owner B");
  await expect.poll(() => warnsOnLeave(otherOwner)).toBe(false);

  const otherSession = await context.newPage();
  await reopen(otherSession, secondUrl);
  await expect(
    otherSession.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Second session, owner A");
  await connectionAction(restored, "Disconnect");
  await restored.reload();
  await restored
    .getByRole("button", { name: "Forget saved connection", exact: true })
    .click();
  await otherSession.close();
  await otherOwner.close();
  const forgotten = await context.newPage();
  await reopen(forgotten, firstUrl);
  await expect(
    forgotten.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  const retained = await context.newPage();
  await reopen(retained, secondUrl, "forget-me-token");
  await expect(
    retained.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Same session, owner B");
  const durable = await retained.evaluate(() => JSON.stringify(localStorage));
  for (const token of [
    FIXTURE_TOKEN,
    "remember-this-tab-token",
    "forget-me-token",
  ]) {
    expect(durable).not.toContain(token);
  }
  expect(durable).not.toContain(TAB_KEY);
  expect(durable).not.toContain("owner A");
});

test("a 51st unsent draft evicts one older draft, stays saved, and never blocks navigation", async ({
  page,
}) => {
  await start(page);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)!).draftPrincipal,
        TAB_KEY,
      ),
    )
    .toBe("fixture-user");
  await page.evaluate(
    ({ prefix, origin }) => {
      const scope = `${prefix}${JSON.stringify([origin, "fixture-user"])}:`;
      for (let index = 0; index < 50; index++) {
        const key = JSON.stringify([
          `/workspace/saved-${index}`,
          "_main",
          `session-${index}`,
        ]);
        localStorage.setItem(
          scope + key,
          JSON.stringify(`Retained text ${index}`),
        );
      }
    },
    { prefix: DRAFT_PREFIX, origin: FIXTURE_ORIGIN },
  );
  await page.reload();
  const input = page.getByRole("textbox", { name: "Message Octos" });
  await expect(input).toBeVisible();
  const draft = "The 51st draft stays here until I send, clear, or copy it";
  await input.fill(draft);
  const drafts = () =>
    page.evaluate(
      (prefix) =>
        Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)),
      DRAFT_PREFIX,
    );
  // The 51st draft is persisted to localStorage...
  await expect
    .poll(async () =>
      (await drafts()).some(([, value]) => JSON.parse(value) === draft),
    )
    .toBe(true);
  // ...and exactly one pre-existing draft was evicted to make room. (Which
  // one is the cache's oldest; localStorage enumeration order is opaque, so
  // the e2e assertion is that exactly one of the 50 is gone.)
  const retained = await drafts();
  expect(retained).toHaveLength(50);
  const texts = retained.map(([, value]) => JSON.parse(value) as string);
  const evicted = Array.from(
    { length: 50 },
    (_, index) => `Retained text ${index}`,
  ).filter((text) => !texts.includes(text));
  expect(evicted).toHaveLength(1);
  // A persisted draft shows no capacity warning and no beforeunload guard.
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "already keeps 50 unsent drafts" }),
  ).toHaveCount(0);
  await expect.poll(() => warnsOnLeave(page)).toBe(false);
  // Navigation is not blocked: the explicit folder picker opens...
  await page
    .getByRole("group", { name: "Message settings" })
    .getByRole("button", { name: /^Folder / })
    .click();
  const chooser = page.getByRole("dialog", {
    name: "Choose a workspace",
    exact: true,
  });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveValue(draft);
  // ...and a full reload restores the 51st draft.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue(draft);
});
