import { expect, type Page } from "@playwright/test";
import { runFolder, startSession } from "./fixture-session";
import { productNavigation } from "./sessions";

/**
 * Chat / Code navigation (two-modes proposal §6 T-C), behind the default-off
 * `octoscode-web.two-modes` flag. For this token the fixture plays a server
 * with both features below; like Core it reports them only when the page asks
 * for them. Then there are two chats, each in its own folder, and new chats
 * made with `session/chat/create` (T-D). Fixture evidence, not a real Core.
 */
export const TOKEN = "two-modes-e2e-token";
export const FLAG = "octoscode-web.two-modes";
export const CHAT_FEATURES = [
  "session.work_mode.v1",
  "session.chat_workspace.v1",
];

export function turnFlagOn(page: Page) {
  return page.addInitScript((key) => localStorage.setItem(key, "on"), FLAG);
}

export const modeSwitch = (page: Page) =>
  productNavigation(page).getByRole("group", { name: "Work mode" });
export const modeButton = (page: Page, name: "Chat" | "Code") =>
  modeSwitch(page).getByRole("button", { name, exact: true });
/** The switch shows `name` as the current mode. */
export const expectMode = (page: Page, name: "Chat" | "Code") =>
  expect(modeButton(page, name)).toHaveAttribute("aria-pressed", "true");
/** The message box by name: a chat has its own placeholder. */
export const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
export const chatRow = (page: Page, title: string) =>
  productNavigation(page).getByRole("treeitem", { name: new RegExp(title) });

/** Chat mode, then a new chat from its home. */
export async function newChat(page: Page) {
  await startSession(page, runFolder("two-modes-chat"), TOKEN);
  await modeButton(page, "Chat").click();
  await page.getByRole("button", { name: "New chat" }).last().click();
  await expect(composer(page)).toHaveAttribute(
    "placeholder",
    "Ask Octos anything…",
  );
}
