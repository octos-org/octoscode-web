import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { runFolder } from "./fixture-session.ts";

// T-0433: "Undo this turn" in the latest turn's summary, wired to Core's
// `pre-turn <turn_id>` snapshot, with redo through the `pre-restore` point.
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

test.afterEach(async ({ request }) => {
  await request.post(`${FIXTURE_ORIGIN}/__test__/session-list/reset`);
});

interface Frame {
  direction: "sent" | "received";
  method?: string;
  params?: Record<string, unknown>;
}
function observeRpc(page: Page) {
  const frames: Frame[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) =>
      frames.push({ ...JSON.parse(String(payload)), direction: "sent" }),
    );
  });
  return {
    requests: (method: string) =>
      frames.filter(
        (frame) => frame.direction === "sent" && frame.method === method,
      ),
  };
}

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message Octos" });
const timeline = (page: Page) =>
  page.getByRole("log", { name: "Conversation timeline" });
const summary = (page: Page) =>
  page.getByRole("region", { name: "Turn summary" }).last();
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Session panel" });

async function start(page: Page, workspace: string) {
  await page.goto("/");
  await page.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByLabel("Auth token", { exact: true }).press("Enter");
  const manual = page.getByRole("button", { name: "Enter path manually" });
  const pathInput = page.getByLabel("Server workspace path");
  await expect(manual.or(pathInput).first()).toBeVisible();
  if (await manual.isVisible().catch(() => false)) await manual.click();
  await pathInput.fill(workspace);
  await pathInput.press("Enter");
  await expect(composer(page)).toBeEnabled();
}

async function runTurn(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
}

async function snapshots(request: APIRequestContext, sessionId: string) {
  return (await (
    await request.get(
      `${FIXTURE_ORIGIN}/__test__/snapshots/state?session_id=${encodeURIComponent(sessionId)}`,
    )
  ).json()) as {
    snapshots: { id: string; label: string; turn_id?: string }[];
    restores: string[];
  };
}

async function control(
  request: APIRequestContext,
  path: string,
  sessionId: string,
  query = "",
) {
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/snapshots/${path}?session_id=${encodeURIComponent(sessionId)}${query}`,
      )
    ).status(),
  ).toBe(204);
}

async function confirm(
  scope: Locator,
  action: "undo" | "redo",
): Promise<Locator> {
  await scope
    .getByRole("button", {
      name: action === "undo" ? "Undo this turn" : "Redo this turn",
    })
    .click();
  const group = scope.getByRole("group", {
    name: action === "undo" ? "Confirm undo" : "Confirm redo",
  });
  await expect(group).toBeVisible();
  return group;
}

test("undo puts the turn's files back, keeps the conversation and draft, redo survives a reload", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-walk");
  const prompt = "Change the app and then let me undo it";
  await runTurn(page, prompt);
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  const turnId = String(protocol.requests("turn/start")[0]!.params!.turn_id);
  const preTurn = (await snapshots(request, sessionId)).snapshots.find(
    (snapshot) => snapshot.turn_id === turnId,
  )!;
  expect(preTurn).toBeTruthy();

  await composer(page).fill("an unsent draft");
  // A double click on the entry opens one confirmation and sends nothing.
  await summary(page)
    .getByRole("button", { name: "Undo this turn" })
    .dblclick();
  const group = summary(page).getByRole("group", { name: "Confirm undo" });
  await expect(group).toHaveCount(1);
  await expect(group).toContainText(
    "Changes made by commands are undone too, including ones not counted above.",
  );
  const shown = await group.innerText();
  for (const id of [sessionId, turnId, preTurn.id])
    expect(shown).not.toContain(id);
  expect(protocol.requests("snapshot/restore")).toHaveLength(0);
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  const hydratesBefore = protocol.requests("session/hydrate").length;
  await group.getByRole("button", { name: "Undo file changes" }).dblclick();
  await expect(
    summary(page).getByText(
      "Undone. The files are back to how they were before this turn.",
    ),
  ).toBeVisible();
  expect(
    protocol.requests("snapshot/restore").map((frame) => frame.params),
  ).toEqual([{ session_id: sessionId, snapshot_id: preTurn.id }]);
  expect(protocol.requests("session/hydrate").length).toBeGreaterThan(
    hydratesBefore,
  );
  expect(protocol.requests("session/rollback")).toHaveLength(0);
  await expect(timeline(page).getByText(prompt, { exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(composer(page)).toHaveValue("an unsent draft");
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();

  const preRestore = (await snapshots(request, sessionId)).snapshots[0]!;
  expect(preRestore.label).toBe("pre-restore");

  await page.reload();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    summary(page).getByText(
      "This turn's file changes were undone. The conversation is kept.",
    ),
  ).toBeVisible();
  const redo = await confirm(summary(page), "redo");
  await redo.getByRole("button", { name: "Bring changes back" }).click();
  await expect(
    summary(page).getByText("Done. This turn's file changes are back."),
  ).toBeVisible();
  expect(
    protocol.requests("snapshot/restore").map((frame) => frame.params),
  ).toEqual([
    { session_id: sessionId, snapshot_id: preTurn.id },
    { session_id: sessionId, snapshot_id: preRestore.id },
  ]);

  await page.reload();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    summary(page).getByRole("button", { name: "Undo this turn" }),
  ).toBeVisible();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toHaveCount(0);
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);
});

test("a redo Core refuses over later edits shows Core's words and is not retried", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-conflict");
  await runTurn(page, "Write something to undo");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();

  await control(request, "next-restore", sessionId, "&mode=conflict");
  await (
    await confirm(summary(page), "redo")
  )
    .getByRole("button", { name: "Bring changes back" })
    .click();
  const alert = summary(page).getByRole("alert");
  // Without Core's structured reason (T-0467) the page never reads one out of
  // the message: it says Core refused, in Core's own words.
  await expect(alert).toContainText(
    "Core did not bring this turn back. Check the files in Changes.",
  );
  await expect(alert).toContainText(
    "Core said: restore failed: restore refused: files were edited after the snapshot was taken",
  );
  await page.waitForTimeout(500);
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeEnabled();
  await expect(
    summary(page).getByText(
      "This turn's file changes were undone. The conversation is kept.",
    ),
  ).toBeVisible();

  // Core saved the current state before refusing; that point is this tab's
  // own, so asking again is still sent once the edits are dealt with.
  await (
    await confirm(summary(page), "redo")
  )
    .getByRole("button", { name: "Bring changes back" })
    .click();
  await expect(
    summary(page).getByText("Done. This turn's file changes are back."),
  ).toBeVisible();
  expect(protocol.requests("snapshot/restore")).toHaveLength(3);
});

test("no entry when snapshots are off", async ({ page }) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-off");
  await runTurn(page, "Snapshots are off here");
  await expect.poll(() => protocol.requests("snapshot/list").length).toBe(1);
  await page.waitForTimeout(300);
  await expect(summary(page).getByRole("button")).toHaveCount(0);
  await expect(
    summary(page).getByText("This turn has no undo point on the server."),
  ).toHaveCount(0);
  expect(protocol.requests("snapshot/restore")).toHaveLength(0);
});

test("an honest note when Core kept no undo point for the turn", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-missing");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  await control(request, "forget-turns", sessionId, "&next=skip");
  await runTurn(page, "Core keeps no point for this one");
  await expect(
    summary(page).getByText("This turn has no undo point on the server."),
  ).toBeVisible();
  await expect(
    summary(page).getByRole("button", { name: "Undo this turn" }),
  ).toHaveCount(0);
  expect(protocol.requests("snapshot/restore")).toHaveLength(0);
});

test("Core's failures and a vanished point are reported as they are", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-failures");
  await runTurn(page, "Then fail to undo it");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  const alert = summary(page).getByRole("alert");

  for (const [mode, words] of [
    ["failure", "restore failed: failed to check out snapshot content"],
    [
      "running",
      "cannot restore while a turn is running in this session — interrupt it first",
    ],
  ] as const) {
    await control(request, "next-restore", sessionId, `&mode=${mode}`);
    await (
      await confirm(summary(page), "undo")
    )
      .getByRole("button", { name: "Undo file changes" })
      .click();
    await expect(alert).toContainText(
      "Core did not undo this turn. Check the files in Changes.",
    );
    await expect(alert).toContainText(`Core said: ${words}`);
    await expect(
      summary(page).getByRole("button", { name: "Undo this turn" }),
    ).toBeEnabled();
  }
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);

  // The undo point went away (pruned) between showing the entry and confirming it.
  await expect(
    summary(page).getByRole("button", { name: "Undo this turn" }),
  ).toBeEnabled();
  await control(request, "forget-turns", sessionId);
  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(alert).toContainText(
    "This turn's undo point is no longer on the server. No files were changed.",
  );
  await expect(
    summary(page).getByText("This turn has no undo point on the server."),
  ).toBeVisible();
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);
});

test("Changes re-reads the workspace after an undo and says the session list is a record", async ({
  page,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-changes");
  await runTurn(page, "Change a file, then look at Changes");
  await page.getByRole("button", { name: /^Session panel/ }).click();
  await panel(page)
    .getByRole("tab", { name: /^Changes/ })
    .click();
  const changes = panel(page).getByRole("tabpanel", { name: /^Changes/ });
  const git = changes.getByRole("button", { name: "Uncommitted (Git)" });
  await git.click();
  await expect(git).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => protocol.requests("diff/workspace/get").length)
    .toBeGreaterThan(0);
  const readsBefore = protocol.requests("diff/workspace/get").length;

  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();
  await expect
    .poll(() => protocol.requests("diff/workspace/get").length)
    .toBe(readsBefore + 1);

  await changes
    .getByRole("button", { name: "This session", exact: true })
    .click();
  await expect(
    changes.getByText(
      "The latest turn's file changes were undone. This list is what Octos recorded in this session; Uncommitted (Git) shows the files as they are now.",
    ),
  ).toBeVisible();
});

// T-0465: what Core lists after this turn decides what is offered. A restore
// this tab did not make (another tab, or an answer that never arrived) leaves
// the turn unknown; an undo of an earlier turn says nothing about the files
// once a later turn has run.
test("an answer that never arrives leaves the turn unknown: nothing re-offered, nothing resent", async ({
  page,
  request,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-lost");
  await runTurn(page, "Change a file, then lose the answer");
  const sessionId = String(
    protocol.requests("session/open")[0]!.params!.session_id,
  );
  // Core restores, and its answer cannot be read. (The real walk drops the
  // connection instead; this fixture's reconnect replays no turn summaries.)
  await control(request, "next-restore", sessionId, "&mode=garbled");
  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  const alert = summary(page).getByRole("alert");
  await expect(alert).toContainText(
    "No answer from Core, so it is unknown whether the files changed.",
  );
  const unknown = summary(page).getByText(
    "After this turn the workspace got saved states this page did not make",
  );
  await expect(unknown).toBeVisible();
  await expect(summary(page).getByRole("button")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(unknown).toBeVisible();
  await expect(summary(page).getByRole("button")).toHaveCount(0);
  await expect(
    summary(page).getByText(
      /Done\. This turn's file changes are back\.|Undone\. The files are back/,
    ),
  ).toHaveCount(0);
  expect(protocol.requests("snapshot/restore")).toHaveLength(1);
});

test("another tab's undo leaves this tab's stale entry unsent and unsure", async ({
  page,
  browser,
}) => {
  const protocol = observeRpc(page);
  await start(page, "/srv/work/turn-undo-tabs");
  await runTurn(page, "Change a file seen from two tabs");
  // The second tab opens the same Session from its link.
  const other = await (await browser.newContext()).newPage();
  const otherProtocol = observeRpc(other);
  await other.goto(page.url());
  await other.getByLabel("Server origin").fill(FIXTURE_ORIGIN);
  await other
    .getByLabel("Auth token", { exact: true })
    .fill("tab-scoped-e2e-token");
  await other.getByLabel("Auth token", { exact: true }).press("Enter");
  await other.getByRole("button", { name: "Open conversation" }).click();
  await expect(other.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await expect(
    summary(other).getByRole("button", { name: "Undo this turn" }),
  ).toBeVisible();

  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();

  // The other tab still shows the undo it read before: confirming it sends
  // nothing, and it says it can no longer tell.
  await (
    await confirm(summary(other), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(summary(other).getByRole("alert")).toContainText(
    "Not sent: Core lists newer saved states than this page made",
  );
  await expect(
    summary(other).getByText(
      "After this turn the workspace got saved states this page did not make",
    ),
  ).toBeVisible();
  await expect(
    summary(other).getByRole("button", { name: /this turn/ }),
  ).toHaveCount(0);
  expect(otherProtocol.requests("snapshot/restore")).toHaveLength(0);

  // The tab that undid it can still bring it back.
  await (
    await confirm(summary(page), "redo")
  )
    .getByRole("button", { name: "Bring changes back" })
    .click();
  await expect(
    summary(page).getByText("Done. This turn's file changes are back."),
  ).toBeVisible();
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);
  await other.context().close();
});

test("an undone turn stops marking Changes once a later turn runs", async ({
  page,
}) => {
  await start(page, "/srv/work/turn-undo-later");
  await runTurn(page, "First change, undone later");
  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Session panel/ }).click();
  await panel(page)
    .getByRole("tab", { name: /^Changes/ })
    .click();
  const changes = panel(page).getByRole("tabpanel", { name: /^Changes/ });
  await changes
    .getByRole("button", { name: "This session", exact: true })
    .click();
  const note = changes.getByText("The latest turn's file changes were undone.");
  await expect(note).toBeVisible();

  await composer(page).fill("A second change after the undo");
  await composer(page).press("Enter");
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(2);
  await expect(note).toHaveCount(0);
  const summaries = page.getByRole("region", { name: "Turn summary" });
  await expect(summaries).toHaveCount(2);
  await expect(
    summaries.first().getByText("This turn's file changes were undone."),
  ).toBeVisible();
  await expect(
    summaries.first().getByRole("button", { name: "Redo this turn" }),
  ).toHaveCount(0);
  await expect(
    summaries.last().getByRole("button", { name: "Undo this turn" }),
  ).toBeVisible();
});

// T-0441: the phone remote control (`?view=remote`, 390×844, Chinese) opens a
// session's conversation through the same timeline, so the latest turn's
// summary offers the same undo/redo on the phone — reached from the overview,
// and found again after a reload sends the phone back to it.
test("a phone undoes and redoes the latest turn from the remote control, across a reload", async ({
  browser,
  request,
}) => {
  // A folder of this run's own, so the overview lists exactly its session.
  const folder = runFolder("turn-undo-phone");
  const name = folder.split("/").pop()!;
  expect(
    (
      await request.post(
        `${FIXTURE_ORIGIN}/__test__/session-list/scoped?workspace=${encodeURIComponent(folder)}`,
      )
    ).status(),
  ).toBe(204);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const protocol = observeRpc(page);
  await page.goto("/?view=remote");
  await page.getByLabel("服务器地址").fill(FIXTURE_ORIGIN);
  await page
    .getByLabel("访问令牌", { exact: true })
    .fill("tab-scoped-e2e-token");
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  await page.getByLabel("服务器上的文件夹路径").fill(folder);
  await page.getByRole("button", { name: "盯住" }).tap();
  await page.getByRole("button", { name: `在 ${name} 中新建会话` }).tap();
  const phoneComposer = page.getByRole("textbox", { name: "给 Octos 发消息" });
  await expect(phoneComposer).toBeEnabled();
  await phoneComposer.fill("Change the app from the phone");
  await page.getByRole("button", { name: "发送提示" }).tap();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1, {
    timeout: 15_000,
  });
  const sessionId = String(
    protocol.requests("session/open").at(-1)!.params!.session_id,
  );
  const turnId = String(protocol.requests("turn/start")[0]!.params!.turn_id);
  const preTurn = (await snapshots(request, sessionId)).snapshots.find(
    (snapshot) => snapshot.turn_id === turnId,
  )!;
  expect(preTurn).toBeTruthy();

  const phoneSummary = page.getByRole("region", { name: "本轮汇总" }).last();
  await phoneComposer.fill("还没发的草稿");
  await phoneSummary.getByRole("button", { name: "撤销这一轮" }).tap();
  const undo = phoneSummary.getByRole("group", { name: "确认撤销" });
  await expect(undo).toBeInViewport();
  // A double tap on the confirm sends one restore.
  await undo
    .getByRole("button", { name: "撤销文件改动" })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  // The outcome stays where it was asked for, not under the composer, after
  // the conversation refresh and the composer have settled.
  const undone = phoneSummary.getByText(
    "已撤销，文件回到了这一轮开始前的样子。",
  );
  await expect(undone).toBeInViewport();
  await page.waitForTimeout(600);
  await expect(undone).toBeInViewport();
  await expect(
    phoneSummary.getByRole("button", { name: "恢复撤销" }),
  ).toBeVisible();
  expect(
    protocol.requests("snapshot/restore").map((frame) => frame.params),
  ).toEqual([{ session_id: sessionId, snapshot_id: preTurn.id }]);
  await expect(phoneComposer).toHaveValue("还没发的草稿");

  await page.reload();
  await expect(page.getByRole("heading", { name: "手机遥控" })).toBeVisible();
  const recent = page
    .getByRole("region", { name: /^最近/ })
    .getByRole("button");
  await expect(recent).toHaveCount(1);
  await recent.tap();
  await expect(page.getByText(COMPLETION_TEXT)).toHaveCount(1);
  await phoneSummary.getByRole("button", { name: "恢复撤销" }).tap();
  await phoneSummary
    .getByRole("group", { name: "确认恢复" })
    .getByRole("button", { name: "恢复改动" })
    .tap();
  await expect(
    phoneSummary.getByText("已恢复这一轮的文件改动。"),
  ).toBeInViewport();
  expect(protocol.requests("snapshot/restore")).toHaveLength(2);
  await context.close();
});
