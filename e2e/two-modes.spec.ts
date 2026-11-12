import { expect, test, type Page } from "@playwright/test";
import { instrument } from "./attention-probe";
import { axeViolations } from "./axe";
import {
  FIXTURE_TOKEN,
  openLink,
  runFolder,
  startSession,
} from "./fixture-session";
import {
  productNavigation,
  selectedSessionId,
  sessionRow,
  stopButton,
} from "./sessions";
import { observeFrames } from "./turn-observers";
import { interceptRequests, sendError } from "./wire";

/**
 * Chat / Code navigation (two-modes proposal §6 T-C), behind the default-off
 * `octoscode-web.two-modes` flag. The fixture plays a server with the
 * provisional `session.work_mode.v1` + `session.chat_workspace.v1` features
 * for this token only: two chats, each in its own folder, and new chats made
 * with `session/chat/create` (T-D).
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
/** The message box by name: a chat has its own placeholder. */
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const chatRow = (page: Page, title: string) =>
  productNavigation(page).getByRole("treeitem", { name: new RegExp(title) });

/** Chat mode, then a new chat from its home. */
async function newChat(page: Page) {
  await startSession(page, runFolder("two-modes-chat"), TOKEN);
  await modeButton(page, "Chat").click();
  await page.getByRole("button", { name: "New chat" }).last().click();
  await expect(composer(page)).toHaveAttribute(
    "placeholder",
    "Ask Octos anything…",
  );
}

const WCAG_AA = ["wcag2a", "wcag2aa"];

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
  // Office and general templates belong to Chat now (proposal §3).
  await expect(page.getByText("Write a weekly report")).toHaveCount(0);

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

test("a new chat is read-only with no network, drafts in the conversation and keeps its steps folded", async ({
  page,
}) => {
  await turnFlagOn(page);
  const frames = observeFrames(page);
  await newChat(page);
  // The server confirmed read-only with no network for this chat's own id.
  const chatId = frames.calls("session/chat/create")[0]!.params!.session_id;
  expect(frames.calls("permission/profile/set").at(-1)?.params).toEqual({
    session_id: chatId,
    update: { mode: "read_only", network: "deny" },
  });
  await expect(
    page.getByRole("button", { name: "Permission: Read · Network blocked" }),
  ).toBeDisabled();
  // No folder anywhere, and only templates that draft in the chat.
  await expect(page.getByRole("button", { name: /^Folder / })).toHaveCount(0);
  await expect(page.getByText("/srv/chats/")).toHaveCount(0);
  await expect(page.getByText("Draft in chat")).toHaveCount(3);
  expect(await axeViolations(page, "main", WCAG_AA)).toEqual([]);
  await page.getByRole("button", { name: "Use this" }).first().click();
  await expect(composer(page)).toHaveValue(/here in the chat as Markdown/);
  await expect(composer(page)).not.toHaveValue(/save it/);

  // A long answer streams in; its step folds into Activity even mid-turn.
  await composer(page).fill("Chat draft fixture");
  await composer(page).press("Enter");
  const activity = page.locator("details[data-step-group]");
  await expect(activity).toHaveCount(1);
  await expect(stopButton(page)).toBeVisible();
  await expect(activity).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Next week" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Open tickets" })).toBeVisible();
  await expect(page.getByText("Turn complete")).toHaveCount(0);
  await activity.getByText("Activity").click();
  await expect(activity.getByText("Read file notes.md")).toBeVisible();

  // The panel holds only what the chat produced.
  await page.getByRole("button", { name: "Outputs" }).click();
  await expect(page.getByRole("tab")).toHaveText([/Outputs/]);
  expect(await axeViolations(page, "main", WCAG_AA)).toEqual([]);

  // Read-only is the server's: a write fails there, and says so.
  await composer(page).fill("Fail a write fixture");
  await composer(page).press("Enter");
  await expect(page.locator("details[data-step-group]")).toHaveCount(2);
  await expect(page.locator("details[data-step-group]").last()).toContainText(
    "1 steps failed",
  );
  // ...and, once the turn is over, no offer to widen it: file outputs are a
  // choice of their own (T-E).
  await expect(stopButton(page)).toHaveCount(0);
  await expect(page.getByText("Switch to write and continue")).toHaveCount(0);

  // A reload brings the same chat back, answer and all.
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Next week" })).toBeVisible();
  await expect(modeButton(page, "Chat")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a chat sends nothing until the server confirms read-only, in either language", async ({
  page,
}) => {
  await turnFlagOn(page);
  let refuse = true;
  await interceptRequests(page, (request, socket) => {
    if (request.method !== "permission/profile/set" || !refuse) return;
    refuse = false;
    sendError(socket, request.id, { code: -32603, message: "Locked" });
    return true;
  });
  const starts = observeFrames(page);
  await newChat(page);
  await expect(page.getByRole("alert")).toContainText(
    "The server hasn't confirmed that this chat is read-only with no network",
  );
  await composer(page).fill("Chat draft fixture");
  await composer(page).press("Enter");
  expect(starts.calls("turn/start")).toEqual([]);

  // The same chat in Chinese after a reload, still blocked, then confirmed.
  await page.evaluate(() =>
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
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "服务器还没确认这个对话是只读、禁止联网",
  );
  await expect(page.getByText("在对话里起草")).toHaveCount(3);
  await page.getByRole("button", { name: "重试权限默认值" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /读取 · 禁止联网/ }),
  ).toBeVisible();
});
