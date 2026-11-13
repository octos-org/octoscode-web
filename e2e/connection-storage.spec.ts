import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_TOKEN, openLink, startSession } from "./fixture-session";
import { openSettings } from "./sessions";

const TAB_KEY = "octoscode-web.tab-connection.v3";

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
  await openLink(restored, firstUrl, "remember-this-tab-token");
  await expect(
    restored.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("Updated first session, owner A");
  const otherOwner = await context.newPage();
  await openLink(otherOwner, secondUrl, "forget-me-token");
  await expect(
    otherOwner.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  await otherOwner
    .getByRole("textbox", { name: "Message Octos" })
    .fill("Same session, owner B");
  await expect.poll(() => warnsOnLeave(otherOwner)).toBe(false);

  const otherSession = await context.newPage();
  await openLink(otherSession, secondUrl);
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
  await openLink(forgotten, firstUrl);
  await expect(
    forgotten.getByRole("textbox", { name: "Message Octos" }),
  ).toHaveValue("");
  const retained = await context.newPage();
  await openLink(retained, secondUrl, "forget-me-token");
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
