import { expect, test } from "@playwright/test";
import { instrument } from "./attention-probe";
import { axeViolations } from "./axe";
import {
  FIXTURE_TOKEN,
  openLink,
  openSessionId,
  runFolder,
  startSession,
} from "./fixture-session";
import { holdPermissionReceipt } from "./permission-receipt";
import {
  productNavigation,
  selectedSessionId,
  selectSession,
  sessionRow,
  stopButton,
} from "./sessions";
import { disconnect } from "./fixture-controls";
import { observeFrames } from "./turn-observers";
import {
  CHAT_FEATURES,
  chatRow,
  composer,
  expectMode,
  FLAG,
  modeButton,
  modeSwitch,
  newChat,
  TOKEN,
  turnFlagOn,
} from "./two-modes";
import { interceptRequests, sendError } from "./wire";

const WCAG_AA = ["wcag2a", "wcag2aa"];

test("Chat and Code keep their own lists and selections, across notifications, reloads and a phone", async ({
  browser,
  page,
  request,
}) => {
  await turnFlagOn(page);
  await instrument(page, "granted", true);
  const frames = observeFrames(page);
  await startSession(page, runFolder("two-modes"), TOKEN);
  const navigation = productNavigation(page);
  const codeId = await selectedSessionId(navigation);

  // Code: the project Session, no chats.
  await expectMode(page, "Code");
  await expect(chatRow(page, "Weekly notes draft")).toHaveCount(0);
  // Office and general templates belong to Chat now (proposal §3).
  await expect(page.getByText("Write a weekly report")).toHaveCount(0);

  // Keyboard: Chat sits before Code in the tab order and Enter switches.
  await modeButton(page, "Code").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(modeButton(page, "Chat")).toBeFocused();
  await page.keyboard.press("Enter");
  await expectMode(page, "Chat");
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

  // The server's word decides the mode after a reload and a reconnect, and
  // every new socket asks for Chat's features again.
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  const sockets = frames.features.length;
  await disconnect(request);
  await expect.poll(() => frames.features.length).toBeGreaterThan(sockets);
  await expect(composer(page)).toBeEnabled();
  await expect(chatRow(page, "Talk outline")).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const features of frames.features)
    expect(features).toEqual(expect.arrayContaining(CHAT_FEATURES));

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
  await expectMode(phone, "Chat");
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

// T-0668 (T-0622 F-01): a reload in Chat forgot Code's Session, so switching
// back landed on the Code home although the server still listed it.
test("each mode reopens its own last Session after a reload, a reconnect and in another tab, and never one that is gone", async ({
  page,
  request,
}) => {
  await turnFlagOn(page);
  const frames = observeFrames(page);
  await startSession(page, runFolder("two-modes-restore"), TOKEN);
  const navigation = productNavigation(page);
  const codeRow = await selectedSessionId(navigation);
  await modeButton(page, "Chat").click();
  await page.getByRole("button", { name: "New chat" }).last().click();
  await expect(composer(page)).toHaveAttribute(
    "placeholder",
    "Ask Octos anything…",
  );
  const chatRowId = await selectedSessionId(navigation);
  const chatId = frames.calls("session/chat/create")[0]!.params!.session_id;
  await composer(page).fill("An unsent chat draft");

  await page.reload();
  await expect(composer(page)).toBeEnabled();
  await modeButton(page, "Code").click();
  await expect(sessionRow(navigation, codeRow)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.locator("[data-session-id]")).toHaveCount(1);
  await disconnect(request);
  await expect(composer(page)).toBeEnabled();
  await modeButton(page, "Chat").click();
  await expect(sessionRow(navigation, chatRowId)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(composer(page)).toHaveValue("An unsent chat draft");
  await modeButton(page, "Code").click();
  await expect(composer(page)).toHaveValue("");
  await expect(sessionRow(navigation, codeRow)).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Switching only navigated: one chat made, and the one SET is its
  // read-only default.
  expect(frames.calls("session/chat/create")).toHaveLength(1);
  expect(
    frames.sent
      .filter((frame) => frame.method?.endsWith("/set"))
      .map((frame) => frame.params?.session_id),
  ).toEqual([chatId]);

  // Another tab keeps its own selections, and deletes this tab's chat.
  const tab = await page.context().newPage();
  await turnFlagOn(tab);
  await openLink(tab, page.url(), TOKEN);
  await modeButton(tab, "Chat").click();
  await expect(
    tab.getByRole("heading", { name: "Chat", level: 1 }),
  ).toBeVisible();
  const tabNavigation = productNavigation(tab);
  await sessionRow(tabNavigation, chatRowId).hover();
  await sessionRow(tabNavigation, chatRowId)
    .getByRole("button", { name: /^More actions for/ })
    .click();
  await tab.getByRole("menuitem", { name: /^Delete/ }).click();
  await tab.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sessionRow(tabNavigation, chatRowId)).toHaveCount(0);
  await tab.close();

  // Gone on the server: this tab opens nothing and says so.
  const opens = frames.calls("session/open").length;
  await modeButton(page, "Chat").click();
  await expect(
    page.getByText(
      "The chat last open here is no longer available, so nothing was opened. Choose one from the list.",
    ),
  ).toBeVisible();
  await expect(sessionRow(navigation, chatRowId)).toHaveCount(0);
  expect(
    frames
      .calls("session/open")
      .slice(opens)
      .filter((frame) => frame.params?.session_id === chatId),
  ).toEqual([]);
});

test("Chat opens only when the page asked for both features and the server gave them", async ({
  browser,
  page,
}) => {
  const frames = observeFrames(page);
  // Flag off: the sidebar and request are unchanged, even where Chat exists.
  await startSession(page, runFolder("two-modes-off"), TOKEN);
  await expect(modeSwitch(page)).toHaveCount(0);
  const [plain] = frames.features;
  for (const feature of CHAT_FEATURES) expect(plain).not.toContain(feature);
  const open = frames.calls("session/open")[0]!;
  await frames.settled(open);
  expect(frames.replyTo(open)?.result).not.toHaveProperty("opened.work_mode");

  // Flag on: the same request plus both features, and the answer enables Chat.
  await page.evaluate((key) => localStorage.setItem(key, "on"), FLAG);
  await page.reload();
  await expect(composer(page)).toBeEnabled();
  expect(frames.features.at(-1)).toEqual([...plain!, ...CHAT_FEATURES]);
  await expect(modeButton(page, "Chat")).not.toHaveAttribute("aria-disabled");

  // An older server, and one with work modes but no folder per chat (T-A
  // only): Chat stays off and says why.
  for (const token of [FIXTURE_TOKEN, "two-modes-partial-e2e-token"]) {
    const older = await browser.newPage();
    await turnFlagOn(older);
    await startSession(older, runFolder(`two-modes-${token}`), token);
    const chat = modeButton(older, "Chat");
    await expect(chat).toHaveAttribute("aria-disabled", "true");
    await expect(chat).toHaveAccessibleDescription(
      "Chat needs a server that gives every chat its own folder. This server does not yet.",
    );
    await chat.focus();
    await older.keyboard.press("Enter");
    await expectMode(older, "Code");
    await older.close();
  }
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
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
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
  await expectMode(page, "Chat");
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

test("file outputs turn on through the real SET, write into Outputs, and turn off again", async ({
  page,
  request,
}) => {
  await turnFlagOn(page);
  const frames = observeFrames(page);
  await newChat(page);
  const chatId = frames.calls("session/chat/create")[0]!.params!.session_id;
  // T-0671 (F-0634-2): every SET is counted with its parameters. One Allow or
  // Turn off is exactly one SET; nothing follows its readback or a reconnect.
  const sets = () =>
    frames.calls("permission/profile/set").map((frame) => frame.params);
  const reads = () => frames.calls("permission/profile/list").length;
  const set = (mode: string) => ({
    session_id: chatId,
    update: { mode, network: "deny" },
  });
  await expect.poll(sets).toEqual([set("read_only")]);

  // Off by default (the read-only draft chain is the T-D test's).
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }).first(),
  ).toBeVisible();

  // F-04: focusable and Enter-operable, not mouse-only.
  const allow = page
    .getByRole("button", { name: "Allow file outputs" })
    .first();
  await expect(allow).toBeEnabled();
  await allow.focus();
  await expect(allow).toBeFocused();
  let readsBefore = reads();
  await page.keyboard.press("Enter");
  await expect(page.getByText("File outputs on").first()).toBeVisible();
  await expect.poll(reads).toBeGreaterThan(readsBefore);

  // The next message writes report.md into this chat's own folder.
  await composer(page).fill("Chat draft fixture as a file");
  await composer(page).press("Enter");
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "report.md New" }).click();
  await expect(
    page.getByText("Saved into this chat's own folder."),
  ).toBeVisible();
  expect(await axeViolations(page, "main", WCAG_AA)).toEqual([]);

  // Turn off through the same entry: the server is asked, never full access.
  expect(sets()).toEqual([set("read_only"), set("workspace_write")]);
  readsBefore = reads();
  await page
    .getByRole("button", { name: "Turn off file outputs" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }).first(),
  ).toBeVisible();
  await expect.poll(reads).toBeGreaterThan(readsBefore);
  const sockets = frames.features.length;
  await disconnect(request);
  await expect.poll(() => frames.features.length).toBeGreaterThan(sockets);
  await expect(composer(page)).toBeEnabled();
  expect(sets()).toEqual([
    set("read_only"),
    set("workspace_write"),
    set("read_only"),
  ]);
});

test("a failed set is reported, never retried, and re-read restores the server truth", async ({
  page,
}) => {
  await turnFlagOn(page);
  let failOnce = true;
  const updates: unknown[] = [];
  let permissionReads = 0;
  // Count at the transport route (page-side WS listeners miss rerouted frames).
  await interceptRequests(page, (request, socket) => {
    if (request.method === "permission/profile/list") permissionReads += 1;
    if (request.method === "permission/profile/set")
      updates.push(request.params?.update);
    if (
      request.method === "permission/profile/set" &&
      request.params?.update?.mode === "workspace_write"
    ) {
      if (failOnce) {
        failOnce = false;
        sendError(socket, request.id, {
          code: -32603,
          message: "set incomplete",
        });
        return true;
      }
    }
  });
  await newChat(page);
  const allow = page
    .getByRole("button", { name: "Allow file outputs" })
    .first();
  await allow.click();
  await expect(page.getByRole("alert")).toContainText("set incomplete");
  // The failure was reported once; the page sent exactly one write, no retry.
  const RO = { mode: "read_only", network: "deny" };
  const RW = { mode: "workspace_write", network: "deny" };
  expect(updates).toEqual([RO, RW]);
  // Re-read must really ask the server again and clear the failure: before
  // the click the button state was already off, so the alert clearing and a
  // NEW permission read are the observable proof.
  const readsBefore = permissionReads;
  await page
    .getByRole("button", { name: "Re-read the server's permission" })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(permissionReads).toBeGreaterThan(readsBefore);
  expect(updates).toEqual([RO, RW]);
  // A second, explicit Allow is its own operation: one more SET, and it lands.
  await allow.click();
  await expect(page.getByText("File outputs on").first()).toBeVisible();
  expect(updates).toEqual([RO, RW, RW]);
});

// T-0666 (audit T-0623 P1): Core can already write once it applied Allow, so
// the page starts nothing until the receipt is verified and read back.
test("nothing starts while a chat's permission change is unconfirmed, from Enter or Send", async ({
  page,
}) => {
  await turnFlagOn(page);
  const receipt = await holdPermissionReceipt(page);
  await newChat(page);
  const allow = page
    .getByRole("button", { name: "Allow file outputs" })
    .first();
  const revoke = page
    .getByRole("button", { name: "Turn off file outputs" })
    .first();
  const tryToSend = async (text: string) => {
    await composer(page).fill(text);
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue(text);
    await page.getByRole("button", { name: "Send prompt" }).click();
    await expect(composer(page)).toHaveValue(text);
  };

  receipt.arm();
  await allow.click();
  await expect.poll(receipt.isHeld).toBe(true);
  await tryToSend("Chat draft fixture as a file");
  await expect(
    page.getByText(
      "Changing the permission. Sending waits until the server confirms it.",
    ),
  ).toBeVisible();
  receipt.release();
  await expect(revoke).toBeEnabled();
  expect(receipt.starts()).toBe(0);
  await composer(page).press("Enter");
  await expect(page.locator(".entry-user")).toHaveCount(1);
  await expect(stopButton(page)).toHaveCount(0);

  // A revoke the server does not confirm stays closed, is never sent again,
  // and only a re-read of the server's own value opens the chat.
  receipt.arm();
  await revoke.click();
  await expect.poll(receipt.isHeld).toBe(true);
  await tryToSend("Still allowed to write?");
  receipt.release((result) => {
    result.applied = false;
  });
  await expect(
    page.getByText(
      "The server hasn't confirmed this chat's permission change.",
    ),
  ).toBeVisible();
  await expect(allow.or(revoke)).toHaveCount(0);
  await tryToSend("Still allowed to write?");
  expect(receipt.starts()).toBe(1);
  await page
    .getByRole("button", { name: "Re-read the server's permission" })
    .click();
  await expect(allow).toBeVisible();
  await composer(page).press("Enter");
  await expect.poll(receipt.starts).toBe(2);
  expect(receipt.updates).toEqual([
    { mode: "workspace_write", network: "deny" },
    { mode: "read_only", network: "deny" },
  ]);
});

test("another tab waits for a chat's permission change, and a late receipt opens no other chat", async ({
  page,
}) => {
  await turnFlagOn(page);
  const receipt = await holdPermissionReceipt(page);
  await newChat(page);
  const chat = await openSessionId(page);
  const row = await selectedSessionId(productNavigation(page));
  const tab = await page.context().newPage();
  await turnFlagOn(tab);
  const other = await holdPermissionReceipt(tab);
  await openLink(tab, page.url(), TOKEN);
  await tab.getByRole("button", { name: "Take over here" }).click();

  // This tab's Allow is outstanding: the other tab holds the same chat.
  receipt.arm();
  await page
    .getByRole("button", { name: "Allow file outputs" })
    .first()
    .click();
  await expect.poll(receipt.isHeld).toBe(true);
  await expect(
    tab.getByText("Another tab is changing this chat's permission."),
  ).toBeVisible();
  await composer(tab).fill("Chat draft fixture as a file");
  await composer(tab).press("Enter");
  receipt.release();
  // Confirmed here, so it re-reads by itself and sends.
  await expect(tab.getByText("File outputs on").first()).toBeVisible();
  expect(other.starts()).toBe(0);
  await composer(tab).press("Enter");
  await expect.poll(other.starts).toBe(1);
  await expect(tab.locator(".entry-user")).toHaveCount(1);
  await expect(stopButton(tab)).toHaveCount(0);

  // A revoke answered after this tab moved to a new chat leaves that chat
  // alone and the first one unconfirmed in both tabs.
  receipt.arm();
  await page
    .getByRole("button", { name: "Turn off file outputs" })
    .first()
    .click();
  await expect.poll(receipt.isHeld).toBe(true);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect.poll(() => openSessionId(page)).not.toBe(chat);
  await composer(page).fill("A new chat sends at once");
  await composer(page).press("Enter");
  await expect.poll(receipt.starts).toBe(1);
  receipt.release();
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }).first(),
  ).toBeVisible();
  await expect(
    tab.getByText("The server hasn't confirmed this chat's permission change."),
  ).toBeVisible();
  await selectSession(productNavigation(page), row);
  await expect(
    page.getByText(
      "The server hasn't confirmed this chat's permission change.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Re-read the server's permission" })
    .click();
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }).first(),
  ).toBeVisible();
  expect(receipt.updates).toHaveLength(2);
});

test("a chat keeps inline drafts only where the server cannot change permissions", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/ui-protocol/ws**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      for (const capabilities of [
        frame.result?.capabilities,
        frame.result?.opened?.capabilities,
      ]) {
        if (!capabilities?.supported_methods) continue;
        capabilities.supported_methods = capabilities.supported_methods.filter(
          (method: string) => !method.startsWith("permission/profile/"),
        );
      }
      socket.send(JSON.stringify(frame));
    });
  });
  await turnFlagOn(page);
  await newChat(page);
  // No file-write promise anywhere: the control simply does not exist.
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }),
  ).toHaveCount(0);
  await expect(composer(page)).toBeEnabled();
});

test("two chats keep their own file-outputs state and files apart", async ({
  browser,
  page,
}) => {
  await turnFlagOn(page);
  const frames = observeFrames(page);
  await startSession(page, runFolder("two-modes-isolate"), TOKEN);
  await modeButton(page, "Chat").click();

  // Weekly notes draft: its server permission is write → on.
  await chatRow(page, "Weekly notes draft").click();
  await expect(page.getByText("File outputs on").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Turn off file outputs" })
    .first()
    .click();
  const notesId = frames.calls("session/open").at(-1)?.params?.session_id;
  expect(frames.calls("permission/profile/set").at(-1)?.params).toEqual({
    session_id: notesId,
    update: { mode: "read_only", network: "deny" },
  });
  await expect(
    page.getByRole("button", { name: "Allow file outputs" }).first(),
  ).toBeVisible();

  // Talk outline: untouched — its own server permission still says write.
  await chatRow(page, "Talk outline").click();
  await expect(page.getByText("File outputs on").first()).toBeVisible();

  // F-04: finger-sized on a phone's own primary session (coarse-pointer).
  const phone = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await turnFlagOn(phone);
  await startSession(phone, runFolder("two-modes-isolate"), TOKEN);
  await phone.getByRole("button", { name: "Open sessions" }).tap();
  await modeButton(phone, "Chat").tap();
  await chatRow(phone, "Weekly notes draft").tap();
  expect(
    (
      await phone
        .getByRole("button", { name: "Allow file outputs" })
        .first()
        .boundingBox()
    )?.height ?? 0,
  ).toBeGreaterThanOrEqual(44);
});
