import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

// T-0433: "Undo this turn" in the latest turn's summary, wired to Core's
// `pre-turn <turn_id>` snapshot, with redo through the `pre-restore` point.
const FIXTURE_ORIGIN = `http://127.0.0.1:${process.env.OCTOSCODE_E2E_FIXTURE_PORT ?? "50080"}`;
const COMPLETION_TEXT = "Completed with pnpm check and all tests passing.";

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
  await expect(alert).toContainText(
    "Not brought back: files were edited after the undo, and Core will not overwrite them. Your edits are kept.",
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

test("Core's failures, a vanished point and an unanswered restore are reported as they are", async ({
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

  // Sent, and the answer cannot be read: unknown, never replayed. (The real
  // walk drops the connection instead; this fixture's reconnect replays no
  // turn summaries.)
  await control(request, "next-restore", sessionId, "&mode=garbled");
  await (
    await confirm(summary(page), "undo")
  )
    .getByRole("button", { name: "Undo file changes" })
    .click();
  await expect(alert).toContainText(
    "No answer from Core, so it is unknown whether the files changed.",
  );
  await expect(alert).toContainText("nothing is retried automatically");
  await page.waitForTimeout(800);
  expect(protocol.requests("snapshot/restore")).toHaveLength(3);
  await expect(
    summary(page).getByRole("button", { name: "Redo this turn" }),
  ).toHaveCount(0);

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
  expect(protocol.requests("snapshot/restore")).toHaveLength(3);
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
