import { expect, test, type Page } from "@playwright/test";
import { instrument } from "./attention-probe";
import {
  FIXTURE_TOKEN,
  openLink,
  runFolder,
  startSession,
} from "./fixture-session";
import {
  composer,
  productNavigation,
  selectedSessionId,
  sessionRow,
} from "./sessions";
import { observeFrames } from "./turn-observers";

/**
 * Chat / Code navigation (two-modes proposal §6 T-C), behind the default-off
 * `octoscode-web.two-modes` flag. The fixture plays a server with the
 * provisional `session.work_mode.v1` + `session.chat_workspace.v1` features
 * for this token only: two chats, each in its own folder.
 */
const TOKEN = "two-modes-e2e-token";
const FLAG = "octoscode-web.two-modes";

function turnFlagOn(page: Page) {
  return page.addInitScript((key) => localStorage.setItem(key, "on"), FLAG);
}

const modeSwitch = (page: Page) =>
  productNavigation(page).getByRole("group", { name: "Work mode" });
const modeButton = (page: Page, name: "Chat" | "Code") =>
  modeSwitch(page).getByRole("button", { name, exact: true });
const chatRow = (page: Page, title: string) =>
  productNavigation(page).getByRole("treeitem", { name: new RegExp(title) });

test("Chat and Code keep their own lists and selections, across notifications, reloads and a phone", async ({
  browser,
  page,
}) => {
  await turnFlagOn(page);
  await instrument(page, "granted", true);
  const frames = observeFrames(page);
  await startSession(page, runFolder("two-modes"), TOKEN);
  const navigation = productNavigation(page);
  const codeId = await selectedSessionId(navigation);

  // Code: the project Session, no chats.
  await expect(modeButton(page, "Code")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chatRow(page, "Weekly notes draft")).toHaveCount(0);

  // Keyboard: Chat sits before Code in the tab order and Enter switches.
  await modeButton(page, "Code").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(modeButton(page, "Chat")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(modeButton(page, "Chat")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Nothing of Chat's is selected yet: its home, not the Code Session.
  await expect(
    page.getByRole("heading", { name: "Chat", level: 1 }),
  ).toBeVisible();
  await expect(composer(page)).toBeHidden();
  await expect(sessionRow(navigation, codeId)).toHaveCount(0);
  await expect(navigation.getByRole("treeitem")).toHaveText([
    /Weekly notes draft/,
    /Talk outline/,
  ]);

  // A chat opens in its own folder.
  await chatRow(page, "Talk outline").click();
  await expect(composer(page)).toBeEnabled();
  expect(frames.calls("session/open").at(-1)?.params?.cwd).toMatch(
    /^\/srv\/chats\/[^/]+\/chat-outline$/,
  );

  // Each mode comes back to what it had selected.
  await modeButton(page, "Code").click();
  await expect(sessionRow(navigation, codeId)).toHaveAttribute(
    "aria-current",
    "page",
  );
  // No chat leaks into Code: no folder of its own, no "continue" to it.
  await expect(navigation.locator("[data-session-id]")).toHaveCount(1);
  await expect(page.getByText(/chat-(notes|outline)/)).toHaveCount(0);
  await modeButton(page, "Chat").click();
  await expect(chatRow(page, "Talk outline")).toHaveAttribute(
    "aria-current",
    "page",
  );

  // A chat finishing while Code is on screen: its notification leads back.
  await composer(page).fill("Continue this turn while I open another Session");
  await composer(page).press("Enter");
  await modeButton(page, "Code").click();
  await expect(sessionRow(navigation, codeId)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect
    .poll(() => page.evaluate(() => window.__attentionProbe.notices.length))
    .toBe(1);
  // Chat rows are listed only in Chat, so this is Chat with its chat open.
  await page.evaluate(() => window.__attentionProbe.click(0));
  await expect(chatRow(page, "Talk outline")).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The server's word decides the mode after a reload.
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  await expect(chatRow(page, "Talk outline")).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Switching only navigates: no permission or profile change went out.
  expect(frames.sent.filter((frame) => frame.method?.endsWith("/set"))).toEqual(
    [],
  );

  // A phone opening the same link lands in Chat too, and switches from its
  // drawer, which stays open so the other list is one tap away.
  expect(page.url()).toContain("?s=");
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await turnFlagOn(phone);
  await openLink(phone, page.url(), TOKEN);
  await phone.getByRole("button", { name: "Open sessions" }).tap();
  await expect(modeButton(phone, "Chat")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await modeButton(phone, "Code").tap();
  await modeButton(phone, "Chat").tap();
  await chatRow(phone, "Weekly notes draft").tap();
  await expect(modeSwitch(phone)).toBeHidden();
  await phone.getByRole("button", { name: "Open sessions" }).tap();
  await expect(chatRow(phone, "Weekly notes draft")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await phone.close();
});

test("Chat stays off, and says why, on a server without chat folders", async ({
  page,
}) => {
  await startSession(page, runFolder("two-modes-off"), FIXTURE_TOKEN);
  // Flag off: the sidebar is unchanged.
  await expect(modeSwitch(page)).toHaveCount(0);

  await page.evaluate((key) => localStorage.setItem(key, "on"), FLAG);
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  const chat = modeButton(page, "Chat");
  await expect(chat).toHaveAttribute("aria-disabled", "true");
  await expect(chat).toHaveAccessibleDescription(
    "Chat needs a server that gives every chat its own folder. This server does not yet.",
  );
  await chat.focus();
  await page.keyboard.press("Enter");
  await expect(modeButton(page, "Code")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(composer(page)).toBeEnabled();
});
